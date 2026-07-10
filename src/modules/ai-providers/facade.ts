import "server-only";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getSessionAndClient } from "@/lib/supabase/session";
import { mediaFacade } from "@/modules/media/facade";
import type { Result } from "@/modules/platform/contracts";

import {
  zGenerateImageCascadeInput,
  zSaveKeyInput,
  type AiKeyMeta,
  type AiKeyStatus,
  type DetectedModel,
  type GenerateImageCascadeInput,
  type GenerateImageInput,
  type GenerateImageReq,
  type GenerateTextReq,
  type ImageCascadeNode,
  type ImageCascadeResult,
  type ImageResult,
  type KeyTestResult,
  type ModelKind,
  type SaveKeyInput,
  type TextResult,
  type TranscribeReq,
  type TranscribeResult,
  type UsageRange,
  type UsageSummary,
} from "./contracts";
import { listAnthropicModels } from "./internal/anthropic";
import { listGeminiModels } from "./internal/gemini";
import { listOpenAiModels } from "./internal/openai";
import type { ProviderCallError } from "./internal/provider-error";
import { routeGenerateImages, routeGenerateText, routeTranscribe } from "./internal/router";
import {
  deleteKeyRow,
  findUsageLogIdByRef,
  generateVaultSecretName,
  getCurrentMonthBudget,
  getImageGenerationRow,
  getKeyRow,
  getUsageSummaryRows,
  insertImageGenerationRow,
  insertImageGenerationSources,
  insertKeyRow,
  listKeyRows,
  markImageGenerationSelected,
  runAiDraftCleanup,
  updateModelsRow,
  updatePriorityRow,
  updateTestResultRow,
  vaultDeleteSecret,
  vaultReadSecret,
  vaultUpsertSecret,
  type AiProviderKeyRow,
  type ImageGenerationRow,
} from "./repository";

/**
 * ai-providers モジュールの公開 facade (canonical: docs/design/ai-studio-v2.md §1、
 * docs/module-contracts.md v2.5 §5)。
 */
export interface AiProvidersFacade {
  listKeys(): Promise<Result<AiKeyMeta[]>>;
  saveKey(input: SaveKeyInput): Promise<Result<{ id: string }>>;
  deleteKey(id: string): Promise<Result<void>>;
  testKey(id: string): Promise<Result<KeyTestResult>>;
  setKeyPriority(id: string, priority: number): Promise<Result<void>>;
  setEnabledModels(id: string, models: string[], defaultModel: string | null): Promise<Result<void>>;
  listAvailableModels(kind: ModelKind): Promise<Result<DetectedModel[]>>;
  generateText(req: GenerateTextReq): Promise<Result<TextResult>>;
  generateImages(req: GenerateImageReq): Promise<Result<ImageResult>>;
  transcribe(req: TranscribeReq): Promise<Result<TranscribeResult>>;
  getUsageSummary(range: UsageRange): Promise<Result<UsageSummary>>;
}

/**
 * 契約外拡張 (P3: docs/design/ai-studio-v2.md §4。module-contracts.md 未更新分 —
 * オーケストレーターへ報告済み。ai_image_generations/ai_image_generation_sources は
 * P1 で既に ai-providers 所有と確定しているため、画像カスケードの記録ロジックは
 * 本モジュールの facade/repository を拡張する形で実装する — 新規モジュールを作らない判断
 * (詳細は実装報告参照))。
 */
export interface AiProvidersFacadeExtended extends AiProvidersFacade {
  /**
   * MediaPicker の「AI で生成」タブの中核。プロンプト + 参照画像 (0-4 枚) + モデルで
   * n 枚 (既定 4) を生成し、成功分をそれぞれ media として保存した上で
   * ai_image_generations に 1 行 1 画像で記録する。parentId 指定時はカスケード
   * (その画像の media を sourceImages に自動合成し、parent_id/root_id を継承する)。
   */
  generateImageCascade(input: GenerateImageCascadeInput): Promise<Result<ImageCascadeResult>>;
  /** 「これを使う」時に呼ぶ。is_selected=true に更新する (ai-draft 掃除 cron の対象から外れる) */
  markImageSelected(generationId: string): Promise<Result<void>>;
  /** パンくず (root → ... → generationId) を取得する */
  getImageGenerationBreadcrumb(generationId: string): Promise<Result<ImageCascadeNode[]>>;
}

