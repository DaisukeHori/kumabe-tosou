import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Result } from "@/modules/platform/contracts";
import type { KmbErrorCode } from "@/modules/platform/errors";

import { initialExternalRef } from "./internal/thread";
import type { XExternalRef } from "./contracts";
import { zXExternalRef } from "./contracts";

/**
 * distribution モジュールの repository (契約書 §1/§3)。
 * 所有テーブル: channel_posts, channel_accounts, style_profiles。
 *
 * channel_posts の RLS (migration 0002) は admin に SELECT + 「cancel 遷移のみ」の UPDATE しか
 * 許可しない (作成・状態遷移は service 専用。RLS ファイルの注記どおり)。そのため本 repository の
 * ほとんどの書込み関数は service client を要求する。channel_accounts / style_profiles は
 * admin 全権 (DELETE 除き) のため、admin セッション付き client でも書込み可能。
 */

// ---- 行の生の型 (DDL 1:1。cms-ai-pipeline.md §2.2) ----

export type ChannelPostRow = {
  id: string;
  draft_id: string;
  channel: string;
  status: string;
  scheduled_at: string;
  published_at: string | null;
  external_id: string | null;
  external_url: string | null;
  tweet_count: number | null;
  url_count: number | null;
  estimated_cost_cents: number;
  attempt_count: number;
  last_error_code: string | null;
  last_error_detail: string | null;
  note_draft_status: string;
  note_draft_url: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
};

export type ChannelAccountRow = {
  channel: string;
  account_label: string;
  auth_status: string;
  vault_secret_name: string | null;
  meta: Record<string, unknown>;
  connected_at: string | null;
  updated_at: string;
  token_refresh_lease_expires_at: string | null;
};

export type StyleProfileRow = {
  channel: string;
  tone_instructions: string;
  format_rules: string;
  example_output: string | null;
  updated_by: string | null;
  updated_at: string;
};

type PgError = { code?: string; message: string };

function pgErrorToResult(error: PgError): { ok: false; code: KmbErrorCode; detail: string } {
  if (error.code === "23505") return { ok: false, code: "KMB-E102", detail: error.message };
  if (error.code === "23503") {
    return { ok: false, code: "KMB-E101", detail: `参照先が存在しません: ${error.message}` };
  }
  if (error.code === "42501") return { ok: false, code: "KMB-E202", detail: error.message };
  return { ok: false, code: "KMB-E901", detail: error.message };
}

const CHANNEL_POST_SELECT =
  "id, draft_id, channel, status, scheduled_at, published_at, external_id, external_url, tweet_count, url_count, estimated_cost_cents, attempt_count, last_error_code, last_error_detail, note_draft_status, note_draft_url, idempotency_key, created_at, updated_at";

// ---------------------------------------------------------
// channel_posts: 読み取り
// ---------------------------------------------------------

export type ChannelPostListFilter = {
  status?: string;
  cursor: string | null;
  limit: number;
};

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt, id }), "utf-8").toString("base64url");
}

function decodeCursor(cursor: string | null): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf-8");
    const parsed = JSON.parse(json) as { createdAt?: string; id?: string };
    if (!parsed.createdAt || !parsed.id) return null;
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

/** admin 一覧 (キューの status filter + keyset ページネーション。設計書 §2.4) */
export async function listChannelPostsAdmin(
  client: SupabaseClient,
  filter: ChannelPostListFilter,
): Promise<Result<{ rows: ChannelPostRow[]; nextCursor: string | null }>> {
  let query = client
    .from("channel_posts")
    .select(CHANNEL_POST_SELECT)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(filter.limit + 1);

  if (filter.status) query = query.eq("status", filter.status);
  const cursor = decodeCursor(filter.cursor);
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) return pgErrorToResult(error);

  const rows = (data ?? []) as unknown as ChannelPostRow[];
  const hasMore = rows.length > filter.limit;
  const page = hasMore ? rows.slice(0, filter.limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.created_at, last.id) : null;
  return { ok: true, value: { rows: page, nextCursor } };
}

export async function getChannelPostById(
  client: SupabaseClient,
  id: string,
): Promise<Result<ChannelPostRow | null>> {
  const { data, error } = await client
    .from("channel_posts")
    .select(CHANNEL_POST_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data as ChannelPostRow | null) ?? null };
}

// ---------------------------------------------------------
// channel_posts: 作成 (service client 専用。RLS 上 admin INSERT ポリシーが無いため)
// ---------------------------------------------------------

