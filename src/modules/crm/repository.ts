import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Paged, Pagination, Result } from "@/modules/platform/contracts";
import { KMB_ERRORS, type KmbErrorCode } from "@/modules/platform/errors";

import type {
  ActivityType,
  CustomerLifecycle,
  DealStage,
  LeadSource,
  TaskOrigin,
  TaskStatus,
} from "./contracts";

/**
 * crm モジュールの repository。companies / customers / deals / activities / activity_links /
 * tasks への**唯一の**直接クエリ経路 (01-crm.md §1.1 — 00-overview §2.2「activities /
 * activity_links への直接クエリは crm repository のみ」を含め ESLint + レビューで強制)。
 * facade.ts のみがここを import する (facade 本体は #43)。
 *
 * client は用途に応じて admin セッション付き server client (session 実行) または
 * service_role client (service 実行) を facade が選んで渡す。どちらの client を使うかは
 * facade の責務であり、本ファイルは渡された client をそのまま使う (01-crm §1.1 依存規約)。
 *
 * 冪等 INSERT は全箇所 「INSERT → 23505 捕捉 → 既存行 SELECT」方式に統一する
 * (migration 20260711000023 §2.2 冒頭の設計原則: 対象 unique index は全て非部分一意
 * (WHERE 句なし) — NULLS DISTINCT により NULL キー行同士は衝突しない)。
 */

// ============================================================
// 共通: エラー写像・keyset カーソル
// ============================================================

type PgError = { code?: string; message: string };

const KMB_ERROR_CODE_RE = /KMB-E\d+/;

/**
 * PostgREST/RPC のエラーを Result.code に写像する。
 * 1. メッセージ先頭 (または途中) に埋め込まれた `KMB-Exxx` を最優先で拾う
 *    (crm_merge_customers RPC の raise exception も deals_guard_terminal_stage トリガの
 *    raise exception (§2.2) も同じ埋め込み規約 — replace_work_image 前例踏襲)。
 * 2. is_admin() ガード系 RPC の定型メッセージ ("permission denied: ...") は E202。
 * 3. Postgres エラーコードによる既定写像 (23505 一意制約違反 / 23503 FK違反 / 42501 RLS拒否)。
 * 4. 上記いずれにも該当しなければ E901。
 */
function pgErrorToResult(error: PgError): { ok: false; code: KmbErrorCode; detail: string } {
  const embedded = KMB_ERROR_CODE_RE.exec(error.message)?.[0];
  if (embedded && Object.prototype.hasOwnProperty.call(KMB_ERRORS, embedded)) {
    return { ok: false, code: embedded as KmbErrorCode, detail: error.message };
  }
  if (error.message.startsWith("permission denied")) {
    return { ok: false, code: "KMB-E202", detail: error.message };
  }
  if (error.code === "23505") {
    return { ok: false, code: "KMB-E102", detail: error.message };
  }
  if (error.code === "23503") {
    return { ok: false, code: "KMB-E101", detail: `参照先が存在しません: ${error.message}` };
  }
  if (error.code === "42501") {
    return { ok: false, code: "KMB-E202", detail: error.message };
  }
  return { ok: false, code: "KMB-E901", detail: error.message };
}

/** ILIKE パターン中のワイルドカード (`%`/`_`/`\`) をエスケープし、
 *  ILIKE を「大文字小文字を無視する完全一致」として使う (content/repository.ts の確立パターン踏襲)。 */
function escapeLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, (c) => `\\${c}`);
}

type CreatedAtCursor = { createdAt: string; id: string };

function encodeCreatedAtCursor(c: CreatedAtCursor): string {
  return Buffer.from(JSON.stringify(c), "utf-8").toString("base64url");
}

function decodeCreatedAtCursor(raw: string | null | undefined): CreatedAtCursor | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf-8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { createdAt?: unknown }).createdAt === "string" &&
      typeof (parsed as { id?: unknown }).id === "string"
    ) {
      return parsed as CreatedAtCursor;
    }
    return null;
  } catch {
    return null;
  }
}

function pageByCreatedAt<Row extends { created_at: string; id: string }>(
  rows: Row[],
  limit: number,
): Result<Paged<Row>> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last ? encodeCreatedAtCursor({ createdAt: last.created_at, id: last.id }) : null;
  return { ok: true, value: { items, next_cursor: nextCursor } };
}

type OccurredAtCursor = { occurredAt: string; id: string };

function encodeOccurredAtCursor(c: OccurredAtCursor): string {
  return Buffer.from(JSON.stringify(c), "utf-8").toString("base64url");
}

function decodeOccurredAtCursor(raw: string | null | undefined): OccurredAtCursor | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf-8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { occurredAt?: unknown }).occurredAt === "string" &&
      typeof (parsed as { id?: unknown }).id === "string"
    ) {
      return parsed as OccurredAtCursor;
    }
    return null;
  } catch {
    return null;
  }
}

function pageByOccurredAt<Row extends { occurred_at: string; id: string }>(
  rows: Row[],
  limit: number,
): Result<Paged<Row>> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last ? encodeOccurredAtCursor({ occurredAt: last.occurred_at, id: last.id }) : null;
  return { ok: true, value: { items, next_cursor: nextCursor } };
}

/**
 * CAS 付き UPDATE の共通実装 (companies/customers/deals/tasks — いずれも updated_at 列を持つ)。
 * 0 行応答は「不在」と「他者更新との競合」のどちらか区別が付かないため、追加で存在確認 1 回を
 * 行って E603 (不在) / E103 (CAS 不一致) を正確に判別する (facade §6.1/§6.2 のエラー列挙どおり)。
 */
