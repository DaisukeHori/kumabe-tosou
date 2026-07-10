import "server-only";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Result } from "@/modules/platform/contracts";
import type { KmbErrorCode } from "@/modules/platform/errors";

import type { AiKeyStatus, BudgetState, DetectedModel, Provider, UsageSummaryRow } from "./contracts";

/**
 * ai-providers モジュールの repository (契約書 §1/§3)。
 * 所有テーブル: ai_provider_keys, ai_usage_log, ai_image_generations,
 * ai_image_generation_sources, ai_budget_months (migration 20260710000015)。
 *
 * ai_provider_keys / ai_usage_log は RLS が admin 全権 (RLS 20260710000015) のため、
 * 呼び出し元の admin セッション付き client (createSupabaseServerClient()) をそのまま渡せる
 * (settings/distribution の既存パターンと同型)。Vault RPC と予算 RPC のみ、
 * 個別の理由で client の種類が固定される (各関数のコメント参照)。
 */

export type AiProviderKeyRow = {
  id: string;
  provider: Provider;
  label: string;
  vault_secret_name: string;
  key_last4: string;
  priority: number;
  status: AiKeyStatus;
  cooldown_until: string | null;
  last_error: string | null;
  last_tested_at: string | null;
  detected_models: DetectedModel[];
  enabled_models: string[];
  default_model: string | null;
  created_at: string;
  updated_at: string;
};

const KEY_SELECT =
  "id, provider, label, vault_secret_name, key_last4, priority, status, cooldown_until, last_error, last_tested_at, detected_models, enabled_models, default_model, created_at, updated_at";

function pgErrorToResult(error: { code?: string; message: string }): {
  ok: false;
  code: KmbErrorCode;
  detail: string;
} {
  if (error.code === "23505") return { ok: false, code: "KMB-E102", detail: error.message };
  if (error.code === "42501") return { ok: false, code: "KMB-E202", detail: error.message };
  return { ok: false, code: "KMB-E901", detail: error.message };
}

// ---------------------------------------------------------
// 秘密情報サニタイザ (tester 検証 LOW 対応)
// ---------------------------------------------------------
// プロバイダのエラーメッセージは API キーの断片をそのままエコーバックすることがある
// (例: OpenAI の "Incorrect API key provided: sk-***...wxyz" 系メッセージ)。
// last_error / raw_usage を DB (ai_provider_keys.last_error, ai_usage_log.raw_usage) に
// 保存する前に、それらしいトークンパターンを機械的にマスクする単一の choke point として
// repository 層に置く (呼び出し元 router.ts 等での対応漏れを構造的に防ぐ)。
const SECRET_TOKEN_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}/g, // OpenAI ("sk-...") / Anthropic ("sk-ant-...") 系
  /AIza[A-Za-z0-9_-]{8,}/g, // Gemini API key 系
];

/** 文字列中のトークンらしき部分文字列を "***" に置換する */
export function maskSecretsInString(input: string): string {
  return SECRET_TOKEN_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, "***"), input);
}

/** 文字列/配列/オブジェクトを再帰的に走査し、文字列リーフにのみマスクを適用する */
export function sanitizeForStorage<T>(value: T): T {
  if (typeof value === "string") return maskSecretsInString(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => sanitizeForStorage(v)) as unknown as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeForStorage(v);
    }
    return out as T;
  }
  return value;
}

export async function listKeyRows(client: SupabaseClient, provider?: Provider): Promise<Result<AiProviderKeyRow[]>> {
  let query = client.from("ai_provider_keys").select(KEY_SELECT).order("priority", { ascending: true }).order("created_at", { ascending: true });
  if (provider) query = query.eq("provider", provider);
  const { data, error } = await query;
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data ?? []) as unknown as AiProviderKeyRow[] };
}

export async function getKeyRow(client: SupabaseClient, id: string): Promise<Result<AiProviderKeyRow | null>> {
  const { data, error } = await client.from("ai_provider_keys").select(KEY_SELECT).eq("id", id).maybeSingle();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data as AiProviderKeyRow | null) ?? null };
}

export type InsertKeyInput = {
  provider: Provider;
  label: string;
  vaultSecretName: string;
  keyLast4: string;
  priority: number;
};

