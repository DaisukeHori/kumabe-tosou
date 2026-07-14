import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Paged, Pagination, Result } from "@/modules/platform/contracts";
import { KMB_ERRORS, type KmbErrorCode } from "@/modules/platform/errors";

import type { DocumentLineInput, DocumentTotals, DocType, PaymentInput } from "./contracts";

/**
 * sales モジュールの repository。documents / document_lines / payments への
 * **唯一の**直接クエリ経路 (module-contracts.md §1「テーブルへの直接クエリは所有モジュールの
 * repository のみ」)。facade.ts のみがここを import する (facade 本体は #49)。
 *
 * client は用途に応じて admin セッション付き server client (session 実行) または
 * service_role client (service 実行) を facade が選んで渡す。どちらの client を使うかは
 * facade の責務であり、本ファイルは渡された client をそのまま使う (crm/repository.ts §1.1 と同旨)。
 *
 * 本ファイルは migration 0026 (documents/document_lines/payments + document_save_draft RPC —
 * #48) に加え、migration 0027 (issued_documents 台帳 + print_tokens / pdf_render_lock /
 * document_revision_stagings の補助 3 テーブル — #50) の DB アクセス層を含む: 印刷トークン
 * 発行/検証 (internal/print-token.ts) と PDF 生成 (internal/pdf.ts) が必要とする薄い層
 * (print_tokens の INSERT/消費/掃除、pdf_render_lock の CAS 取得/解放、Storage bucket
 * issued-documents への PDF アップロード)に加え、facade (issueDocument/reissueDocument/
 * reviseAndReissueDocument/createSignedPdfUrl — #50 UI/オーケストレーション実装分) が使う
 * document_finalize_issue / document_append_version / document_apply_revision の RPC 呼び出し
 * ラッパ、document_revision_stagings への INSERT/読み取り/掃除、issued_documents の版検索を含む。
 *
 * deriveDocument・issueDocument 等の業務オーケストレーション (税ガード・issuer_snapshot 合成・
 * PDF 生成の呼び出し順序等) は facade の責務であり、本ファイルは DB アクセスの薄い層に留める
 * (module-contracts.md 一般原則)。
 */

// ============================================================
// 共通: エラー写像・JST 年解決・keyset カーソル
// ============================================================

type PgError = { code?: string; message: string };

const KMB_ERROR_CODE_RE = /KMB-E\d+/;

/**
 * PostgREST/RPC/trigger のエラーを Result.code に写像する (crm/repository.ts の確立パターン踏襲)。
 * 1. メッセージに埋め込まれた `KMB-Exxx` (documents_freeze_after_issue / document_lines_draft_guard /
 *    payments_apply / document_save_draft の raise exception が全てこの規約 — 'KMB-EXXX: …' 先頭埋め込み)
 *    を最優先で拾う。KMB_ERRORS に未登録のコードを誤って拾わないよう登録済みか検査する。
 * 2. is_admin_or_service() ガード系 RPC の定型メッセージ ("permission denied: ...") は E202。
 * 3. Postgres エラーコードによる既定写像 (23505 一意制約違反 / 23503 FK違反 / 42501 RLS拒否)。
 * 4. 上記いずれにも該当しなければ E901 (地雷回避: ここで null/空へ握り潰さず必ず Result.code を持たせる)。
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

/**
 * 発行日の JST 年を解決する (02-sales.md §2.6-7 / 実装計画書 §4 の規約: p_year は repository が
 * 解決して document_number_next RPC に渡す。DB の now() からは導出しない)。
 * issueDate は zDateOnly (YYYY-MM-DD) の呼び出し側検証済み JST 暦日文字列 — 既に JST の日付表現
 * なのでタイムゾーン変換なしに先頭 4 桁を年として読む。null (= 「発行時に JST 今日」) の場合のみ
 * Intl.DateTimeFormat の Asia/Tokyo で「いま」の JST 年を算出する。
 */