async function updateRowWithCas<Row>(
  client: SupabaseClient,
  table: "companies" | "customers" | "deals" | "tasks",
  id: string,
  patch: Record<string, unknown>,
  expectedUpdatedAt: string,
): Promise<Result<Row>> {
  const { data, error } = await client
    .from(table)
    .update(patch)
    .eq("id", id)
    .eq("updated_at", expectedUpdatedAt)
    .select("*")
    .maybeSingle();
  if (error) return pgErrorToResult(error);
  if (data) return { ok: true, value: data as Row };

  const { data: existing, error: existErr } = await client
    .from(table)
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (existErr) return pgErrorToResult(existErr);
  if (!existing) {
    return { ok: false, code: "KMB-E603", detail: "対象が見つかりません。" };
  }
  return {
    ok: false,
    code: "KMB-E103",
    detail: "他の操作で更新されています。再読み込みしてやり直してください。",
  };
}

// ============================================================
// companies
// ============================================================

export type CompanyRow = {
  id: string;
  name: string;
  name_kana: string | null;
  tel_e164: string | null;
  address: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CompanyWriteInput = {
  name: string;
  name_kana: string | null;
  tel_e164: string | null;
  address: string | null;
  notes: string | null;
};

export async function createCompany(
  client: SupabaseClient,
  input: CompanyWriteInput,
  createdBy: string | null,
): Promise<Result<CompanyRow>> {
  const { data, error } = await client
    .from("companies")
    .insert({ ...input, created_by: createdBy })
    .select("*")
    .single();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: data as CompanyRow };
}

export async function getCompanyById(
  client: SupabaseClient,
  id: string,
): Promise<Result<CompanyRow | null>> {
  const { data, error } = await client.from("companies").select("*").eq("id", id).maybeSingle();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data as CompanyRow | null) ?? null };
}

export async function updateCompanyWithCas(
  client: SupabaseClient,
  id: string,
  input: CompanyWriteInput,
  expectedUpdatedAt: string,
): Promise<Result<CompanyRow>> {
  return updateRowWithCas<CompanyRow>(client, "companies", id, input, expectedUpdatedAt);
}

/** batch 取得 (getDealRefs/listCustomers/listDeals 等の N+1 回避)。空配列入力は ok([]) — IN 句を投げない。 */
export async function getCompaniesByIds(
  client: SupabaseClient,
  ids: string[],
): Promise<Result<CompanyRow[]>> {
  if (ids.length === 0) return { ok: true, value: [] };
  const { data, error } = await client.from("companies").select("*").in("id", ids);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data ?? []) as CompanyRow[] };
}

export type CompanyListQuery = { q: string | null };

export async function listCompaniesPage(
  client: SupabaseClient,
  filter: CompanyListQuery,
  pagination: Pagination,
): Promise<Result<Paged<CompanyRow>>> {
  let query = client
    .from("companies")
    .select("*")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pagination.limit + 1);

  if (filter.q) {
    const escaped = escapeLikePattern(filter.q);
    query = query.or(`name.ilike.%${escaped}%,name_kana.ilike.%${escaped}%`);
  }
  const cursor = decodeCreatedAtCursor(pagination.cursor);
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) return pgErrorToResult(error);
  return pageByCreatedAt((data ?? []) as CompanyRow[], pagination.limit);
}

// ============================================================
// customers
// ============================================================

export type CustomerRow = {
  id: string;
  kind: "person" | "company_contact";
  name: string;
  name_kana: string | null;
  email: string | null;
  tel_e164: string | null;
  company_id: string | null;
  address: string | null;
  notes: string | null;
  lifecycle: CustomerLifecycle;
  source: LeadSource;
  merged_into_customer_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CustomerWriteInput = {
  kind: "person" | "company_contact";
  name: string;
  name_kana: string | null;
  email: string | null;
  tel_e164: string | null;
  company_id: string | null;
  address: string | null;
  notes: string | null;
  lifecycle: CustomerLifecycle;
  source: LeadSource;
};

export async function createCustomer(
  client: SupabaseClient,
  input: CustomerWriteInput,
  createdBy: string | null,
): Promise<Result<CustomerRow>> {
  const { data, error } = await client
    .from("customers")
    .insert({ ...input, created_by: createdBy })
    .select("*")
    .single();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: data as CustomerRow };
}

export async function getCustomerById(
  client: SupabaseClient,
  id: string,
): Promise<Result<CustomerRow | null>> {
  const { data, error } = await client.from("customers").select("*").eq("id", id).maybeSingle();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data as CustomerRow | null) ?? null };
}

export type CustomerUpdatePatch = {
  kind: "person" | "company_contact";
  name: string;
  name_kana: string | null;
  email: string | null;
  tel_e164: string | null;
  company_id: string | null;
  address: string | null;
  notes: string | null;
  lifecycle: CustomerLifecycle;
};

export async function updateCustomerWithCas(
  client: SupabaseClient,
  id: string,
  input: CustomerUpdatePatch,
  expectedUpdatedAt: string,
): Promise<Result<CustomerRow>> {
  return updateRowWithCas<CustomerRow>(client, "customers", id, input, expectedUpdatedAt);
}

/** batch 取得 (getDealRefs 等)。空配列入力は ok([])。 */
export async function getCustomersByIds(
  client: SupabaseClient,
  ids: string[],
): Promise<Result<CustomerRow[]>> {
  if (ids.length === 0) return { ok: true, value: [] };
  const { data, error } = await client.from("customers").select("*").in("id", ids);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data ?? []) as CustomerRow[] };
}

export type CustomerListQuery = {
  q: string | null;
  lifecycle: CustomerLifecycle | "all" | "active";
  includeMerged: boolean;
};

export async function listCustomersPage(
  client: SupabaseClient,
  filter: CustomerListQuery,
  pagination: Pagination,
): Promise<Result<Paged<CustomerRow>>> {
  let query = client
    .from("customers")
    .select("*")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pagination.limit + 1);

  if (filter.lifecycle === "active") {
    query = query.in("lifecycle", ["lead", "customer"]);
  } else if (filter.lifecycle !== "all") {
    query = query.eq("lifecycle", filter.lifecycle);
  }
  if (!filter.includeMerged) {
    query = query.is("merged_into_customer_id", null);
  }
  if (filter.q) {
    const escaped = escapeLikePattern(filter.q);
    query = query.or(
      `name.ilike.%${escaped}%,name_kana.ilike.%${escaped}%,email.ilike.%${escaped}%,tel_e164.ilike.%${escaped}%`,
    );
  }
  const cursor = decodeCreatedAtCursor(pagination.cursor);
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) return pgErrorToResult(error);
  return pageByCreatedAt((data ?? []) as CustomerRow[], pagination.limit);
}

