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

export { pgErrorToResult };