function resolveJstYear(issueDate: string | null): number {
  if (issueDate) {
    return Number.parseInt(issueDate.slice(0, 4), 10);
  }
  const jstYear = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
  }).format(new Date());
  return Number.parseInt(jstYear, 10);
}

/** ILIKE パターン中のワイルドカード (`%`/`_`/`\`) をエスケープする (crm/content repository と同型) */
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
): Paged<Row> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last ? encodeCreatedAtCursor({ createdAt: last.created_at, id: last.id }) : null;
  return { items, next_cursor: nextCursor };
}

// ============================================================
// documents
// ============================================================

/** DB 行の生の型 (DDL 1:1)。enum 系は文字列のまま持つ (絞り込みは契約層/facade の責務) */
export type DocumentRow = {
  id: string;
  doc_type: string;
  status: string;
  deal_id: string;
  source_document_id: string | null;
  doc_no: string | null;
  current_version: number;
  issue_date: string | null;
  transaction_date: string | null;
  valid_until: string | null;
  billing_name: string;
  billing_suffix: string;
  billing_address: string | null;
  site_name: string | null;
  site_address: string | null;
  notes: string | null;
  tax_rounding: string;
  subtotal_jpy: number;
  tax_summary: unknown;
  total_jpy: number;
  issuer_snapshot: unknown;
  status_reason: string | null;
  issued_at: string | null;
  paid_at: string | null;
  voided_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type DocumentLineRow = {
  id: string;
  document_id: string;
  position: number;
  description: string;
  quantity: number;
  unit: string;
  unit_price_jpy: number;
  amount_jpy: number;
  tax_category: string;
  work_type_key: string | null;
  source: unknown;
  created_at: string;
};

export type PaymentRow = {
  id: string;
  document_id: string;
  paid_on: string;
  amount_jpy: number;
  method: string;
  memo: string | null;
  created_by: string | null;
  created_at: string;
};

/**
 * 採番 RPC (document_number_next — migration 0022、既存)。p_year は resolveJstYear() で
 * repository が解決してから渡す (呼び出し側 = facade #49 が issue_date を渡すだけでよい設計)。
 * 失敗 (KMB-E622 = 不正な doc_type、is_admin_or_service ガード = E202) はそのまま伝播する。
 */
export async function issueDocumentNumber(
  client: SupabaseClient,
  docType: DocType,
  issueDate: string | null,
): Promise<Result<{ doc_no: string; seq: number }>> {
  const year = resolveJstYear(issueDate);
  const { data, error } = await client.rpc("document_number_next", {
    p_doc_type: docType,
    p_year: year,
  });
  if (error) return pgErrorToResult(error);

  const row = (Array.isArray(data) ? data[0] : data) as
    | { doc_no: string; seq: number }
    | undefined
    | null;
  if (!row) {
    return { ok: false, code: "KMB-E622", detail: "採番 RPC が結果を返しませんでした" };
  }
  return { ok: true, value: { doc_no: row.doc_no, seq: row.seq } };
}

export type CreateDraftDocumentInput = {
  doc_type: DocType;
  deal_id: string;
  /** 派生元 (deriveDocument — #49)。通常作成 (createDraftDocument/createDraftQuoteFromEstimate)
   *  は null (documents.source_document_id は起点 = null — migration 0026 コメント参照) */
  source_document_id: string | null;
  billing_name: string;
  billing_suffix: "様" | "御中";
  billing_address: string | null;
  site_name: string | null;
  site_address: string | null;
  notes: string | null;
  issue_date: string | null;
  /** 取引年月日 (deriveDocument — #49、02-sales §4.4「transaction_date の引継ぎ」)。
   *  通常作成 (createDraftDocument/createDraftQuoteFromEstimate) は null (draft で編集可)。
   *  documents への column grant は insert 側は列制限なし (migration 0026 L146) のため
   *  facade からそのまま INSERT できる。 */
  transaction_date: string | null;
  valid_until: string | null;
  tax_rounding: "floor" | "round" | "ceil";
  lines: readonly DocumentLineInput[];
  totals: DocumentTotals;
  createdBy: string | null;
};

/**
 * draft 帳票の新規作成 (createDraftDocument / createDraftQuoteFromEstimate 共通の DB アクセス層)。
 * documents 1 行 INSERT → document_lines N 行 INSERT の 2 ステップ (PostgREST はマルチステートメント
 * トランザクションを張れないため)。lines 挿入が失敗した場合は孤児 draft を残さないベストエフォートで
 * documents 行を削除するが、呼び出し元に返す Result は常に**明細挿入の実際のエラー**
 * (地雷回避: cleanup の成否で本来のエラーを上書き・握り潰ししない)。
 */
export async function createDraftDocument(
  client: SupabaseClient,
  input: CreateDraftDocumentInput,
): Promise<Result<{ id: string; updated_at: string }>> {
  const { data: doc, error: docError } = await client
    .from("documents")
    .insert({
      doc_type: input.doc_type,
      deal_id: input.deal_id,
      source_document_id: input.source_document_id,
      billing_name: input.billing_name,
      billing_suffix: input.billing_suffix,
      billing_address: input.billing_address,
      site_name: input.site_name,
      site_address: input.site_address,
      notes: input.notes,
      issue_date: input.issue_date,
      transaction_date: input.transaction_date,
      valid_until: input.valid_until,
      tax_rounding: input.tax_rounding,
      subtotal_jpy: input.totals.subtotal_jpy,
      tax_summary: input.totals.tax_summary,
      total_jpy: input.totals.total_jpy,
      created_by: input.createdBy,
    })
    .select("id, updated_at")
    .single();
  if (docError) return pgErrorToResult(docError);

  const documentId = doc.id as string;

  if (input.lines.length > 0) {
    const rows = input.lines.map((line, index) => ({
      document_id: documentId,
      position: index,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unit_price_jpy: line.unit_price_jpy,
      amount_jpy: line.amount_jpy,
      tax_category: line.tax_category,
      work_type_key: line.work_type_key,
      source: line.source,
    }));
    const { error: linesError } = await client.from("document_lines").insert(rows);
    if (linesError) {
      await client.from("documents").delete().eq("id", documentId); // ベストエフォート (結果は問わない)
      return pgErrorToResult(linesError);
    }
  }

  return { ok: true, value: { id: documentId, updated_at: doc.updated_at as string } };
}

export async function getDocumentById(
  client: SupabaseClient,
  id: string,
): Promise<Result<DocumentRow | null>> {
  const { data, error } = await client.from("documents").select("*").eq("id", id).maybeSingle();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data as DocumentRow | null) ?? null };
}