// ---- 重複検索 (§6.3) + マージポインタ終端解決 ----

/**
 * マージ済みポインタの 1 hop ぶんの解決者。テスト容易性のため DB 呼び出しを注入可能にする
 * (`resolveMergedCustomerId` 自体は純関数 — plain な async 関数を渡せば DB なしで単体テストできる)。
 * 戻り値: 次のポインタ (`merged_into_customer_id`)。null = 終端 (もう転送先がない)。
 */
export type MergePointerLookup = (customerId: string) => Promise<string | null>;

/** §6.3「上限 5 hop」— 循環は customers_no_self_merge / マージ済み再マージ禁止で構造上発生しないが防御的に打ち切る */
export const MAX_MERGE_HOPS = 5;

export async function resolveMergedCustomerId(
  lookup: MergePointerLookup,
  customerId: string,
): Promise<string> {
  let current = customerId;
  for (let hop = 0; hop < MAX_MERGE_HOPS; hop++) {
    const next = await lookup(current);
    if (next === null) return current;
    current = next;
  }
  return current;
}

/**
 * `resolveMergedCustomerId` の Result 版 (facade / internal 向け公開ヘルパ)。
 * `makeSupabaseMergePointerLookup` は DB エラー時に例外 (`MergePointerLookupError`、本ファイル
 * 非公開) を投げる設計のため、外部呼び出し元は素の `resolveMergedCustomerId` を直接使えない
 * (例外を catch して判別する術がない)。本関数がその try/catch を一箇所に集約する
 * (facade.ts の getCustomerRef/getDealRef/appendActivity リンク解決・relinkActivity・
 * internal/intake.ts の補修モードなど、複数の利用点が個別に hop ループを再実装しないための共通経路)。
 * 対象顧客が存在しない場合は KMB-E603 を返す (§6.3 手順3 と同じ扱い)。
 */
export async function resolveMergedCustomerIdSafe(
  client: SupabaseClient,
  customerId: string,
): Promise<Result<string>> {
  let current = customerId;
  for (let hop = 0; hop < MAX_MERGE_HOPS; hop++) {
    const row = await getCustomerById(client, current);
    if (!row.ok) return row;
    if (!row.value) return { ok: false, code: "KMB-E603", detail: `顧客が見つかりません: ${current}` };
    if (row.value.merged_into_customer_id === null) return { ok: true, value: current };
    current = row.value.merged_into_customer_id;
  }
  return { ok: true, value: current };
}

/**
 * makeSupabaseMergePointerLookup が DB エラー時に投げる印。`lookup(id)` の戻り値が
 * `null` (=「転送ポインタなし・終端」) の場合と、DB 呼び出し自体が失敗した場合を必ず区別する
 * ため専用の Error を投げる — 区別せず両方を `null` として扱うと、DB 一時障害時に
 * まだ解決されていないマージ敗者行がそのまま重複候補として提示されてしまう (敵対レビュー指摘)。
 * `resolveMergedCustomerId` は素通しするだけなので、呼び出し元 (findDuplicateCandidates) が
 * 必ず catch して Result.ok=false に変換すること (例外がモジュール境界を越えないよう
 * platform/contracts.ts の Result<T> 規約を守る)。
 */
class MergePointerLookupError extends Error {
  constructor(public readonly result: { ok: false; code: KmbErrorCode; detail: string }) {
    super(result.detail);
  }
}

/** repository 用の Supabase 実装 (customers.merged_into_customer_id を 1 行ずつ引く)。
 *  DB エラー発生時は `MergePointerLookupError` を throw する (上記コメント参照) — 呼び出し元は
 *  必ず catch すること。行が存在しない (data null かつ error null) 場合のみ `null` (終端) を返す。 */
export function makeSupabaseMergePointerLookup(client: SupabaseClient): MergePointerLookup {
  return async (customerId) => {
    const { data, error } = await client
      .from("customers")
      .select("merged_into_customer_id")
      .eq("id", customerId)
      .maybeSingle();
    if (error) throw new MergePointerLookupError(pgErrorToResult(error));
    if (!data) return null;
    return (data as { merged_into_customer_id: string | null }).merged_into_customer_id;
  };
}

export type CustomerDuplicateCandidate = {
  customer_id: string;
  name: string;
  lifecycle: CustomerLifecycle;
  matched_by: "email" | "tel" | "both";
};

/**
 * §6.3 手順 4 (dedupe) の純関数部。終端解決・名寄せ済みの行を id で集約する
 * (同一顧客が email/tel 両方でヒットしたら matched_by:'both' に統合)。DB を叩かないため
 * 単体テストは本関数へ直接プレーンなオブジェクトを渡して検証できる。
 */
export function dedupeCandidates(
  rows: Array<{
    resolvedId: string;
    name: string;
    lifecycle: CustomerLifecycle;
    matchedBy: "email" | "tel";
  }>,
): CustomerDuplicateCandidate[] {
  const byId = new Map<string, CustomerDuplicateCandidate>();
  for (const row of rows) {
    const existing = byId.get(row.resolvedId);
    if (existing) {
      if (existing.matched_by !== row.matchedBy) existing.matched_by = "both";
      continue;
    }
    byId.set(row.resolvedId, {
      customer_id: row.resolvedId,
      name: row.name,
      lifecycle: row.lifecycle,
      matched_by: row.matchedBy,
    });
  }
  return [...byId.values()];
}

