import "server-only";

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getSessionAndClient } from "@/lib/supabase/session";
import type { Result } from "@/modules/platform/contracts";

import {
  zSaveKeyInput,
  type AiKeyMeta,
  type AiKeyStatus,
  type DetectedModel,
  type GenerateImageReq,
  type GenerateTextReq,
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
  generateVaultSecretName,
  getCurrentMonthBudget,
  getKeyRow,
  getUsageSummaryRows,
  insertKeyRow,
  listKeyRows,
  updateModelsRow,
  updatePriorityRow,
  updateTestResultRow,
  vaultDeleteSecret,
  vaultReadSecret,
  vaultUpsertSecret,
  type AiProviderKeyRow,
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

export const aiProvidersFacade: AiProvidersFacade = {
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
};