export type DocumentListFilterRaw = {
  doc_type: string | null;
  status: string | null;
  deal_id: string | null;
  q: string | null;
};

/** keyset 一覧 (created_at desc, id desc — documents_created_idx と 1:1) */
export async function listDocumentsPage(
  client: SupabaseClient,
  filter: DocumentListFilterRaw,
  pagination: Pagination,
): Promise<Result<Paged<DocumentRow>>> {
  let query = client
    .from("documents")
    .select("*")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pagination.limit + 1);

  if (filter.doc_type) query = query.eq("doc_type", filter.doc_type);
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.deal_id) query = query.eq("deal_id", filter.deal_id);
  if (filter.q) {
    const escaped = escapeLikePattern(filter.q);
    query = query.or(`doc_no.ilike.%${escaped}%,billing_name.ilike.%${escaped}%`);
  }

  const cursor = decodeCreatedAtCursor(pagination.cursor);
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) return pgErrorToResult(error);
  return { ok: true, value: pageByCreatedAt<DocumentRow>((data ?? []) as DocumentRow[], pagination.limit) };
}

export type DocumentStatusPatch = {
  status: string;
  status_reason: string | null;
  voided_at: string | null;
};

/**
 * status 系列 (status/status_reason/voided_at) のみの CAS 更新。acceptQuote/declineQuote/
 * voidDocument (#49) 用の薄い書き込み層 — 遷移可否の判定 (internal/state.ts) は呼び出し側の責務。
 * documents の列単位 grant に status/status_reason/voided_at が含まれる (migration 0026) ため
 * session client でそのまま UPDATE できる。
 */