type DuplicateSearchRow = {
  id: string;
  name: string;
  lifecycle: CustomerLifecycle;
  merged_into_customer_id: string | null;
};

/**
 * §6.3 dedup アルゴリズム全文。
 * 母集団: customers 全行 (archived・マージ敗者含む、除外しない — v1.1 是正の理由は §6.3 冒頭コメント参照)。
 * email(lower 一致・ILIKE エスケープ済み完全一致) / tel_e164 (完全一致) で検索し、
 * マージ敗者行は終端解決して勝者の現行情報 (id/name/lifecycle) に置換してから返す
 * (「敗者行自身は候補として提示しない」— §6.3 手順 3)。
 */
export async function findDuplicateCandidates(
  client: SupabaseClient,
  email: string | null,
  telE164: string | null,
): Promise<Result<CustomerDuplicateCandidate[]>> {
  if (email === null && telE164 === null) return { ok: true, value: [] };

  const matches: Array<{ row: DuplicateSearchRow; matchedBy: "email" | "tel" }> = [];

  if (email !== null) {
    const { data, error } = await client
      .from("customers")
      .select("id, name, lifecycle, merged_into_customer_id")
      .ilike("email", escapeLikePattern(email));
    if (error) return pgErrorToResult(error);
    for (const row of (data ?? []) as DuplicateSearchRow[]) {
      matches.push({ row, matchedBy: "email" });
    }
  }
  if (telE164 !== null) {
    const { data, error } = await client
      .from("customers")
      .select("id, name, lifecycle, merged_into_customer_id")
      .eq("tel_e164", telE164);
    if (error) return pgErrorToResult(error);
    for (const row of (data ?? []) as DuplicateSearchRow[]) {
      matches.push({ row, matchedBy: "tel" });
    }
  }

  const lookup = makeSupabaseMergePointerLookup(client);
  const resolved: Array<{
    resolvedId: string;
    name: string;
    lifecycle: CustomerLifecycle;
    matchedBy: "email" | "tel";
  }> = [];

  for (const { row, matchedBy } of matches) {
    if (row.merged_into_customer_id === null) {
      resolved.push({ resolvedId: row.id, name: row.name, lifecycle: row.lifecycle, matchedBy });
      continue;
    }
    let resolvedId: string;
    try {
      resolvedId = await resolveMergedCustomerId(lookup, row.id);
    } catch (e) {
      // makeSupabaseMergePointerLookup が DB エラーで投げた印。「終端 (転送ポインタなし)」への
      // 誤フォールバックを防ぐため、ここで確実に捕捉して Result.ok=false へ変換する
      // (例外をモジュール境界の外へ出さない — 上記 MergePointerLookupError のコメント参照)。
      if (e instanceof MergePointerLookupError) return e.result;
      throw e;
    }
    if (resolvedId === row.id) {
      // 終端解決できなかった (上限打ち切り等) — 元行の情報のままフォールバック
      resolved.push({ resolvedId, name: row.name, lifecycle: row.lifecycle, matchedBy });
      continue;
    }
    const winner = await getCustomerById(client, resolvedId);
    // winner.ok=false (RLS拒否/瞬断等の真の DB エラー) を winner.value=null (行不在) と
    // 区別せず無言フォールバックすると、DB エラー時に敗者行の古い name/lifecycle を
    // あたかも正常な重複候補として返してしまう (敵対レビュー指摘)。
    // エラーはそのまま呼び出し元へ伝播する — 握り潰さない。
    if (!winner.ok) return winner;
    if (winner.value) {
      resolved.push({
        resolvedId,
        name: winner.value.name,
        lifecycle: winner.value.lifecycle,
        matchedBy,
      });
    } else {
      // resolvedId は resolveMergedCustomerId が終端解決した id であり、FK 制約上
      // customers に実在するはずで構造上 null にはならないが、防御的にフォールバックする。
      resolved.push({ resolvedId, name: row.name, lifecycle: row.lifecycle, matchedBy });
    }
  }

  return { ok: true, value: dedupeCandidates(resolved) };
}

// ---- マージ RPC ラッパ (§6.4) ----

export async function mergeCustomers(
  client: SupabaseClient,
  winnerId: string,
  loserId: string,
  expectedWinnerUpdatedAt: string,
): Promise<Result<void>> {
  const { error } = await client.rpc("crm_merge_customers", {
    p_winner_id: winnerId,
    p_loser_id: loserId,
    p_expected_winner_updated_at: expectedWinnerUpdatedAt,
  });
  if (error) return pgErrorToResult(error);
  return { ok: true, value: undefined };
}

// ============================================================
// deals
// ============================================================

export type DealRow = {
  id: string;
  title: string;
  customer_id: string;
  company_id: string | null;
  pipeline: "default";
  stage: DealStage;
  amount_jpy: number | null;
  expected_close_on: string | null;
  won_at: string | null;
  lost_reason: string | null;
  source: LeadSource;
  source_inquiry_id: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type DealCreateInput = {
  title: string;
  customer_id: string;
  company_id: string | null;
  stage: DealStage;
  amount_jpy: number | null;
  expected_close_on: string | null;
  source: LeadSource;
  source_inquiry_id: string | null;
  notes: string | null;
};

export async function createDeal(
  client: SupabaseClient,
  input: DealCreateInput,
  createdBy: string | null,
): Promise<Result<DealRow>> {
  const { data, error } = await client
    .from("deals")
    .insert({ ...input, pipeline: "default", created_by: createdBy })
    .select("*")
    .single();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: data as DealRow };
}

/**
 * 取込 (intakeFromInquiry/intakeFromSimulator §6.5 手順 3) の冪等 deal 作成。
 * source_inquiry_id の一意 index (非部分 — §2.2 冒頭) を用い、INSERT → 23505 捕捉 →
 * 既存行 SELECT で回収する。
 */