export type InsertChannelPostInput = {
  draft_id: string;
  channel: string;
  status: "scheduled" | "manual_required";
  scheduled_at: string; // manual_required でも DDL 上 not null のため now() 相当を渡す
  tweet_count: number | null;
  url_count: number | null;
  estimated_cost_cents: number;
};

export async function insertChannelPost(
  serviceClient: SupabaseClient,
  input: InsertChannelPostInput,
): Promise<Result<ChannelPostRow>> {
  const { data, error } = await serviceClient
    .from("channel_posts")
    .insert({
      draft_id: input.draft_id,
      channel: input.channel,
      status: input.status,
      scheduled_at: input.scheduled_at,
      tweet_count: input.tweet_count,
      url_count: input.url_count,
      estimated_cost_cents: input.estimated_cost_cents,
    })
    .select(CHANNEL_POST_SELECT)
    .single();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: data as ChannelPostRow };
}

// ---------------------------------------------------------
// channel_posts: 状態遷移
// ---------------------------------------------------------

/** admin セッション付き client (RLS が cancel 遷移のみ許可)。scheduled → cancelled の CAS */
export async function cancelScheduledChannelPost(
  client: SupabaseClient,
  id: string,
): Promise<Result<boolean>> {
  const { data, error } = await client
    .from("channel_posts")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("status", "scheduled")
    .select("id")
    .maybeSingle();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: Boolean(data) };
}

/** failed → scheduled (手動リトライ。設計書 §4.3)。RLS 上 admin 不可のため service client 必須 */
export async function retryFailedToScheduled(
  serviceClient: SupabaseClient,
  id: string,
  scheduledAtIso: string,
): Promise<Result<boolean>> {
  const { data, error } = await serviceClient
    .from("channel_posts")
    .update({ status: "scheduled", scheduled_at: scheduledAtIso, last_error_code: null, last_error_detail: null })
    .eq("id", id)
    .eq("status", "failed")
    .select("id")
    .maybeSingle();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: Boolean(data) };
}

/** manual_required → published (人間照合: 投稿済み。note の markNotePublished もこれを使う) */
export async function resolveManualRequiredToPublished(
  serviceClient: SupabaseClient,
  id: string,
  externalUrl: string,
): Promise<Result<boolean>> {
  const { data, error } = await serviceClient
    .from("channel_posts")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      external_url: externalUrl,
    })
    .eq("id", id)
    .eq("status", "manual_required")
    .select("id")
    .maybeSingle();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: Boolean(data) };
}

/** manual_required → scheduled (人間照合: 未投稿だったので再スケジュール) */
export async function resolveManualRequiredToScheduled(
  serviceClient: SupabaseClient,
  id: string,
  scheduledAtIso: string,
): Promise<Result<boolean>> {
  const { data, error } = await serviceClient
    .from("channel_posts")
    .update({
      status: "scheduled",
      scheduled_at: scheduledAtIso,
      last_error_code: null,
      last_error_detail: null,
    })
    .eq("id", id)
    .eq("status", "manual_required")
    .select("id")
    .maybeSingle();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: Boolean(data) };
}

// ---------------------------------------------------------
// channel_posts: worker (CAS claim + 進捗更新 + 終端遷移)。すべて service client 専用。
// ---------------------------------------------------------

/**
 * 到来分の scheduled を CAS で publishing に取得する (契約書 §7.2)。
 * 「0 行なら他プロセスが既に処理中」を個別行ごとに判定するため、まず候補 id を LIMIT 付きで
 * 取得し、1 件ずつ CAS UPDATE する (affected rows=1 のみ進行)。
 */