export async function insertKeyRow(client: SupabaseClient, input: InsertKeyInput): Promise<Result<AiProviderKeyRow>> {
  const { data, error } = await client
    .from("ai_provider_keys")
    .insert({
      provider: input.provider,
      label: input.label,
      vault_secret_name: input.vaultSecretName,
      key_last4: input.keyLast4,
      priority: input.priority,
    })
    .select(KEY_SELECT)
    .single();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: data as unknown as AiProviderKeyRow };
}

export async function deleteKeyRow(client: SupabaseClient, id: string): Promise<Result<void>> {
  const { error } = await client.from("ai_provider_keys").delete().eq("id", id);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: undefined };
}

export async function updatePriorityRow(client: SupabaseClient, id: string, priority: number): Promise<Result<void>> {
  const { error } = await client.from("ai_provider_keys").update({ priority }).eq("id", id);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: undefined };
}

export async function updateModelsRow(
  client: SupabaseClient,
  id: string,
  input: { enabledModels: string[]; defaultModel: string | null },
): Promise<Result<void>> {
  const { error } = await client
    .from("ai_provider_keys")
    .update({ enabled_models: input.enabledModels, default_model: input.defaultModel })
    .eq("id", id);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: undefined };
}

export async function updateTestResultRow(
  client: SupabaseClient,
  id: string,
  input: {
    status: AiKeyStatus;
    detectedModels: DetectedModel[];
    lastError: string | null;
    cooldownUntil?: string | null;
  },
): Promise<Result<void>> {
  const { error } = await client
    .from("ai_provider_keys")
    .update({
      status: input.status,
      detected_models: input.detectedModels,
      last_error: input.lastError ? maskSecretsInString(input.lastError) : input.lastError,
      last_tested_at: new Date().toISOString(),
      cooldown_until: input.status === "limited" ? (input.cooldownUntil ?? null) : null,
    })
    .eq("id", id);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: undefined };
}

/** router.ts が呼び出し試行後の分類結果でキーの状態を更新する (§1 MAJOR-1 のフォールバック状態遷移) */
export async function markKeyOutcomeRow(
  client: SupabaseClient,
  id: string,
  outcome: { status: AiKeyStatus; cooldownUntil: string | null; lastError: string | null },
): Promise<Result<void>> {
  const { error } = await client
    .from("ai_provider_keys")
    .update({
      status: outcome.status,
      cooldown_until: outcome.cooldownUntil,
      last_error: outcome.lastError ? maskSecretsInString(outcome.lastError) : outcome.lastError,
    })
    .eq("id", id);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: undefined };
}

// ---------------------------------------------------------
// Vault (service client 専用。設計書 §11 / distribution/repository.ts の前例踏襲)
// ---------------------------------------------------------

export async function vaultUpsertSecret(
  serviceClient: SupabaseClient,
  name: string,
  value: string,
): Promise<Result<void>> {
  const { error } = await serviceClient.rpc("vault_upsert_secret", { p_name: name, p_secret: value });
  if (error) return { ok: false, code: "KMB-E901", detail: error.message };
  return { ok: true, value: undefined };
}

export async function vaultReadSecret(serviceClient: SupabaseClient, name: string): Promise<Result<string | null>> {
  const { data, error } = await serviceClient.rpc("vault_read_secret", { p_name: name });
  if (error) return { ok: false, code: "KMB-E901", detail: error.message };
  return { ok: true, value: (data as string | null) ?? null };
}

/**
 * vault_delete_secret RPC (判断点・オーケストレーターへ報告済み): 設計書 §2/§11 には
 * 明記が無いが、deleteKey() facade メソッド (キー削除) が Vault 上の秘密も同時に
 * 削除できないと Vault にオーファン secret が蓄積し続ける。0004/0010 の
 * vault_upsert_secret/vault_read_secret と対になる削除版として migration 0015 に追加した。
 */
export async function vaultDeleteSecret(serviceClient: SupabaseClient, name: string): Promise<Result<void>> {
  const { error } = await serviceClient.rpc("vault_delete_secret", { p_name: name });
  if (error) return { ok: false, code: "KMB-E901", detail: error.message };
  return { ok: true, value: undefined };
}

export function generateVaultSecretName(provider: Provider): string {
  return `ai-provider-key-${provider}-${randomUUID()}`;
}

// ---------------------------------------------------------
// ai_usage_log
// ---------------------------------------------------------