export async function createDealIdempotentBySourceInquiry(
  client: SupabaseClient,
  input: DealCreateInput & { source_inquiry_id: string },
  createdBy: string | null,
): Promise<Result<{ row: DealRow; created: boolean }>> {
  const { data, error } = await client
    .from("deals")
    .insert({ ...input, pipeline: "default", created_by: createdBy })
    .select("*")
    .single();
  if (!error) return { ok: true, value: { row: data as DealRow, created: true } };

  if (error.code === "23505") {
    const { data: existing, error: selErr } = await client
      .from("deals")
      .select("*")
      .eq("source_inquiry_id", input.source_inquiry_id)
      .maybeSingle();
    if (selErr) return pgErrorToResult(selErr);
    if (existing) return { ok: true, value: { row: existing as DealRow, created: false } };
  }
  return pgErrorToResult(error);
}

export async function getDealById(
  client: SupabaseClient,
  id: string,
): Promise<Result<DealRow | null>> {
  const { data, error } = await client.from("deals").select("*").eq("id", id).maybeSingle();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data as DealRow | null) ?? null };
}

/**
 * deals の CAS 付き部分更新。stage を含む patch を渡した場合、DB トリガ
 * `deals_guard_terminal_stage` (migration 20260711000023) が終端ステージからの変更を
 * KMB-E602 で拒否する (アプリ層のステージ遷移ガードは facade #43 の internal/stage-machine.ts が
 * 第一防御。本関数は DB 制約を含めた二重防御の実行経路)。
 */
export type DealUpdatePatch = Partial<{
  title: string;
  company_id: string | null;
  amount_jpy: number | null;
  expected_close_on: string | null;
  notes: string | null;
  stage: DealStage;
  won_at: string | null;
  lost_reason: string | null;
}>;

export async function updateDealWithCas(
  client: SupabaseClient,
  id: string,
  patch: DealUpdatePatch,
  expectedUpdatedAt: string,
): Promise<Result<DealRow>> {
  return updateRowWithCas<DealRow>(client, "deals", id, patch, expectedUpdatedAt);
}

/** batch 取得 (getDealRefs — 02-sales listDocuments の N+1 回避)。空配列入力は ok([])。不在 id は結果から除外。 */
export async function getDealsByIds(client: SupabaseClient, ids: string[]): Promise<Result<DealRow[]>> {
  if (ids.length === 0) return { ok: true, value: [] };
  const { data, error } = await client.from("deals").select("*").in("id", ids);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data ?? []) as DealRow[] };
}

export type DealListQuery = { q: string | null; stage: DealStage | "all" | "open" };

/** 非終端 7 ステージ (§4.2)。facade #43 の集計 (open_deal_count / KPI / カンバン列) も共用する。 */
export const NON_TERMINAL_STAGES: DealStage[] = [
  "inquiry",
  "estimating",
  "quote_sent",
  "ordered",
  "in_production",
  "delivered",
  "invoiced",
];

export async function listDealsPage(
  client: SupabaseClient,
  filter: DealListQuery,
  pagination: Pagination,
): Promise<Result<Paged<DealRow>>> {
  let query = client
    .from("deals")
    .select("*")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pagination.limit + 1);

  if (filter.stage === "open") {
    query = query.in("stage", NON_TERMINAL_STAGES);
  } else if (filter.stage === "all") {
    // 絞り込みなし
  } else {
    query = query.eq("stage", filter.stage);
  }
  if (filter.q) {
    const escaped = escapeLikePattern(filter.q);
    query = query.ilike("title", `%${escaped}%`);
  }
  const cursor = decodeCreatedAtCursor(pagination.cursor);
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) return pgErrorToResult(error);
  return pageByCreatedAt((data ?? []) as DealRow[], pagination.limit);
}

/** カンバン列用の生集計 (§8.3)。probability を掛けた加重合計は registry を持つ facade/コード側の責務。 */
export async function listDealsByStage(
  client: SupabaseClient,
  stage: DealStage,
  limit: number | null,
): Promise<Result<DealRow[]>> {
  let query = client
    .from("deals")
    .select("*")
    .eq("stage", stage)
    .order("created_at", { ascending: false });
  if (limit !== null) query = query.limit(limit);
  const { data, error } = await query;
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data ?? []) as DealRow[] };
}

export async function findDealBySourceInquiry(
  client: SupabaseClient,
  inquiryId: string,
): Promise<Result<{ deal_id: string } | null>> {
  const { data, error } = await client
    .from("deals")
    .select("id")
    .eq("source_inquiry_id", inquiryId)
    .maybeSingle();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: data ? { deal_id: (data as { id: string }).id } : null };
}

// ============================================================
// activities
// ============================================================

export type ActivityRow = {
  id: string;
  activity_type: ActivityType;
  occurred_at: string;
  title: string;
  body: string | null;
  payload: unknown;
  ref_table: string | null;
  ref_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ActivityCreateInput = {
  activity_type: ActivityType;
  occurred_at: string;
  title: string;
  body: string | null;
  payload: unknown;
  ref_table: string | null;
  ref_id: string | null;
};

/**
 * activities への冪等 INSERT (§6.6 手順 5)。ref_id が非 NULL の場合のみ
 * (activity_type, ref_table, ref_id) の一意 index (`activities_ref_idem_uniq`) で冪等になる
 * (activities_ref_pair 制約により ref_id 非 NULL ⇒ ref_table も非 NULL)。ref_id が NULL
 * (note 等) は常に新規行を作る (NULLS DISTINCT — 重複挿入可、§2.2 冒頭)。
 */
export async function appendActivityRow(
  client: SupabaseClient,
  input: ActivityCreateInput,
  createdBy: string | null,
): Promise<Result<{ row: ActivityRow; created: boolean }>> {
  const { data, error } = await client
    .from("activities")
    .insert({ ...input, created_by: createdBy })
    .select("*")
    .single();
  if (!error) return { ok: true, value: { row: data as ActivityRow, created: true } };

  if (error.code === "23505" && input.ref_id !== null && input.ref_table !== null) {
    const { data: existing, error: selErr } = await client
      .from("activities")
      .select("*")
      .eq("activity_type", input.activity_type)
      .eq("ref_table", input.ref_table)
      .eq("ref_id", input.ref_id)
      .maybeSingle();
    if (selErr) return pgErrorToResult(selErr);
    if (existing) return { ok: true, value: { row: existing as ActivityRow, created: false } };
  }
  return pgErrorToResult(error);
}

export async function getActivityById(
  client: SupabaseClient,
  id: string,
): Promise<Result<ActivityRow | null>> {
  const { data, error } = await client.from("activities").select("*").eq("id", id).maybeSingle();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data as ActivityRow | null) ?? null };
}