export async function updateDocumentStatusWithCas(
  client: SupabaseClient,
  id: string,
  patch: DocumentStatusPatch,
  expectedUpdatedAt: string,
): Promise<Result<DocumentRow>> {
  const { data, error } = await client
    .from("documents")
    .update(patch)
    .eq("id", id)
    .eq("updated_at", expectedUpdatedAt)
    .select("*")
    .maybeSingle();
  if (error) return pgErrorToResult(error);
  if (data) return { ok: true, value: data as DocumentRow };
  return resolveCasMiss(client, id);
}

async function resolveCasMiss(client: SupabaseClient, id: string): Promise<Result<never>> {
  const { data: existing, error: existErr } = await client
    .from("documents")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (existErr) return pgErrorToResult(existErr);
  if (!existing) {
    return { ok: false, code: "KMB-E621", detail: "帳票が見つかりません。" };
  }
  return {
    ok: false,
    code: "KMB-E103",
    detail: "他の操作で更新されています。再読み込みしてやり直してください。",
  };
}

/**
 * draft の物理削除 (RLS documents_admin_delete が status='draft' 限定なので、非 draft の DELETE は
 * 0 行応答になる — その場合は現在の状態を読み直して E621/E103/E621 (不在) を判別する)。
 */
export async function deleteDraftDocument(
  client: SupabaseClient,
  id: string,
  expectedUpdatedAt: string,
): Promise<Result<void>> {
  const { data, error } = await client
    .from("documents")
    .delete()
    .eq("id", id)
    .eq("updated_at", expectedUpdatedAt)
    .select("id");
  if (error) return pgErrorToResult(error);
  if (data && data.length > 0) return { ok: true, value: undefined };

  const { data: existing, error: existErr } = await client
    .from("documents")
    .select("id, status, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (existErr) return pgErrorToResult(existErr);
  if (!existing) {
    return { ok: false, code: "KMB-E621", detail: "帳票が見つかりません。" };
  }
  if (existing.status !== "draft") {
    return { ok: false, code: "KMB-E621", detail: "発行済みの帳票は削除できません。" };
  }
  return {
    ok: false,
    code: "KMB-E103",
    detail: "他の操作で更新されています。再読み込みしてやり直してください。",
  };
}

// ============================================================
// document_save_draft RPC (CAS + ヘッダ + 明細全行置換の原子化 — migration 0026)
// ============================================================

export type SaveDraftHeader = {
  issue_date: string | null;
  transaction_date: string | null;
  valid_until: string | null;
  billing_name: string;
  billing_suffix: "様" | "御中";
  billing_address: string | null;
  site_name: string | null;
  site_address: string | null;
  notes: string | null;
  tax_rounding: "floor" | "round" | "ceil";
};

/**
 * updateDraftDocument (#49) の DB アクセス層。document_save_draft RPC は CAS 不一致 → KMB-E103 /
 * 非 draft → KMB-E624 / 0 行許容の明細全置換を単一トランザクションで行う (02-sales §2.3.1)。
 * p_lines は position を持たない契約形式のまま渡す (RPC 側が ordinality で 0 始まり連番を採番する
 * — 実装計画書 §1 注意9。ここで position を付与してはならない)。
 */
export async function saveDraftDocument(
  client: SupabaseClient,
  documentId: string,
  expectedUpdatedAt: string,
  header: SaveDraftHeader,
  lines: readonly DocumentLineInput[],
  totals: DocumentTotals,
): Promise<Result<{ updated_at: string }>> {
  const { data, error } = await client.rpc("document_save_draft", {
    p_document_id: documentId,
    p_expected_updated_at: expectedUpdatedAt,
    p_header: header,
    p_lines: lines,
    p_subtotal_jpy: totals.subtotal_jpy,
    p_tax_summary: totals.tax_summary,
    p_total_jpy: totals.total_jpy,
  });
  if (error) return pgErrorToResult(error);

  const row = (Array.isArray(data) ? data[0] : data) as { new_updated_at: string } | undefined | null;
  if (!row) {
    return { ok: false, code: "KMB-E901", detail: "document_save_draft が結果を返しませんでした" };
  }
  return { ok: true, value: { updated_at: row.new_updated_at } };
}

// ============================================================
// document_lines (読み取りのみ — 書込は createDraftDocument / saveDraftDocument RPC 経由)
// ============================================================

export async function listDocumentLines(
  client: SupabaseClient,
  documentId: string,
): Promise<Result<DocumentLineRow[]>> {
  const { data, error } = await client
    .from("document_lines")
    .select("*")
    .eq("document_id", documentId)
    .order("position", { ascending: true });
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data ?? []) as DocumentLineRow[] };
}