export type InsertUsageLogInput = {
  provider: Provider;
  model: string;
  keyId: string | null;
  kind: "text" | "image";
  feature: string;
  inputTokens: number | null;
  outputTokens: number | null;
  imageCount: number | null;
  costMicroUsd: number;
  status: "ok" | "error";
  errorCode: string | null;
  rawUsage: unknown;
  rateSnapshot: unknown;
  refTable: string | null;
  refId: string | null;
};

export async function insertUsageLog(client: SupabaseClient, input: InsertUsageLogInput): Promise<Result<{ id: string }>> {
  const { data, error } = await client
    .from("ai_usage_log")
    .insert({
      provider: input.provider,
      model: input.model,
      key_id: input.keyId,
      kind: input.kind,
      feature: input.feature,
      input_tokens: input.inputTokens,
      output_tokens: input.outputTokens,
      image_count: input.imageCount,
      cost_micro_usd: input.costMicroUsd,
      status: input.status,
      error_code: input.errorCode,
      raw_usage: sanitizeForStorage(input.rawUsage),
      rate_snapshot: input.rateSnapshot,
      ref_table: input.refTable,
      ref_id: input.refId,
    })
    .select("id")
    .single();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: { id: (data as { id: string }).id } };
}

export async function getUsageSummaryRows(
  client: SupabaseClient,
  range: { from: string; to: string },
): Promise<Result<UsageSummaryRow[]>> {
  const { data, error } = await client
    .from("ai_usage_log")
    .select("provider, model, feature, key_id, image_count, cost_micro_usd, created_at")
    .gte("created_at", range.from)
    .lt("created_at", range.to);
  if (error) return pgErrorToResult(error);

  type Raw = {
    provider: Provider;
    model: string;
    feature: string;
    key_id: string | null;
    image_count: number | null;
    cost_micro_usd: number;
    created_at: string;
  };
  const rows = (data ?? []) as unknown as Raw[];

  const grouped = new Map<string, UsageSummaryRow>();
  for (const row of rows) {
    const date = row.created_at.slice(0, 10);
    const key = `${row.provider}|${row.model}|${row.feature}|${row.key_id ?? ""}|${date}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.costMicroUsd += row.cost_micro_usd;
      existing.callCount += 1;
      existing.imageCount += row.image_count ?? 0;
    } else {
      grouped.set(key, {
        provider: row.provider,
        model: row.model,
        feature: row.feature,
        keyId: row.key_id,
        date,
        costMicroUsd: row.cost_micro_usd,
        callCount: 1,
        imageCount: row.image_count ?? 0,
      });
    }
  }
  return { ok: true, value: [...grouped.values()] };
}

// ---------------------------------------------------------
// 予算 RPC (§1 BLOCKER-2: atomic reserve/settle。reservation 方式 — tester 検証 HIGH 対応)
// ---------------------------------------------------------

/**
 * ok=true のときのみ reservationId が確定する (discriminated union)。
 * ok=false (予算/画像枚数超過、または回収処理のみ実行) の場合は reservation 行を
 * 作らないため reservationId は常に null — 呼び出し側 (router.ts) が settle を
 * 呼び出す必要が無いことが型から明らかになる。
 */
export type BudgetReserveOutcome =
  | { ok: true; reservationId: string }
  | { ok: false; reservationId: null; errorCode: string | null };

export async function budgetReserve(
  client: SupabaseClient,
  estimateMicroUsd: number,
  imageCount: number,
): Promise<Result<BudgetReserveOutcome>> {
  const { data, error } = await client.rpc("ai_budget_reserve", {
    p_estimate_micro_usd: estimateMicroUsd,
    p_image_count: imageCount,
  });
  if (error) return { ok: false, code: "KMB-E901", detail: error.message };
  // ai_run_acquire_lease と同じ流儀: table 関数の RPC 結果は配列で返るため 1 件目を取る
  // (.single() は 0 件時に例外化するため使わない。ここは常に 1 行返る設計だが安全側で統一)。
  const row = (Array.isArray(data) ? data[0] : data) as {
    reservation_id: string | null;
    ok: boolean;
    error_code: string | null;
  };
  if (row.ok && row.reservation_id) {
    return { ok: true, value: { ok: true, reservationId: row.reservation_id } };
  }
  return { ok: true, value: { ok: false, reservationId: null, errorCode: row.error_code } };
}

/**
 * reservation_id を持ち回って settle する (§1 BLOCKER-2 の reservation 方式)。
 * 失敗時 (プロバイダ呼び出し全滅等) は actualMicroUsd/actualImageCount=0 で呼ぶことで
 * 「解放」を兼ねる。DB 側 (ai_budget_settle) は二重 settle を no-op にする。
 */
export async function budgetSettle(
  client: SupabaseClient,
  input: { reservationId: string; actualMicroUsd: number; actualImageCount: number },
): Promise<Result<void>> {
  const { error } = await client.rpc("ai_budget_settle", {
    p_reservation_id: input.reservationId,
    p_actual_micro_usd: input.actualMicroUsd,
    p_actual_image_count: input.actualImageCount,
  });
  if (error) return { ok: false, code: "KMB-E901", detail: error.message };
  return { ok: true, value: undefined };
}

/** P5 ダッシュボード用: 当月の reserved/settled/上限 (tester 検証事項対応)。ai_budget_months は
 * RLS 直接アクセス不可のため admin 限定 RPC (ai_budget_get_current_month) 経由で取得する。 */
export async function getCurrentMonthBudget(client: SupabaseClient): Promise<Result<BudgetState>> {
  const { data, error } = await client.rpc("ai_budget_get_current_month");
  if (error) return { ok: false, code: "KMB-E901", detail: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as {
    month: string;
    reserved_micro_usd: number;
    settled_micro_usd: number;
    reserved_image_count: number;
    settled_image_count: number;
    budget_limit_micro_usd: number;
    image_limit: number;
  };
  return {
    ok: true,
    value: {
      month: row.month,
      reservedMicroUsd: row.reserved_micro_usd,
      settledMicroUsd: row.settled_micro_usd,
      reservedImageCount: row.reserved_image_count,
      settledImageCount: row.settled_image_count,
      budgetLimitMicroUsd: row.budget_limit_micro_usd,
      imageLimit: row.image_limit,
    },
  };
}

// ---------------------------------------------------------
// ai_image_generations / ai_image_generation_sources (P3: 画像生成カスケード系譜)
// ---------------------------------------------------------

export type ImageGenerationRow = {
  id: string;
  request_group_id: string;
  parent_id: string | null;
  root_id: string | null;
  prompt: string;
  provider: Provider;
  model: string;
  params: Record<string, unknown>;
  status: "pending" | "succeeded" | "failed";
  provider_interaction_id: string | null;
  media_id: string | null;
  is_selected: boolean;
  usage_log_id: string | null;
  error_code: string | null;
  created_at: string;
};

const IMAGE_GENERATION_SELECT =
  "id, request_group_id, parent_id, root_id, prompt, provider, model, params, status, provider_interaction_id, media_id, is_selected, usage_log_id, error_code, created_at";

export type InsertImageGenerationInput = {
  requestGroupId: string;
  /** null = 新規バッチ (ルート行)。非 null = カスケード先 */
  parentId: string | null;
  /**
   * parentId が null の場合は無視され、INSERT 後に自身の id で上書きされる
   * (オーケストレーター確定 2026-07-10: ルート行の root_id = 自身の id。null 扱いにしない)。
   * parentId が非 null の場合は親の root_id (常に非 null) をそのまま渡すこと。
   */
  rootId: string | null;
  prompt: string;
  provider: Provider;
  model: string;
  params: Record<string, unknown>;
  status: "pending" | "succeeded" | "failed";
  mediaId: string | null;
  usageLogId: string | null;
  errorCode: string | null;
};

/**
 * 1 行 INSERT。parentId が null (=新規バッチのルート行) の場合のみ、INSERT 直後に
 * root_id を自身の id へ UPDATE する (2 段構成。root_id は自己参照 FK のため INSERT 時点では
 * 自身の id を知り得ない)。子孫行 (parentId 非 null) は渡された rootId をそのまま保存し
 * 追加 UPDATE は行わない。
 */
export async function insertImageGenerationRow(
  client: SupabaseClient,
  input: InsertImageGenerationInput,
): Promise<Result<ImageGenerationRow>> {
  const { data, error } = await client
    .from("ai_image_generations")
    .insert({
      request_group_id: input.requestGroupId,
      parent_id: input.parentId,
      root_id: input.rootId,
      prompt: input.prompt,
      provider: input.provider,
      model: input.model,
      params: input.params,
      status: input.status,
      media_id: input.mediaId,
      usage_log_id: input.usageLogId,
      error_code: input.errorCode,
    })
    .select(IMAGE_GENERATION_SELECT)
    .single();
  if (error) return pgErrorToResult(error);
  let row = data as unknown as ImageGenerationRow;

  if (input.parentId === null) {
    // ルート規約 (オーケストレーター確定 2026-07-10): parent_id=null の行は root_id = 自身の id。
    // COALESCE(root_id, id) 分岐を呼び出し側に持たせないための自己参照確定 UPDATE。
    const { data: updated, error: updateError } = await client
      .from("ai_image_generations")
      .update({ root_id: row.id })
      .eq("id", row.id)
      .select(IMAGE_GENERATION_SELECT)
      .single();
    if (updateError) return pgErrorToResult(updateError);
    row = updated as unknown as ImageGenerationRow;
  }

  return { ok: true, value: row };
}

export async function insertImageGenerationSources(
  client: SupabaseClient,
  requestGroupId: string,
  mediaIds: string[],
): Promise<Result<void>> {
  if (mediaIds.length === 0) return { ok: true, value: undefined };
  const rows = mediaIds.map((mediaId, ord) => ({
    generation_group_id: requestGroupId,
    media_id: mediaId,
    ord,
  }));
  const { error } = await client.from("ai_image_generation_sources").insert(rows);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: undefined };
}

export async function getImageGenerationRow(
  client: SupabaseClient,
  id: string,
): Promise<Result<ImageGenerationRow | null>> {
  const { data, error } = await client
    .from("ai_image_generations")
    .select(IMAGE_GENERATION_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data as ImageGenerationRow | null) ?? null };
}

export async function markImageGenerationSelected(
  client: SupabaseClient,
  id: string,
  selected: boolean,
): Promise<Result<void>> {
  const { error } = await client.from("ai_image_generations").update({ is_selected: selected }).eq("id", id);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: undefined };
}

/**
 * ai_usage_log.ref_table/ref_id (監査列) で逆引きする。generateImageCascade は
 * requestGroupId を refId として generateImages に渡すため、生成直後にこの関数で
 * usage_log_id を取得し ai_image_generations.usage_log_id に書き戻せる
 * (バッチ複数枚が同一 usage ログを共有する設計。router.ts はレスポンスに usage_log_id を
 * 含めないため、この逆引きが唯一の取得経路)。
 */
export async function findUsageLogIdByRef(
  client: SupabaseClient,
  refTable: string,
  refId: string,
): Promise<Result<string | null>> {
  const { data, error } = await client
    .from("ai_usage_log")
    .select("id")
    .eq("ref_table", refTable)
    .eq("ref_id", refId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data as { id: string } | null)?.id ?? null };
}

// ---------------------------------------------------------
// ai-draft 掃除 cron (P3): ai_draft_cleanup_run RPC ラッパ (migration 20260710000016)
// ---------------------------------------------------------

export type AiDraftCleanupRow = { mediaId: string; storagePath: string };

/**
 * DB 側 (ai_draft_cleanup_run RPC) が候補の特定 + media 行の削除まで一括で行う
 * (tags @> ai-draft かつ ai_image_generations.is_selected=false かつ p_cutoff より古い
 * かつ他コンテンツ/カスケード参照ゼロ)。JS 側は返ってきた storage_path を使って
 * Storage オブジェクトを削除するのみ (service_role のみ実行可能。cron ワーカー専用)。
 */
export async function runAiDraftCleanup(
  serviceClient: SupabaseClient,
  cutoffIso: string,
): Promise<Result<AiDraftCleanupRow[]>> {
  const { data, error } = await serviceClient.rpc("ai_draft_cleanup_run", { p_cutoff: cutoffIso });
  if (error) return { ok: false, code: "KMB-E901", detail: error.message };
  const rows = (Array.isArray(data) ? data : []) as { media_id: string; storage_path: string }[];
  return { ok: true, value: rows.map((r) => ({ mediaId: r.media_id, storagePath: r.storage_path })) };
}

export { pgErrorToResult };