/**
 * (activity_type, ref_table, ref_id) の存在確認 (INSERT を伴わない純粋な SELECT)。
 * §6.5 手順 1 の冪等マーカー確認 (intake.ts) が使う — appendActivityRow の冪等 upsert とは別に、
 * 「マーカーが既にあるか (=補修モードに入るべきか)」を INSERT せず判定する必要があるための専用関数。
 */
export async function findActivityByTypeRef(
  client: SupabaseClient,
  activityType: ActivityType,
  refTable: string,
  refId: string,
): Promise<Result<ActivityRow | null>> {
  const { data, error } = await client
    .from("activities")
    .select("*")
    .eq("activity_type", activityType)
    .eq("ref_table", refTable)
    .eq("ref_id", refId)
    .maybeSingle();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data as ActivityRow | null) ?? null };
}

/** note のみ編集可 (§4.4)。編集可否の判定は呼び出し元 (facade) の責務 — RLS も二重で拒否する */
export type NoteUpdatePatch = { title: string; body: string | null; occurred_at: string };

export async function updateNoteActivity(
  client: SupabaseClient,
  id: string,
  patch: NoteUpdatePatch,
  expectedUpdatedAt: string,
): Promise<Result<ActivityRow>> {
  const { data, error } = await client
    .from("activities")
    .update(patch)
    .eq("id", id)
    .eq("updated_at", expectedUpdatedAt)
    .select("*")
    .maybeSingle();
  if (error) return pgErrorToResult(error);
  if (data) return { ok: true, value: data as ActivityRow };

  const { data: existing, error: existErr } = await client
    .from("activities")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (existErr) return pgErrorToResult(existErr);
  if (!existing) return { ok: false, code: "KMB-E603", detail: "対象の記録が見つかりません。" };
  return {
    ok: false,
    code: "KMB-E103",
    detail: "他の操作で更新されています。再読み込みしてやり直してください。",
  };
}

export async function deleteNoteActivity(
  client: SupabaseClient,
  id: string,
): Promise<Result<void>> {
  const { data, error } = await client.from("activities").delete().eq("id", id).select("id");
  if (error) return pgErrorToResult(error);
  if (data && data.length > 0) return { ok: true, value: undefined };

  // 0 行応答は「不在」と「activity_type != 'note' で RLS (activities_admin_delete) が対象外に
  // した」のどちらか区別が付かない (DELETE が RLS に絞られてもエラーにはならない) ため、
  // updateRowWithCas と同型の存在確認を追加して両者を切り分ける。
  const { data: existing, error: existErr } = await client
    .from("activities")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (existErr) return pgErrorToResult(existErr);
  if (!existing) return { ok: false, code: "KMB-E603", detail: "対象の記録が見つかりません。" };
  return {
    ok: false,
    code: "KMB-E605",
    detail: "この記録は削除できません (メモのみ削除可)。",
  };
}

export type TimelineTargetColumn = "customer_id" | "company_id" | "deal_id";