// ============================================================
// payments
// ============================================================

export async function listPayments(
  client: SupabaseClient,
  documentId: string,
): Promise<Result<PaymentRow[]>> {
  const { data, error } = await client
    .from("payments")
    .select("*")
    .eq("document_id", documentId)
    .order("paid_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data ?? []) as PaymentRow[] };
}

/**
 * 入金記録 (recordPayment — #49)。payments_apply trigger (security definer) が消込を行い、
 * 検証違反は 'KMB-EXXX: …' 埋め込みの raise exception で返る (pgErrorToResult が変換 — 握り潰さない)。
 */
export async function insertPayment(
  client: SupabaseClient,
  input: PaymentInput,
  createdBy: string | null,
): Promise<Result<PaymentRow>> {
  const { data, error } = await client
    .from("payments")
    .insert({
      document_id: input.document_id,
      paid_on: input.paid_on,
      amount_jpy: input.amount_jpy,
      method: input.method,
      memo: input.memo,
      created_by: createdBy,
    })
    .select("*")
    .single();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: data as PaymentRow };
}

/**
 * 入金訂正 (deletePayment — #49)。DELETE は payments_apply trigger が完済⇔発行済みの
 * 状態復帰を行う。UPDATE grant が無い (不変) ため訂正は常に DELETE + 再 INSERT。
 */
export async function deletePayment(
  client: SupabaseClient,
  paymentId: string,
): Promise<Result<void>> {
  const { data, error } = await client.from("payments").delete().eq("id", paymentId).select("id");
  if (error) return pgErrorToResult(error);
  if (!data || data.length === 0) {
    return { ok: false, code: "KMB-E621", detail: "入金記録が見つかりません。" };
  }
  return { ok: true, value: undefined };
}

// ============================================================
// print_tokens (印刷トークンのワンタイム消費 — migration 0027、02-sales §7.3)
// service 専用テーブル (RLS ポリシーなし + revoke — 呼び出し側は必ず service client を渡すこと)
// ============================================================

export type PrintTokenPurpose = "pdf" | "preview";

export type InsertPrintTokenInput = {
  tokenHash: string; // sha256(トークン全文) の hex 64 桁 (primary key)
  documentId: string;
  purpose: PrintTokenPurpose;
  payload: unknown; // zPrintTokenExtras | null (呼び出し側で parse 済みの値を渡す)
  expiresAt: string;
};

export async function insertPrintToken(
  client: SupabaseClient,
  input: InsertPrintTokenInput,
): Promise<Result<void>> {
  const { error } = await client.from("print_tokens").insert({
    token_hash: input.tokenHash,
    document_id: input.documentId,
    purpose: input.purpose,
    payload: input.payload,
    expires_at: input.expiresAt,
  });
  if (error) return pgErrorToResult(error);
  return { ok: true, value: undefined };
}

export type ConsumedPrintToken = {
  document_id: string;
  purpose: PrintTokenPurpose;
  payload: unknown;
} | null;