function toMeta(row: AiProviderKeyRow): AiKeyMeta {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    keyLast4: row.key_last4,
    priority: row.priority,
    status: row.status,
    cooldownUntil: row.cooldown_until,
    lastError: row.last_error,
    lastTestedAt: row.last_tested_at,
    detectedModels: row.detected_models,
    enabledModels: row.enabled_models,
    defaultModel: row.default_model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function errFrom(err: unknown): Result<never> {
  return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
}

async function listModelsForProvider(
  provider: AiProviderKeyRow["provider"],
  apiKey: string,
): Promise<{ ok: true; value: DetectedModel[] } | { ok: false; error: ProviderCallError }> {
  const result =
    provider === "anthropic"
      ? await listAnthropicModels(apiKey)
      : provider === "openai"
        ? await listOpenAiModels(apiKey)
        : await listGeminiModels(apiKey);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, value: result.value };
}

/**
 * testKey の失敗を router.ts §1 MAJOR-1 と同じキー状態分類にマッピングする。
 * auth (401/403) → failed / rate_limit (429) → limited (+ cooldown) / それ以外 → failed
 * (疎通確認という性質上、network 等の一時エラーも「今は使えない」表示として failed に倒す —
 * 実際の生成呼び出し時の router 内フォールバックとは異なり、こちらは人間が見るステータス表示のため)。
 */
function statusForFailure(error: ProviderCallError): { status: AiKeyStatus; cooldownUntil: string | null } {
  if (error.kind === "rate_limit") {
    const seconds = error.retryAfterSeconds ?? 30;
    return { status: "limited", cooldownUntil: new Date(Date.now() + seconds * 1000).toISOString() };
  }
  return { status: "failed", cooldownUntil: null };
}

// ---------------------------------------------------------
// 画像生成カスケード (P3) のヘルパ
// ---------------------------------------------------------

/** ai_image_generations 行 → API/UI 向けの ImageCascadeNode 射影 (getPublicUrl は同期・DB 不要) */
function toImageCascadeNode(row: ImageGenerationRow): ImageCascadeNode {
  const urlResult = row.media_id ? mediaFacade.getPublicUrl(row.media_id) : null;
  return {
    id: row.id,
    requestGroupId: row.request_group_id,
    parentId: row.parent_id,
    // ルート規約 (2026-07-10 確定): root_id は常に非 null (自己参照含む)。
    // 型上は DB 列が nullable のため、万一の欠損は自身の id へ防御的にフォールバックする。
    rootId: row.root_id ?? row.id,
    prompt: row.prompt,
    provider: row.provider,
    model: row.model,
    mediaId: row.media_id ?? "",
    url: urlResult?.ok ? urlResult.value : "",
    isSelected: row.is_selected,
    createdAt: row.created_at,
  };
}

/** parentId から遡って root → ... → parentId の順にノードを並べる (無限ループ防御で 100 段まで) */
async function buildAncestryChain(
  supabase: SupabaseClient,
  id: string,
): Promise<Result<ImageCascadeNode[]>> {
  const chain: ImageGenerationRow[] = [];
  let currentId: string | null = id;
  let guard = 0;
  while (currentId && guard < 100) {
    const rowResult = await getImageGenerationRow(supabase, currentId);
    if (!rowResult.ok) return rowResult;
    if (!rowResult.value) break;
    chain.push(rowResult.value);
    currentId = rowResult.value.parent_id;
    guard += 1;
  }
  chain.reverse();
  return { ok: true, value: chain.map(toImageCascadeNode) };
}

/**
 * 既存 media を参照画像として使うため、公開 URL から実バイトを取得し base64 化する
 * ("media" バケットは公開レンディション専用のため署名不要で fetch できる)。
 */