export async function claimDueScheduledPosts(
  serviceClient: SupabaseClient,
  limit: number,
): Promise<Result<ChannelPostRow[]>> {
  const { data: candidates, error: selectError } = await serviceClient
    .from("channel_posts")
    .select("id")
    .eq("status", "scheduled")
    .lte("scheduled_at", new Date().toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(limit);
  if (selectError) return pgErrorToResult(selectError);

  const claimed: ChannelPostRow[] = [];
  for (const candidate of (candidates ?? []) as { id: string }[]) {
    const { data, error } = await serviceClient
      .from("channel_posts")
      .update({ status: "publishing" })
      .eq("id", candidate.id)
      .eq("status", "scheduled")
      .select(CHANNEL_POST_SELECT)
      .maybeSingle();
    if (error) return pgErrorToResult(error);
    if (data) {
      claimed.push(data as ChannelPostRow);
    }
  }

  // attempt_count のインクリメントは claim と分離 (RPC 無しで式インクリメントするため現在値+1 を渡す)
  for (const row of claimed) {
    await serviceClient.from("channel_posts").update({ attempt_count: row.attempt_count + 1 }).eq("id", row.id);
  }

  return { ok: true, value: claimed };
}

/** X スレッド投稿の進捗更新 (external_id に XExternalRef を JSON 保存) */
export async function updateXThreadProgress(
  serviceClient: SupabaseClient,
  id: string,
  ref: XExternalRef,
): Promise<Result<void>> {
  const { error } = await serviceClient
    .from("channel_posts")
    .update({ external_id: JSON.stringify(ref) })
    .eq("id", id);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: undefined };
}

/** external_id (X の場合 JSON、それ以外は生の文字列) をパースして XExternalRef を得る。無ければ初期値 */
export function parseXExternalRef(externalId: string | null): XExternalRef {
  if (!externalId) return initialExternalRef();
  try {
    const parsed = JSON.parse(externalId) as unknown;
    const result = zXExternalRef.safeParse(parsed);
    return result.success ? result.data : initialExternalRef();
  } catch {
    return initialExternalRef();
  }
}

export type MarkPublishedInput = { externalId: string; externalUrl: string | null };

export async function markPublished(
  serviceClient: SupabaseClient,
  id: string,
  input: MarkPublishedInput,
): Promise<Result<void>> {
  const { error } = await serviceClient
    .from("channel_posts")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      external_id: input.externalId,
      external_url: input.externalUrl,
    })
    .eq("id", id);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: undefined };
}

export type MarkFailureInput = { code: string; detail: string; externalId?: string | null };

export async function markFailed(
  serviceClient: SupabaseClient,
  id: string,
  input: MarkFailureInput,
): Promise<Result<void>> {
  const patch: Record<string, unknown> = {
    status: "failed",
    last_error_code: input.code,
    last_error_detail: input.detail,
  };
  if (input.externalId !== undefined) patch.external_id = input.externalId;
  const { error } = await serviceClient.from("channel_posts").update(patch).eq("id", id);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: undefined };
}

export async function markManualRequired(
  serviceClient: SupabaseClient,
  id: string,
  input: MarkFailureInput,
): Promise<Result<void>> {
  const patch: Record<string, unknown> = {
    status: "manual_required",
    last_error_code: input.code,
    last_error_detail: input.detail,
  };
  if (input.externalId !== undefined) patch.external_id = input.externalId;
  const { error } = await serviceClient.from("channel_posts").update(patch).eq("id", id);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: undefined };
}

/**
 * note 下書き作成の CAS 排他 (§8 MAJOR-3。実装レビューで発見・修正: CAS 無しで
 * `creating` へ更新してから note API を呼んでいたため、並列呼び出しが両方とも下書き一覧照合
 * (reconcile) に失敗した場合、同じ post の下書きを二重作成しうる不具合があった)。
 *
 * `none`/`failed`/`unknown` からのみ `creating` へ遷移させる。`creating` 自体は遷移元に含めない
 * — 既にこの状態なら「別プロセスが今まさに作成中」か「前回プロセスがクラッシュし成否未確定」の
 * いずれかであり、どちらであっても呼び出し元は新規作成を試行せず早期リターンすべきため
 * (facade.ts の createNoteDraft 参照)。
 *
 * 影響行数 0 (戻り値 false) は「既に他プロセスが creating に遷移済み (またはそれ以外の状態)」を
 * 意味する。status (manual_required 等) など note_draft_status/note_draft_url 以外のカラムは
 * 変更しない。service client 専用 (RLS 上 admin は cancel 遷移のみ許可のため)。
 */
export async function claimNoteDraftCreating(
  serviceClient: SupabaseClient,
  id: string,
): Promise<Result<boolean>> {
  const { data, error } = await serviceClient
    .from("channel_posts")
    .update({ note_draft_status: "creating", note_draft_url: null })
    .eq("id", id)
    .in("note_draft_status", ["none", "failed", "unknown"])
    .select("id")
    .maybeSingle();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: Boolean(data) };
}