/**
 * ワンタイム消費 (02-sales §7.3 v1.1): `consumed_at is null and expires_at > now()` の
 * 1 行だけを UPDATE し、消費できた行を返す。0 行 (消費済み/期限切れ/未登録のいずれか — 詳細を
 * 区別して返さない設計) は null。expires_at との比較はこの呼び出し時点のサーバ時刻を使う
 * (RPC 化していないため DB の now() は使えないが、TTL 300 秒に対して往復の時刻差は無視できる)。
 */
export async function consumePrintToken(
  client: SupabaseClient,
  tokenHash: string,
): Promise<Result<ConsumedPrintToken>> {
  const nowIso = new Date().toISOString();
  const { data, error } = await client
    .from("print_tokens")
    .update({ consumed_at: nowIso })
    .eq("token_hash", tokenHash)
    .is("consumed_at", null)
    .gt("expires_at", nowIso)
    .select("document_id, purpose, payload")
    .maybeSingle();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data as ConsumedPrintToken) ?? null };
}

/**
 * 期限切れ行のベストエフォート掃除 (発行時 — 02-sales §7.3「期限切れ行は発行時にベストエフォート
 * 掃除」)。失敗しても呼び出し側 (internal/print-token.ts) は発行処理自体を継続してよい
 * (地雷回避の対象外 — 掃除は最適化であり正しさに必須ではない。print_tokens は行数が
 * 小さく保たれなくても機能上壊れない)。
 */
export async function cleanupExpiredPrintTokens(client: SupabaseClient): Promise<Result<void>> {
  const { error } = await client.from("print_tokens").delete().lt("expires_at", new Date().toISOString());
  if (error) return pgErrorToResult(error);
  return { ok: true, value: undefined };
}

// ============================================================
// pdf_render_lock (PDF 生成のグローバル直列化 lease — migration 0027、02-sales §7.4-1)
// singleton 行 (id=1)。advisory lock は pgbouncer のため使わない (canonical明記)。
// ============================================================

const PDF_RENDER_LOCK_LEASE_SECONDS = 90;

/**
 * CAS lease 取得: `locked_until < now()` の場合のみ `locked_until = now()+90s` に更新する。
 * 0 行 (他インスタンス実行中) は value:false — 呼び出し側 (internal/pdf.ts) は KMB-E643 に変換する。
 */
export async function acquirePdfRenderLock(
  client: SupabaseClient,
  lockedBy: string,
): Promise<Result<boolean>> {
  const nowIso = new Date().toISOString();
  const lockedUntil = new Date(Date.now() + PDF_RENDER_LOCK_LEASE_SECONDS * 1000).toISOString();
  const { data, error } = await client
    .from("pdf_render_lock")
    .update({ locked_until: lockedUntil, locked_by: lockedBy })
    .eq("id", 1)
    .lt("locked_until", nowIso)
    .select("id");
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data?.length ?? 0) > 0 };
}

/**
 * lease 返却 (ベストエフォート — 実装計画書「§7.4-1」)。`locked_by` が一致する行のみ返却し、
 * 他インスタンスが既に次の lease を取得済みの場合は誤って割り込まない。失敗してもクラッシュ時と
 * 同様に 90 秒で自然失効するため、呼び出し側は結果を無視してよい。
 */
export async function releasePdfRenderLock(
  client: SupabaseClient,
  lockedBy: string,
): Promise<Result<void>> {
  const { error } = await client
    .from("pdf_render_lock")
    .update({ locked_until: new Date().toISOString() })
    .eq("id", 1)
    .eq("locked_by", lockedBy);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: undefined };
}

// ============================================================
// Storage: issued-documents バケット (migration 0027、02-sales §7.4-6)
// ============================================================

const ISSUED_DOCUMENTS_BUCKET = "issued-documents";

/**
 * 発行済み PDF の保存。**upsert:false 固定** (capture.ts の ai-context バケットは upsert:true —
 * 流用時の地雷。電帳法の不変保存対象のため上書きを許可しない — gap-pdf §5)。
 * Storage の失敗は pgErrorToResult (Postgres エラー形状) を使わず、KMB-E641 に直接写像する
 * (StorageError は Postgres エラーコードを持たないため)。
 */