/** タイムライン取得 (occurred_at, id) desc keyset — activity_links を inner join して対象で絞る (§8.5) */
export async function listTimelinePage(
  client: SupabaseClient,
  targetColumn: TimelineTargetColumn,
  targetId: string,
  pagination: { cursor: string | null; limit: number },
): Promise<Result<Paged<ActivityRow>>> {
  let query = client
    .from("activities")
    .select(`*, activity_links!inner(${targetColumn})`)
    .eq(`activity_links.${targetColumn}`, targetId)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pagination.limit + 1);

  const cursor = decodeOccurredAtCursor(pagination.cursor);
  if (cursor) {
    query = query.or(
      `occurred_at.lt.${cursor.occurredAt},and(occurred_at.eq.${cursor.occurredAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) return pgErrorToResult(error);
  const rows = ((data ?? []) as unknown as Array<ActivityRow & { activity_links: unknown }>).map(
    (row): ActivityRow => ({
      id: row.id,
      activity_type: row.activity_type,
      occurred_at: row.occurred_at,
      title: row.title,
      body: row.body,
      payload: row.payload,
      ref_table: row.ref_table,
      ref_id: row.ref_id,
      created_by: row.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }),
  );
  return pageByOccurredAt(rows, pagination.limit);
}

// ============================================================
// activity_links
// ============================================================

export type ActivityLinkRow = {
  id: string;
  activity_id: string;
  customer_id: string | null;
  company_id: string | null;
  deal_id: string | null;
  created_at: string;
};

/** 対象は厳密に 1 つ (num_nonnulls=1 — DDL constraint activity_links_one_target と同型) */
export type ActivityLinkTarget =
  | { customer_id: string; company_id: null; deal_id: null }
  | { customer_id: null; company_id: string; deal_id: null }
  | { customer_id: null; company_id: null; deal_id: string };

/**
 * activity_links への冪等 INSERT (§6.6 手順 6)。target の非 NULL 列に応じて
 * activity_links_customer_uniq / _company_uniq / _deal_uniq のいずれかで冪等になる。
 */
export async function linkActivityRow(
  client: SupabaseClient,
  activityId: string,
  target: ActivityLinkTarget,
): Promise<Result<{ row: ActivityLinkRow; created: boolean }>> {
  const { data, error } = await client
    .from("activity_links")
    .insert({ activity_id: activityId, ...target })
    .select("*")
    .single();
  if (!error) return { ok: true, value: { row: data as ActivityLinkRow, created: true } };

  if (error.code === "23505") {
    let query = client.from("activity_links").select("*").eq("activity_id", activityId);
    if (target.customer_id !== null) query = query.eq("customer_id", target.customer_id);
    else if (target.company_id !== null) query = query.eq("company_id", target.company_id);
    else query = query.eq("deal_id", target.deal_id);
    const { data: existing, error: selErr } = await query.maybeSingle();
    if (selErr) return pgErrorToResult(selErr);
    if (existing) return { ok: true, value: { row: existing as ActivityLinkRow, created: false } };
  }
  return pgErrorToResult(error);
}

export async function listActivityLinksByActivity(
  client: SupabaseClient,
  activityId: string,
): Promise<Result<ActivityLinkRow[]>> {
  const { data, error } = await client
    .from("activity_links")
    .select("*")
    .eq("activity_id", activityId);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data ?? []) as ActivityLinkRow[] };
}

/** relinkActivity (§6.7) の「全置換」の DELETE 半分。service client での実行が前提 (§6.7 手順 4) */
export async function deleteActivityLinksByActivity(
  client: SupabaseClient,
  activityId: string,
): Promise<Result<void>> {
  const { data, error } = await client
    .from("activity_links")
    .delete()
    .eq("activity_id", activityId)
    .select("id");
  if (error) return pgErrorToResult(error);
  if (data && data.length > 0) return { ok: true, value: undefined };

  // 0 行応答は「元々リンクが無い (正常。新規 note 等)」と「note 以外で RLS
  // (activity_links_admin_delete) が対象外にした」のどちらか区別が付かないため、残存確認を
  // 追加する。残存 0 件なら削除対象自体が無かった (冪等に成功扱い)、残存ありなら削除が
  // RLS に阻まれたとみなし呼び出し元に伝播する (relinkActivity は service client 前提だが、
  // 誤って session client が渡された場合の二重防御)。
  const { data: remaining, error: remainingErr } = await client
    .from("activity_links")
    .select("id")
    .eq("activity_id", activityId)
    .limit(1);
  if (remainingErr) return pgErrorToResult(remainingErr);
  if (!remaining || remaining.length === 0) return { ok: true, value: undefined };
  return {
    ok: false,
    code: "KMB-E605",
    detail: "このリンクは削除できません (メモのみ削除可)。",
  };
}

// ============================================================
// tasks
// ============================================================

export type TaskRow = {
  id: string;
  title: string;
  body: string | null;
  due_on: string | null;
  status: TaskStatus;
  origin: TaskOrigin;
  deal_id: string | null;
  customer_id: string | null;
  source_activity_id: string | null;
  completed_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskCreateInput = {
  title: string;
  body: string | null;
  due_on: string | null;
  deal_id: string | null;
  customer_id: string | null;
  origin: TaskOrigin;
  source_activity_id: string | null;
};

/**
 * tasks への冪等 INSERT (07-contracts-delta v1.1 裁定 #10)。source_activity_id が非 NULL の
 * 場合のみ (source_activity_id, title) の一意 index (`tasks_source_activity_title_key`) で
 * 冪等になる。呼び出し元は title を再試行間で安定させること (01-crm §6.1 補足)。
 */
export async function createTaskRow(
  client: SupabaseClient,
  input: TaskCreateInput,
  createdBy: string | null,
): Promise<Result<{ row: TaskRow; created: boolean }>> {
  const { data, error } = await client
    .from("tasks")
    .insert({ ...input, created_by: createdBy })
    .select("*")
    .single();
  if (!error) return { ok: true, value: { row: data as TaskRow, created: true } };

  if (error.code === "23505" && input.source_activity_id !== null) {
    const { data: existing, error: selErr } = await client
      .from("tasks")
      .select("*")
      .eq("source_activity_id", input.source_activity_id)
      .eq("title", input.title)
      .maybeSingle();
    if (selErr) return pgErrorToResult(selErr);
    if (existing) return { ok: true, value: { row: existing as TaskRow, created: false } };
  }
  return pgErrorToResult(error);
}

export async function getTaskById(
  client: SupabaseClient,
  id: string,
): Promise<Result<TaskRow | null>> {
  const { data, error } = await client.from("tasks").select("*").eq("id", id).maybeSingle();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data as TaskRow | null) ?? null };
}

export type TaskUpdatePatch = Partial<{
  title: string;
  body: string | null;
  due_on: string | null;
  deal_id: string | null;
  customer_id: string | null;
  status: TaskStatus;
  completed_at: string | null;
}>;

export async function updateTaskWithCas(
  client: SupabaseClient,
  id: string,
  patch: TaskUpdatePatch,
  expectedUpdatedAt: string,
): Promise<Result<TaskRow>> {
  return updateRowWithCas<TaskRow>(client, "tasks", id, patch, expectedUpdatedAt);
}

export type TaskListQuery = {
  status: TaskStatus | "all";
  /** JST 境界の計算は facade #43 の internal/jst.ts が担う (00-overview 規約により repository
   *  は生の date 文字列 (YYYY-MM-DD) を受け取るだけで JST/UTC 変換ロジックを持たない)。 */
  dueOnFrom: string | null;
  dueOnTo: string | null;
  dueOnIsNull: boolean | null;
};

export async function listTasksPage(
  client: SupabaseClient,
  filter: TaskListQuery,
  pagination: Pagination,
): Promise<Result<Paged<TaskRow>>> {
  let query = client
    .from("tasks")
    .select("*")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pagination.limit + 1);

  if (filter.status !== "all") query = query.eq("status", filter.status);
  if (filter.dueOnFrom !== null) query = query.gte("due_on", filter.dueOnFrom);
  if (filter.dueOnTo !== null) query = query.lte("due_on", filter.dueOnTo);
  if (filter.dueOnIsNull === true) query = query.is("due_on", null);
  else if (filter.dueOnIsNull === false) query = query.not("due_on", "is", null);

  const cursor = decodeCreatedAtCursor(pagination.cursor);
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) return pgErrorToResult(error);
  return pageByCreatedAt((data ?? []) as TaskRow[], pagination.limit);
}

export async function findTaskBySourceActivity(
  client: SupabaseClient,
  sourceActivityId: string,
): Promise<Result<TaskRow[]>> {
  const { data, error } = await client
    .from("tasks")
    .select("*")
    .eq("source_activity_id", sourceActivityId);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data ?? []) as TaskRow[] };
}

// ============================================================
// facade #43 向け追加分: バッチ join・集計
// (repository のみが companies/customers/deals/activities/activity_links/tasks へ
//  直接クエリする境界を守ったまま、facade/internal が必要とする複合クエリをここに集約する。
//  id バッチ取得は上記 getCompaniesByIds/getCustomersByIds/getDealsByIds を使う —
//  listCustomers*/listCompanies*By Ids という同義の別名は作らない)
// ============================================================

/** CustomerListItem/CustomerDetail.open_deal_count (stage ∉ {paid, lost} の件数)。
 *  対象顧客 id 群 (一覧 1 頁 = 最大 100 件、または詳細 1 件) に絞った bounded クエリ — 全件スキャンはしない。 */
export async function countOpenDealsByCustomerIds(
  client: SupabaseClient,
  customerIds: string[],
): Promise<Result<Record<string, number>>> {
  if (customerIds.length === 0) return { ok: true, value: {} };
  const { data, error } = await client
    .from("deals")
    .select("customer_id")
    .in("customer_id", customerIds)
    .in("stage", NON_TERMINAL_STAGES);
  if (error) return pgErrorToResult(error);
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as Array<{ customer_id: string }>) {
    counts[row.customer_id] = (counts[row.customer_id] ?? 0) + 1;
  }
  return { ok: true, value: counts };
}

/** CompanyListItem.customer_count (マージ敗者・merged_into 非 NULL 行は除く)。 */
export async function countCustomersByCompanyIds(
  client: SupabaseClient,
  companyIds: string[],
): Promise<Result<Record<string, number>>> {
  if (companyIds.length === 0) return { ok: true, value: {} };
  const { data, error } = await client
    .from("customers")
    .select("company_id")
    .in("company_id", companyIds)
    .is("merged_into_customer_id", null);
  if (error) return pgErrorToResult(error);
  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as Array<{ company_id: string }>) {
    counts[row.company_id] = (counts[row.company_id] ?? 0) + 1;
  }
  return { ok: true, value: counts };
}

// ---- ダッシュボード KPI (§8.6) / ダイジェスト (§7.2) 集計 ----

/** getDashboardKpi の awaiting_lead_count (stage='inquiry' の件数、DB 側 count) */
export async function countDealsByStage(
  client: SupabaseClient,
  stage: DealStage,
): Promise<Result<number>> {
  const { count, error } = await client
    .from("deals")
    .select("id", { count: "exact", head: true })
    .eq("stage", stage);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: count ?? 0 };
}

export type OpenDealAmount = { stage: DealStage; amount_jpy: number | null };

/**
 * getDashboardKpi の weighted_pipeline_jpy 計算対象行 (stage ∉ {paid, lost} のみ DB 側で絞る)。
 * probability による加重 (registry 参照) はコード側 (internal/digest.ts の純関数) の責務
 * ─ registry を SQL に複製しない (§4.2 の方針どおり)。
 */
export async function listOpenDealAmounts(client: SupabaseClient): Promise<Result<OpenDealAmount[]>> {
  const { data, error } = await client
    .from("deals")
    .select("stage, amount_jpy")
    .in("stage", NON_TERMINAL_STAGES);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data ?? []) as OpenDealAmount[] };
}

/** getDashboardKpi の overdue_task_count / week_open_task_count (DB 側 count)。JST 境界の date 文字列は呼び出し元 (internal/jst.ts) が算出する。 */
export async function countTasksInRange(
  client: SupabaseClient,
  status: TaskStatus,
  dueOnFrom: string | null,
  dueOnTo: string | null,
): Promise<Result<number>> {
  let query = client.from("tasks").select("id", { count: "exact", head: true }).eq("status", status);
  if (dueOnFrom !== null) query = query.gte("due_on", dueOnFrom);
  if (dueOnTo !== null) query = query.lte("due_on", dueOnTo);
  const { count, error } = await query;
  if (error) return pgErrorToResult(error);
  return { ok: true, value: count ?? 0 };
}

/** collectDigest の overdue_tasks / today_tasks (TaskListItem 相当。deal/customer 表示名を join)。 */
export type DigestTaskRow = TaskRow & {
  deal: { id: string; title: string } | null;
  customer: { id: string; name: string } | null;
};

export async function listOpenTasksForDigest(
  client: SupabaseClient,
  dueOnFrom: string | null,
  dueOnTo: string | null,
): Promise<Result<DigestTaskRow[]>> {
  let query = client
    .from("tasks")
    .select("*, deal:deals(id,title), customer:customers(id,name)")
    .eq("status", "open")
    .order("due_on", { ascending: true })
    .order("created_at", { ascending: false });
  if (dueOnFrom !== null) query = query.gte("due_on", dueOnFrom);
  if (dueOnTo !== null) query = query.lte("due_on", dueOnTo);
  const { data, error } = await query;
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data ?? []) as unknown as DigestTaskRow[] };
}

/** collectDigest の awaiting_leads (stage='inquiry' 全件、作成日昇順)。 */
export async function listAwaitingLeadDeals(client: SupabaseClient): Promise<Result<DealRow[]>> {
  const { data, error } = await client
    .from("deals")
    .select("*")
    .eq("stage", "inquiry")
    .order("created_at", { ascending: true });
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data ?? []) as DealRow[] };
}