/**
 * note 下書き自動作成の状態更新 (§8 MAJOR-3)。channel_posts.status (manual_required 等) は
 * 変更しない — note_draft_status/note_draft_url は独立の付加情報のため (既存の人間照合
 * フローに影響を与えない)。service client 専用 (RLS 上 admin は cancel 遷移のみ許可のため)。
 * `creating` への遷移自体は CAS が必要なため claimNoteDraftCreating を使うこと — 本関数は
 * created/failed/unknown (note API 呼び出し後の終端遷移) 専用。
 */
export async function updateNoteDraftStatus(
  serviceClient: SupabaseClient,
  id: string,
  status: "none" | "creating" | "created" | "unknown" | "failed",
  url: string | null,
): Promise<Result<void>> {
  const { error } = await serviceClient
    .from("channel_posts")
    .update({ note_draft_status: status, note_draft_url: url })
    .eq("id", id);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: undefined };
}

/** watchdog: publishing のまま停滞している行 (10 分超) を検出 */
export async function listStalePublishing(
  serviceClient: SupabaseClient,
  staleBeforeIso: string,
): Promise<Result<ChannelPostRow[]>> {
  const { data, error } = await serviceClient
    .from("channel_posts")
    .select(CHANNEL_POST_SELECT)
    .eq("status", "publishing")
    .lt("updated_at", staleBeforeIso);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data ?? []) as ChannelPostRow[] };
}

// ---------------------------------------------------------
// channel_posts: 課金ガード集計 (§8.2)
// ---------------------------------------------------------

const ACTIVE_COST_STATUSES = ["published", "publishing", "scheduled"] as const;

export async function getMonthlyXCostCentsSum(
  client: SupabaseClient,
  range: { startUtc: string; endUtc: string },
): Promise<Result<number>> {
  const { data, error } = await client
    .from("channel_posts")
    .select("estimated_cost_cents")
    .eq("channel", "x")
    .in("status", ACTIVE_COST_STATUSES as unknown as string[])
    .gte("scheduled_at", range.startUtc)
    .lt("scheduled_at", range.endUtc);
  if (error) return pgErrorToResult(error);
  const sum = ((data ?? []) as { estimated_cost_cents: number }[]).reduce(
    (acc, row) => acc + (row.estimated_cost_cents ?? 0),
    0,
  );
  return { ok: true, value: sum };
}

export async function getMonthlyXPostCount(
  client: SupabaseClient,
  range: { startUtc: string; endUtc: string },
): Promise<Result<number>> {
  const { count, error } = await client
    .from("channel_posts")
    .select("id", { count: "exact", head: true })
    .eq("channel", "x")
    .in("status", ACTIVE_COST_STATUSES as unknown as string[])
    .gte("scheduled_at", range.startUtc)
    .lt("scheduled_at", range.endUtc);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: count ?? 0 };
}

// ---------------------------------------------------------
// channel_accounts (admin 全権。settings と同じく admin セッション付き client でよい)
// ---------------------------------------------------------

const CHANNEL_ACCOUNT_SELECT =
  "channel, account_label, auth_status, vault_secret_name, meta, connected_at, updated_at, token_refresh_lease_expires_at";

export async function listChannelAccounts(client: SupabaseClient): Promise<Result<ChannelAccountRow[]>> {
  const { data, error } = await client.from("channel_accounts").select(CHANNEL_ACCOUNT_SELECT);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data ?? []) as ChannelAccountRow[] };
}

export async function getChannelAccount(
  client: SupabaseClient,
  channel: string,
): Promise<Result<ChannelAccountRow | null>> {
  const { data, error } = await client
    .from("channel_accounts")
    .select(CHANNEL_ACCOUNT_SELECT)
    .eq("channel", channel)
    .maybeSingle();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data as ChannelAccountRow | null) ?? null };
}

export type UpsertChannelAccountInput = {
  channel: string;
  account_label: string;
  auth_status: string;
  vault_secret_name: string | null;
  meta: Record<string, unknown>;
};

export async function upsertChannelAccount(
  client: SupabaseClient,
  input: UpsertChannelAccountInput,
): Promise<Result<void>> {
  const { error } = await client.from("channel_accounts").upsert(
    {
      channel: input.channel,
      account_label: input.account_label,
      auth_status: input.auth_status,
      vault_secret_name: input.vault_secret_name,
      meta: input.meta,
      connected_at: input.auth_status === "connected" ? new Date().toISOString() : undefined,
    },
    { onConflict: "channel" },
  );
  if (error) return pgErrorToResult(error);
  return { ok: true, value: undefined };
}