export async function uploadIssuedDocumentPdf(
  client: SupabaseClient,
  path: string,
  pdf: Buffer,
): Promise<Result<void>> {
  const { error } = await client.storage.from(ISSUED_DOCUMENTS_BUCKET).upload(path, pdf, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (error) return { ok: false, code: "KMB-E641", detail: error.message };
  return { ok: true, value: undefined };
}

// ============================================================
// document_revision_stagings (訂正発行の staging — migration 0027、02-sales §4.3-B)
// /print route の payload.staging_id 描画分岐用の読み取りに加え、reviseAndReissueDocument
// (facade — #50) が使う INSERT / 孤児掃除を含む。
// ============================================================

export type RevisionStagingRow = {
  id: string;
  document_id: string;
  header: unknown;
  lines: unknown;
  subtotal_jpy: number;
  tax_summary: unknown;
  total_jpy: number;
  created_by: string | null;
  created_at: string;
};

export async function getRevisionStagingById(
  client: SupabaseClient,
  id: string,
): Promise<Result<RevisionStagingRow | null>> {
  const { data, error } = await client
    .from("document_revision_stagings")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data as RevisionStagingRow | null) ?? null };
}

export type InsertRevisionStagingInput = {
  documentId: string;
  header: unknown; // zReviseDocumentInput.omit({lines:true}) 検証済みの値 (facade が渡す)
  lines: unknown; // zDocumentLineInput[] 検証済みの値
  totals: DocumentTotals;
  createdBy: string | null;
};

export async function insertRevisionStaging(
  client: SupabaseClient,
  input: InsertRevisionStagingInput,
): Promise<Result<{ id: string }>> {
  const { data, error } = await client
    .from("document_revision_stagings")
    .insert({
      document_id: input.documentId,
      header: input.header,
      lines: input.lines,
      subtotal_jpy: input.totals.subtotal_jpy,
      tax_summary: input.totals.tax_summary,
      total_jpy: input.totals.total_jpy,
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: { id: (data as { id: string }).id } };
}

/**
 * 孤児 staging のベストエフォート掃除 (02-sales §6.2 reviseAndReissueDocument 行「冒頭で古い
 * staging をベストエフォート掃除」)。`document_apply_revision` RPC は成功時に必ず対象 staging 行を
 * DELETE する (migration 0027) ため、対象 document_id に残っている staging 行は前回の訂正試行の
 * 失敗 (PDF 生成失敗・プロセス死等) による孤児のみ — 安全に全削除できる (地雷回避の判断:
 * staging はワーキングコピーであり電帳法の正本 (issued_documents/documents) ではないため
 * データ損失に当たらない — 実装計画書「未解決点」の安全側解釈)。失敗しても訂正処理自体は継続する
 * (掃除は最適化であり正しさに必須ではない — cleanupExpiredPrintTokens と同型の縮退)。
 */
export async function cleanupOrphanRevisionStagings(
  client: SupabaseClient,
  documentId: string,
): Promise<Result<void>> {
  const { error } = await client.from("document_revision_stagings").delete().eq("document_id", documentId);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: undefined };
}

// ============================================================
// RPC: document_finalize_issue / document_append_version / document_apply_revision
// (発行確定・版追加・訂正確定の原子性 — migration 0027、02-sales §6.1/§4.3-A/§4.3-B)
// いずれも #variable_conflict use_column (0019 教訓) で定義済み。エラーは raise exception の
// 'KMB-Exxx: …' 埋め込みメッセージを pgErrorToResult が拾う (E103/E620/E621/E622/E627 等)。
// ============================================================

export type FinalizeOrAppendResult = { issued_document_id: string; doc_version: number; new_updated_at: string };

export type FinalizeDocumentIssueInput = {
  documentId: string;
  expectedUpdatedAt: string;
  docNo: string;
  issueDate: string;
  subtotalJpy: number;
  taxSummary: unknown; // zTaxSummary 検証済み
  totalJpy: number;
  issuerSnapshot: unknown; // zIssuerSnapshot 検証済み
  sha256: string;
  storagePath: string;
  counterparty: string;
  contentSnapshot: unknown; // zIssuedContentSnapshot 検証済み
};