async function fetchMediaAsGenerateImageInput(mediaId: string): Promise<GenerateImageInput> {
  const urlResult = mediaFacade.getPublicUrl(mediaId);
  if (!urlResult.ok) throw new Error(`参照画像の URL 解決に失敗しました (${mediaId})`);
  const res = await fetch(urlResult.value);
  if (!res.ok) {
    throw new Error(`参照画像の取得に失敗しました (${mediaId}): status=${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  return { mimeType: "image/webp", dataBase64: buffer.toString("base64") };
}

const AI_DRAFT_CLEANUP_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * ai-draft 掃除 cron (P3) から呼ばれる。admin セッションを前提としない
 * (pg_cron → /api/jobs/cleanup-ai-drafts → 本関数、の service_role 経路。
 * distribution の runPublishWorkerBatch と同型)。DB 側の削除可否判定
 * (tags/is_selected/参照ゼロ/7日経過) は ai_draft_cleanup_run RPC (migration
 * 20260710000016) に一括で寄せてあるため、ここでは Storage オブジェクトの削除のみ行う。
 */
export async function cleanupAiDraftMedia(): Promise<{ processed: number; failed: number }> {
  const serviceClient = createSupabaseServiceClient();
  const cutoffIso = new Date(Date.now() - AI_DRAFT_CLEANUP_AGE_MS).toISOString();
  const result = await runAiDraftCleanup(serviceClient, cutoffIso);
  if (!result.ok) {
    console.error("KMB-E901: ai-draft 掃除候補の削除に失敗しました", result.detail);
    return { processed: 0, failed: 0 };
  }

  let processed = 0;
  let failed = 0;
  for (const row of result.value) {
    try {
      await serviceClient.storage.from("media-originals").remove([row.storagePath]);
      await serviceClient.storage.from("media").remove([`${row.mediaId}.webp`, `${row.mediaId}.jpg`]);
      processed += 1;
    } catch (err) {
      failed += 1;
      console.error(
        `KMB-E901: ai-draft Storage 削除に失敗しました (${row.mediaId})`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  return { processed, failed };
}

export const aiProvidersFacade: AiProvidersFacadeExtended = {
  async listKeys() {
    try {
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };
      const result = await listKeyRows(supabase);
      if (!result.ok) return result;
      return { ok: true, value: result.value.map(toMeta) };
    } catch (err) {
      return errFrom(err);
    }
  },

  async saveKey(input) {
    try {
      const parsed = zSaveKeyInput.safeParse(input);
      if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const serviceClient = createSupabaseServiceClient();
      const vaultSecretName = generateVaultSecretName(parsed.data.provider);
      const upsertResult = await vaultUpsertSecret(serviceClient, vaultSecretName, parsed.data.apiKey);
      if (!upsertResult.ok) return upsertResult;

      const insertResult = await insertKeyRow(supabase, {
        provider: parsed.data.provider,
        label: parsed.data.label,
        vaultSecretName,
        keyLast4: parsed.data.apiKey.slice(-4),
        priority: parsed.data.priority,
      });
      if (!insertResult.ok) {
        // ベストエフォートのロールバック (Vault にオーファン secret を残さない)
        await vaultDeleteSecret(serviceClient, vaultSecretName).catch(() => undefined);
        return insertResult;
      }
      return { ok: true, value: { id: insertResult.value.id } };
    } catch (err) {
      return errFrom(err);
    }
  },

  async deleteKey(id) {
    try {
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const rowResult = await getKeyRow(supabase, id);
      if (!rowResult.ok) return rowResult;
      if (!rowResult.value) return { ok: false, code: "KMB-E101", detail: "キーが見つかりません" };

      const deleteResult = await deleteKeyRow(supabase, id);
      if (!deleteResult.ok) return deleteResult;

      const serviceClient = createSupabaseServiceClient();
      await vaultDeleteSecret(serviceClient, rowResult.value.vault_secret_name).catch(() => undefined);
      return { ok: true, value: undefined };
    } catch (err) {
      return errFrom(err);
    }
  },

  async testKey(id) {
    try {
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const rowResult = await getKeyRow(supabase, id);
      if (!rowResult.ok) return rowResult;
      const row = rowResult.value;
      if (!row) return { ok: false, code: "KMB-E101", detail: "キーが見つかりません" };

      const serviceClient = createSupabaseServiceClient();
      const secretResult = await vaultReadSecret(serviceClient, row.vault_secret_name);
      if (!secretResult.ok) return secretResult;
      if (!secretResult.value) {
        return { ok: false, code: "KMB-E101", detail: "Vault にキーが見つかりません" };
      }

      const modelsResult = await listModelsForProvider(row.provider, secretResult.value);
      if (!modelsResult.ok) {
        const { status, cooldownUntil } = statusForFailure(modelsResult.error);
        await updateTestResultRow(supabase, id, {
          status,
          detectedModels: row.detected_models,
          lastError: modelsResult.error.message,
          cooldownUntil,
        });
        return {
          ok: true,
          value: {
            ok: false,
            modelCount: 0,
            detectedModels: row.detected_models,
            error: modelsResult.error.message,
          },
        };
      }

      await updateTestResultRow(supabase, id, {
        status: "ok",
        detectedModels: modelsResult.value,
        lastError: null,
      });
      return {
        ok: true,
        value: { ok: true, modelCount: modelsResult.value.length, detectedModels: modelsResult.value, error: null },
      };
    } catch (err) {
      return errFrom(err);
    }
  },

  async setKeyPriority(id, priority) {
    try {
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };
      return await updatePriorityRow(supabase, id, priority);
    } catch (err) {
      return errFrom(err);
    }
  },

  async setEnabledModels(id, models, defaultModel) {
    try {
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };
      return await updateModelsRow(supabase, id, { enabledModels: models, defaultModel });
    } catch (err) {
      return errFrom(err);
    }
  },

  async listAvailableModels(kind) {
    try {
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };
      const result = await listKeyRows(supabase);
      if (!result.ok) return result;

      const seen = new Set<string>();
      const models: DetectedModel[] = [];
      for (const row of result.value) {
        for (const model of row.detected_models) {
          if (model.kind !== kind) continue;
          const dedupeKey = `${row.provider}/${model.id}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          models.push(model);
        }
      }
      return { ok: true, value: models };
    } catch (err) {
      return errFrom(err);
    }
  },

  async generateText(req) {
    try {
      return await routeGenerateText(req);
    } catch (err) {
      return errFrom(err);
    }
  },

  async generateImages(req) {
    try {
      return await routeGenerateImages(req);
    } catch (err) {
      return errFrom(err);
    }
  },

  async transcribe(req) {
    try {
      return await routeTranscribe(req);
    } catch (err) {
      return errFrom(err);
    }
  },

  async getUsageSummary(range) {
    try {
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };
      const result = await getUsageSummaryRows(supabase, range);
      if (!result.ok) return result;
      const totalCostMicroUsd = result.value.reduce((acc, r) => acc + r.costMicroUsd, 0);
      const totalImageCount = result.value.reduce((acc, r) => acc + r.imageCount, 0);
      // tester 検証事項: 当月の reserved/settled/上限を P5 ダッシュボード用に含める。
      // 取得失敗はベストエフォート (summary 本体の表示は継続。budget=null で示す)。
      const budgetResult = await getCurrentMonthBudget(supabase);
      const budget = budgetResult.ok ? budgetResult.value : null;
      return { ok: true, value: { totalCostMicroUsd, totalImageCount, rows: result.value, budget } };
    } catch (err) {
      return errFrom(err);
    }
  },

  async generateImageCascade(input) {
    try {
      const parsed = zGenerateImageCascadeInput.safeParse(input);
      if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };
      const data = parsed.data;

      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      // 1) カスケード元の解決 (parentId 指定時のみ)
      let rootId: string | null = null;
      let parentMediaId: string | null = null;
      if (data.parentId) {
        const parentResult = await getImageGenerationRow(supabase, data.parentId);
        if (!parentResult.ok) return parentResult;
        const parent = parentResult.value;
        if (!parent || parent.status !== "succeeded" || !parent.media_id) {
          return { ok: false, code: "KMB-E101", detail: "指定されたカスケード元が見つかりません" };
        }
        // ルート規約 (2026-07-10 確定): parent.root_id は常に非 null のはずだが、
        // 念のため自身の id へのフォールバックを残す。
        rootId = parent.root_id ?? parent.id;
        parentMediaId = parent.media_id;
      }

      // 2) 参照画像の解決 (parent の画像 + 追加 media + raw upload。合計 4 枚まで)
      const mediaSourceIds = [
        ...(parentMediaId ? [parentMediaId] : []),
        ...data.sourceMediaIds.filter((id) => id !== parentMediaId),
      ];
      const totalSourceCount = mediaSourceIds.length + data.rawSourceImages.length;
      if (totalSourceCount > 4) {
        return { ok: false, code: "KMB-E101", detail: "参照画像は合計 4 枚までです" };
      }

      let sourceImages: GenerateImageInput[];
      try {
        const fetchedFromMedia = await Promise.all(mediaSourceIds.map((id) => fetchMediaAsGenerateImageInput(id)));
        sourceImages = [...fetchedFromMedia, ...data.rawSourceImages];
      } catch (err) {
        return { ok: false, code: "KMB-E101", detail: err instanceof Error ? err.message : String(err) };
      }

      // 3) プロンプト構築 (「サイトの文脈を使う」トグル。呼び出し元が構築済みの文字列を前置するのみ)
      const finalPrompt = data.siteContext ? `${data.siteContext}\n\n---\n\n${data.prompt}` : data.prompt;

      // 4) 生成 (既存ルータ経由。予算予約 (E407)・usage 記録・キーフォールバックは実装済み)
      const requestGroupId = randomUUID();
      const feature = data.parentId ? "image-cascade" : "image-gen";
      const genResult = await routeGenerateImages({
        model: data.model,
        feature,
        prompt: finalPrompt,
        n: data.n,
        sourceImages: sourceImages.length > 0 ? sourceImages : undefined,
        size: data.size,
        quality: data.quality,
        refTable: "ai_image_generations",
        refId: requestGroupId,
      });
      if (!genResult.ok) return genResult;

      // 5) usage_log_id の逆引き (refId=requestGroupId で一意に紐付く)
      const usageLogResult = await findUsageLogIdByRef(supabase, "ai_image_generations", requestGroupId);
      const usageLogId = usageLogResult.ok ? usageLogResult.value : null;

      // 6) 生成画像を media として保存 + ai_image_generations に 1 行 1 画像で記録
      const nodes: ImageCascadeNode[] = [];
      let saveFailedCount = 0;
      for (const image of genResult.value.images) {
        try {
          const buffer = Buffer.from(image.dataBase64, "base64");
          const saved = await mediaFacade.createFromBytes({
            bytes: buffer,
            contentType: image.mimeType,
            alt: data.prompt.slice(0, 200),
            credit: `AI生成 (${genResult.value.model})`,
            tags: ["ai-generated", "ai-draft"],
            isPlaceholder: false,
          });

          const rowResult = await insertImageGenerationRow(supabase, {
            requestGroupId,
            parentId: data.parentId,
            rootId,
            prompt: data.prompt,
            provider: genResult.value.provider,
            model: genResult.value.model,
            params: {
              n: data.n,
              size: data.size ?? null,
              quality: data.quality ?? null,
              siteContextUsed: Boolean(data.siteContext),
            },
            status: "succeeded",
            mediaId: saved.id,
            usageLogId,
            errorCode: null,
          });
          if (!rowResult.ok) {
            saveFailedCount += 1;
            continue;
          }
          nodes.push(toImageCascadeNode(rowResult.value));
        } catch (err) {
          saveFailedCount += 1;
          console.error(
            "KMB-E901: AI 生成画像の media 保存に失敗しました",
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      // 7) 参照画像の系譜記録 (既存 media のみ。raw upload は media 化しないため対象外)
      if (mediaSourceIds.length > 0) {
        await insertImageGenerationSources(supabase, requestGroupId, mediaSourceIds);
      }

      if (nodes.length === 0) {
        return { ok: false, code: "KMB-E901", detail: "生成画像の保存にすべて失敗しました" };
      }

      // 8) パンくず (root → ... → parent)。取得失敗はグリッド表示自体は継続するため空配列に倒す
      const breadcrumbResult: Result<ImageCascadeNode[]> = data.parentId
        ? await buildAncestryChain(supabase, data.parentId)
        : { ok: true, value: [] };

      return {
        ok: true,
        value: {
          requestGroupId,
          images: nodes,
          failedCount: genResult.value.failedCount + saveFailedCount,
          breadcrumb: breadcrumbResult.ok ? breadcrumbResult.value : [],
        },
      };
    } catch (err) {
      return errFrom(err);
    }
  },

  async markImageSelected(generationId) {
    try {
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };
      return await markImageGenerationSelected(supabase, generationId, true);
    } catch (err) {
      return errFrom(err);
    }
  },

  async getImageGenerationBreadcrumb(generationId) {
    try {
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };
      return await buildAncestryChain(supabase, generationId);
    } catch (err) {
      return errFrom(err);
    }
  },
};