/** 401 受信時 / Meta 長期トークン延長失敗時 (service client。worker から呼ばれる) */
export async function markChannelAccountExpired(
  serviceClient: SupabaseClient,
  channel: string,
): Promise<Result<void>> {
  const { error } = await serviceClient
    .from("channel_accounts")
    .update({ auth_status: "expired" })
    .eq("channel", channel);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: undefined };
}

/** 期限切れ間近チャネルの scheduled 全件に last_error_code 警告を付与 (設計書 §4.4) */
export async function flagScheduledPostsForExpiredChannel(
  serviceClient: SupabaseClient,
  channel: string,
): Promise<Result<void>> {
  const { error } = await serviceClient
    .from("channel_posts")
    .update({ last_error_code: "KMB-E503", last_error_detail: "チャネルの接続トークンが失効しています" })
    .eq("channel", channel)
    .eq("status", "scheduled");
  if (error) return pgErrorToResult(error);
  return { ok: true, value: undefined };
}

/**
 * X refresh token ローテーションの単一実行制御 (CAS リース。ai_runs.lease_expires_at と同方式。
 * migration 20260708000009 の token_refresh_lease_expires_at を使用)。
 */
export async function claimTokenRefreshLease(
  serviceClient: SupabaseClient,
  channel: string,
  ttlMs: number,
): Promise<Result<boolean>> {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + ttlMs).toISOString();
  const { data, error } = await serviceClient
    .from("channel_accounts")
    .update({ token_refresh_lease_expires_at: leaseExpiresAt })
    .eq("channel", channel)
    .or(`token_refresh_lease_expires_at.is.null,token_refresh_lease_expires_at.lt.${now.toISOString()}`)
    .select("channel")
    .maybeSingle();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: Boolean(data) };
}

export async function releaseTokenRefreshLease(
  serviceClient: SupabaseClient,
  channel: string,
): Promise<Result<void>> {
  const { error } = await serviceClient
    .from("channel_accounts")
    .update({ token_refresh_lease_expires_at: null })
    .eq("channel", channel);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: undefined };
}

// ---------------------------------------------------------
// style_profiles (admin 全権)
// ---------------------------------------------------------

const STYLE_PROFILE_SELECT = "channel, tone_instructions, format_rules, example_output, updated_by, updated_at";

export async function getStyleProfile(
  client: SupabaseClient,
  channel: string,
): Promise<Result<StyleProfileRow | null>> {
  const { data, error } = await client
    .from("style_profiles")
    .select(STYLE_PROFILE_SELECT)
    .eq("channel", channel)
    .maybeSingle();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data as StyleProfileRow | null) ?? null };
}

/**
 * 全チャネル分をまとめて取得する (Issue #20: DistributionFacade.getStyleProfiles)。
 * DB に行が無いチャネルは結果に含まれない (facade 側で既定値とマージする)。
 */
export async function listStyleProfiles(client: SupabaseClient): Promise<Result<StyleProfileRow[]>> {
  const { data, error } = await client.from("style_profiles").select(STYLE_PROFILE_SELECT);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data ?? []) as StyleProfileRow[] };
}

export type UpsertStyleProfileInput = {
  channel: string;
  tone_instructions: string;
  format_rules: string;
  example_output: string | null;
  updated_by: string;
};

export async function upsertStyleProfile(
  client: SupabaseClient,
  input: UpsertStyleProfileInput,
): Promise<Result<void>> {
  const { error } = await client.from("style_profiles").upsert(
    {
      channel: input.channel,
      tone_instructions: input.tone_instructions,
      format_rules: input.format_rules,
      example_output: input.example_output,
      updated_by: input.updated_by,
    },
    { onConflict: "channel" },
  );
  if (error) return pgErrorToResult(error);
  return { ok: true, value: undefined };
}

// ---------------------------------------------------------
// Vault (service client 専用。設計書 §3.6)
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

export async function vaultReadSecret(
  serviceClient: SupabaseClient,
  name: string,
): Promise<Result<string | null>> {
  const { data, error } = await serviceClient.rpc("vault_read_secret", { p_name: name });
  if (error) return { ok: false, code: "KMB-E901", detail: error.message };
  return { ok: true, value: (data as string | null) ?? null };
}

export { pgErrorToResult };