export async function finalizeDocumentIssue(
  client: SupabaseClient,
  input: FinalizeDocumentIssueInput,
): Promise<Result<FinalizeOrAppendResult>> {
  const { data, error } = await client.rpc("document_finalize_issue", {
    p_document_id: input.documentId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_doc_no: input.docNo,
    p_issue_date: input.issueDate,
    p_subtotal_jpy: input.subtotalJpy,
    p_tax_summary: input.taxSummary,
    p_total_jpy: input.totalJpy,
    p_issuer_snapshot: input.issuerSnapshot,
    p_sha256: input.sha256,
    p_storage_path: input.storagePath,
    p_counterparty: input.counterparty,
    p_content_snapshot: input.contentSnapshot,
  });
  if (error) return pgErrorToResult(error);
  const row = (Array.isArray(data) ? data[0] : data) as FinalizeOrAppendResult | undefined | null;
  if (!row) {
    return { ok: false, code: "KMB-E901", detail: "document_finalize_issue が結果を返しませんでした" };
  }
  return { ok: true, value: row };
}

export type AppendDocumentVersionInput = {
  documentId: string;
  expectedUpdatedAt: string;
  sha256: string;
  storagePath: string;
  counterparty: string;
  contentSnapshot: unknown;
};

export async function appendDocumentVersion(
  client: SupabaseClient,
  input: AppendDocumentVersionInput,
): Promise<Result<FinalizeOrAppendResult>> {
  const { data, error } = await client.rpc("document_append_version", {
    p_document_id: input.documentId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_sha256: input.sha256,
    p_storage_path: input.storagePath,
    p_counterparty: input.counterparty,
    p_content_snapshot: input.contentSnapshot,
  });
  if (error) return pgErrorToResult(error);
  const row = (Array.isArray(data) ? data[0] : data) as FinalizeOrAppendResult | undefined | null;
  if (!row) {
    return { ok: false, code: "KMB-E901", detail: "document_append_version が結果を返しませんでした" };
  }
  return { ok: true, value: row };
}

export type ApplyDocumentRevisionInput = {
  documentId: string;
  expectedUpdatedAt: string;
  stagingId: string;
  sha256: string;
  storagePath: string;
  contentSnapshot: unknown;
};

export async function applyDocumentRevision(
  client: SupabaseClient,
  input: ApplyDocumentRevisionInput,
): Promise<Result<FinalizeOrAppendResult>> {
  const { data, error } = await client.rpc("document_apply_revision", {
    p_document_id: input.documentId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_staging_id: input.stagingId,
    p_sha256: input.sha256,
    p_storage_path: input.storagePath,
    p_content_snapshot: input.contentSnapshot,
  });
  if (error) return pgErrorToResult(error);
  const row = (Array.isArray(data) ? data[0] : data) as FinalizeOrAppendResult | undefined | null;
  if (!row) {
    return { ok: false, code: "KMB-E901", detail: "document_apply_revision が結果を返しませんでした" };
  }
  return { ok: true, value: row };
}

// ============================================================
// issued_documents (発行控え台帳 — 読み取りのみ。書込は上記 RPC 経由)
// ============================================================

export type IssuedDocumentVersionRow = { storage_path: string };

/** createSignedPdfUrl (facade — #50) の版検索。0 行 = 版なし (呼び出し側が KMB-E627 に変換)。 */
export async function getIssuedDocumentByVersion(
  client: SupabaseClient,
  documentId: string,
  version: number,
): Promise<Result<IssuedDocumentVersionRow | null>> {
  const { data, error } = await client
    .from("issued_documents")
    .select("storage_path")
    .eq("document_id", documentId)
    .eq("version", version)
    .maybeSingle();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data as IssuedDocumentVersionRow | null) ?? null };
}
