import "server-only";

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getEnv, isPrintTokenSecretConfigured, isServiceRoleConfigured } from "@/lib/env";
import { getSessionAndClient } from "@/lib/supabase/session";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { ExecutionContext, Paged, Pagination, Result, TaxCategory } from "@/modules/platform/contracts";
import { zPagination } from "@/modules/platform/contracts";

import { crmFacade } from "@/modules/crm/facade";
// sales→crm は crmFacade 経由の 3 メソッド (getDealRef/getDealRefs/appendActivity) + 型 import のみ許可
// (実装計画書「モジュール境界」注記)。DealRef/SimEstimateSnapshot/DocumentEventActivityPayload は
// いずれも型のみ (crm 側の zod スキーマを sales 側で再 import・再 parse しない — 契約の canonical
// 分担を crm 側に残す)。DocumentEventActivityPayload は issueDocument/reissueDocument/
// reviseAndReissueDocument (#50 実装分) が appendActivity へ渡す payload の型として使う
// (recordPayment のみ #51 で未実装のまま — SalesFacade 契約の型宣言としては残す)。
import type { DealRef, DocumentEventActivityPayload, SimEstimateSnapshot } from "@/modules/crm/contracts";

import { settingsFacade } from "@/modules/settings/facade";

import {
  DERIVATION_RULES,
  zCreateDocumentInput,
  zDocType,
  zDocumentLineInput,
  zDocumentListFilter,
  zIssuedContentSnapshot,
  zIssuerSnapshot,
  zPaymentInput,
  zReviseDocumentInput,
  zUpdateDraftDocumentInput,
  type CreateDocumentInput,
  type DocType,
  type DocumentDetail,
  type DocumentListFilter,
  type DocumentListItem,
  type DocumentLineInput,
  type DocumentStatus,
  type DocumentTotals,
  type IssuedContentSnapshot,
  type IssuerSnapshot,
  type PaymentInput,
  type ReviseDocumentInput,
  type SalesDigest,
  type TaxSummary,
  type UpdateDraftDocumentInput,
} from "./contracts";
import { diffIssuedSnapshots, type IssuedSnapshotDiff } from "./internal/diff";
import { buildIssuerSnapshot } from "./internal/issuer";
import { generateDocumentPdf } from "./internal/pdf";
import { issuePrintToken, verifyAndConsumePrintToken } from "./internal/print-token";
import { canTransition, computeDerivableTo } from "./internal/state";
import { buildDerivedDocumentLines, buildSimulatorQuoteDraft, resolveDerivedTransactionDate } from "./internal/derive";
import { computeDocumentTotals } from "./tax";
import {
  appendDocumentVersion,
  applyDocumentRevision,
  bulkExpireOverdueQuotes,
  cleanupOrphanRevisionStagings,
  createDraftDocument as repoCreateDraftDocument,
  deleteDraftDocument as repoDeleteDraftDocument,
  deletePayment as repoDeletePayment,
  finalizeDocumentIssue,
  getDocumentById,
  getIssuedDocumentByVersion,
  getRevisionStagingById,
  insertPayment,
  insertRevisionStaging,
  issueDocumentNumber,
  listDocumentLines,
  listDocumentsPage,
  listExpiringQuotes,
  listIssuedDocumentVersions,
  listPayments,
  listPaymentsForDocuments,
  listUnpaidInvoices,
  saveDraftDocument,
  updateDocumentStatusWithCas,
  type DocumentRow,
  type PaymentRow,
} from "./repository";

// 版間差分ダイアログ (app 層) が computeVersionDiff (下記) の戻り値を型付けできるよう、facade からも
// re-export する (internal/diff.ts への直 import は ESLint モジュール境界で app 層から禁止 —
// resolvePrintView と同型のブリッジパターン。下記 computeVersionDiff の JSDoc 参照)。
export type { IssuedSnapshotDiff, SnapshotFieldDiff, SnapshotLineDiffEntry, SnapshotTaxDiffEntry } from "./internal/diff";

/**
 * sales モジュールの公開 facade (02-sales.md §6)。
 *
 * `SalesFacade` (07-contracts-delta §D8 契約 8 メソッド。シグネチャ変更禁止) と
 * `SalesFacadeExtended` (02-sales §6.2 契約外拡張。`reviseAndReissueDocument` を含む — 本 Issue
 * (#50) の実装範囲。`deletePayment`/`getSalesDigest`/`markExpiredQuotes` は #51 の担当のため
 * 型宣言にも含めない) を型としてフルセット/部分セットで宣言する
 * (scheduling/facade.ts の SchedulingFacade/SchedulingFacadeExtended 分割と同型)。
 *
 * ---- 実装範囲の変遷 ----
 * #49 は `createDraftDocument`/`createDraftQuoteFromEstimate`/`deriveDocument` (契約) +
 * `listDocuments`/`getDocumentDetail`/`updateDraftDocument`/`deleteDraftDocument`/
 * `acceptQuote`/`declineQuote`/`voidDocument`/`computeTotalsPreview` (契約外拡張) の 11 メソッド
 * (`SalesFacadeCore`) を実装した。#50 は残り契約メソッドのうち `recordPayment` を除く 4 つ
 * (`issueDocument`/`reissueDocument`/`getDocumentLinesForBlocks`/`createSignedPdfUrl`) と、
 * 契約外拡張 `reviseAndReissueDocument` の計 5 メソッド (`SalesFacadeIssuance`) を追加する。
 * `recordPayment`/`deletePayment`/`getSalesDigest`/`markExpiredQuotes` は #51 が実装するため、
 * 本ファイルでは型宣言のみに留め、戻り値型を `Pick<SalesFacadeExtended, ...>` の交差型に絞ることで
 * 「未実装メソッドをスタブで誤魔化す」ことを構造的に防ぐ (呼び出せば型検査の時点でエラーになる)。
 *
 * 実行文脈: `createSalesFacade(client?: SupabaseClient)` はファクトリ関数。省略時は session
 * (admin セッション — `getSessionAndClient()`)、指定時は facade インスタンス単位でその client を
 * 全メソッドに固定する (D8 のシグネチャに ctx 引数が無いため、crm/settings のようなメソッド単位
 * ctx 引数は取らない設計 — 02-sales §6.1 createDraftQuoteFromEstimate 注記)。
 * `createDraftQuoteFromEstimate` のみ、facade の生成方法に関わらず常に service 実行
 * (anon route `/api/shop/lead` からセッション無しで呼ばれるため)。
 * `issueDocument`/`reissueDocument`/`reviseAndReissueDocument` は、渡された `client`
 * (session または injectedClient) を documents/document_lines/issued_documents RPC 呼び出しに
 * 使う一方、PDF 生成・印刷トークン・pdf_render_lock (いずれも service 専用テーブル/Storage —
 * internal/pdf.ts・internal/print-token.ts の JSDoc 参照) には**常に独立した service client**
 * (`injectedClient ?? createSupabaseServiceClient()`) を使う — admin セッションの `authenticated`
 * ロールは `revoke all ... from anon, authenticated` により print_tokens/pdf_render_lock を
 * 一切読み書きできないため (createDraftQuoteFromEstimate の service client 生成パターンを流用)。
 */
export interface SalesFacade {
  createDraftDocument(input: CreateDocumentInput): Promise<Result<{ document_id: string }>>;
  createDraftQuoteFromEstimate(
    input: { deal_id: string; estimate: SimEstimateSnapshot },
  ): Promise<Result<{ document_id: string }>>;
  deriveDocument(input: { source_document_id: string; to_type: DocType }): Promise<Result<{ document_id: string }>>;
  issueDocument(
    documentId: string,
    expectedUpdatedAt: string,
  ): Promise<
    Result<{ doc_no: string; version: number; pdf_storage_path: string; event: DocumentEventActivityPayload }>
  >;
  reissueDocument(documentId: string, expectedUpdatedAt: string): Promise<Result<{ version: number; pdf_storage_path: string }>>;
  recordPayment(
    input: PaymentInput,
  ): Promise<Result<{ payment_id: string; invoice_paid: boolean; event: DocumentEventActivityPayload }>>;
  getDocumentLinesForBlocks(documentId: string): Promise<
    Result<
      Array<{
        description: string;
        work_type_key: string | null;
        quantity: number;
        grade_key: string | null;
        size_key: string | null;
      }>
    >
  >;
  createSignedPdfUrl(documentId: string, version: number): Promise<Result<{ url: string; expires_at: string }>>;
}

export interface SalesFacadeExtended extends SalesFacade {
  // ---- 契約外拡張 (02-sales.md §6.2 のうち #49 実装分のみ)。他モジュールから呼ぶこと禁止 ----
  listDocuments(filter: DocumentListFilter, page: Pagination): Promise<Result<Paged<DocumentListItem>>>;
  getDocumentDetail(documentId: string): Promise<Result<DocumentDetail>>;
  updateDraftDocument(
    documentId: string,
    input: UpdateDraftDocumentInput,
    expectedUpdatedAt: string,
  ): Promise<Result<{ updated_at: string }>>;
  deleteDraftDocument(documentId: string, expectedUpdatedAt: string): Promise<Result<void>>;
  acceptQuote(documentId: string, expectedUpdatedAt: string): Promise<Result<void>>;
  declineQuote(documentId: string, reason: string | null, expectedUpdatedAt: string): Promise<Result<void>>;
  voidDocument(documentId: string, reason: string, expectedUpdatedAt: string): Promise<Result<void>>;
  computeTotalsPreview(lines: DocumentLineInput[], rounding: TaxRounding): Result<DocumentTotals>;
  // ---- 契約外拡張 (02-sales.md §6.2 のうち #50 実装分) ----
  /** §4.3-B (訂正発行): Zod + 税ガード → staging INSERT → staging 内容で PDF 生成・Storage 保存 →
   *  document_apply_revision RPC (documents 更新 + 明細置換 + 台帳 append + version 前進を単一
   *  トランザクションで確定) → appendActivity('reissued')。戻り値型は canonical (§6.2 表) に
   *  明記が無いため reissueDocument と同型 ({version; pdf_storage_path}) とした
   *  (実装計画書「未解決点1」— 契約外拡張は実装者が型を確定してよい規約に基づく判断。
   *  openIssues に記録)。 */
  reviseAndReissueDocument(
    documentId: string,
    input: ReviseDocumentInput,
    expectedUpdatedAt: string,
  ): Promise<Result<{ version: number; pdf_storage_path: string }>>;
  // ---- 契約外拡張 (02-sales.md §6.2 のうち #51 実装分) ----
  /** 入金訂正 (§6.2)。DELETE のみ (UPDATE grant なし — 訂正は削除 + recordPayment 再実行)。
   *  appendActivity は呼ばない (§11.3: payments 変更履歴は「該当なし」— 台帳と
   *  paid⇔issued 復帰 trigger 自体が監査痕跡のため)。 */
  deletePayment(paymentId: string): Promise<Result<void>>;
  /**
   * ダッシュボード/crm-digest 向けの読み取り専用集計 (§6.2 / §5.2 SalesDigest)。
   * 07-contracts-delta §D8「§3 の 1 の形」により、他の全メソッド (ファクトリ時点で client を固定する
   * `resolveClientAndUser(injectedClient)` パターン) とは異なり、**呼び出し時に ctx を渡す**設計
   * (crm/facade.ts の appendActivity(input, ctx) や settings の get(key, ctx) と同型 —
   * 下記 resolveSalesExecutionClient のコメント参照)。ctx 省略時は session
   * (dashboard から admin セッションで直接呼ぶケースを許容)。
   */
  getSalesDigest(ctx?: ExecutionContext): Promise<Result<SalesDigest>>;
  /** バッチ処理 (§6.2)。ctx 必須 — 常に cron/webhook (crm-digest route) から service 文脈で呼ぶ設計
   *  (dashboard からの手動実行は無い)。getSalesDigest と同じ ctx 都度渡し方式。 */
  markExpiredQuotes(ctx: ExecutionContext): Promise<Result<void>>;
  /**
   * 版間差分ダイアログ (§11.1・§8.4「前の版と比較」) が使う、指定版の content_snapshot 取得。
   * 契約にも 02-sales §6.2 の表にも明記が無い契約外拡張 (実装計画書「未解決点3」— #50 の
   * reviseAndReissueDocument 戻り値型確定と同じ「実装者が型を確定してよい」規約)。
   * ダイアログを開いたときに新旧 2 版分を Promise.all で遅延ロードする想定 (計画書の推奨方式)。
   * エラー: E627 (指定版が台帳に無い) / E901 (content_snapshot が zIssuedContentSnapshot と不一致)。
   */
  getIssuedContentSnapshot(documentId: string, version: number): Promise<Result<IssuedContentSnapshot>>;
}

/** この Issue (#49) で実装済みのメソッドのみに絞った戻り値型 (上記コメント参照)。
 *  未実装メソッド (issueDocument 等) は呼び出せば型エラーになる — スタブで誤魔化さない。 */
export type SalesFacadeCore = Pick<
  SalesFacadeExtended,
  | "createDraftDocument"
  | "createDraftQuoteFromEstimate"
  | "deriveDocument"
  | "listDocuments"
  | "getDocumentDetail"
  | "updateDraftDocument"
  | "deleteDraftDocument"
  | "acceptQuote"
  | "declineQuote"
  | "voidDocument"
  | "computeTotalsPreview"
>;

/** この Issue (#50) で追加実装するメソッドのみに絞った戻り値型 (SalesFacadeCore と同型の設計 —
 *  上記コメント参照)。`recordPayment`/`deletePayment`/`getSalesDigest`/`markExpiredQuotes`
 *  (#51 スコープ) は呼び出せば型エラーになる。 */
export type SalesFacadeIssuance = Pick<
  SalesFacadeExtended,
  | "issueDocument"
  | "reissueDocument"
  | "reviseAndReissueDocument"
  | "getDocumentLinesForBlocks"
  | "createSignedPdfUrl"
>;

/** この Issue (#51) で追加実装するメソッドのみに絞った戻り値型 (SalesFacadeCore/SalesFacadeIssuance と
 *  同型の設計 — 上記コメント参照)。`recordPayment` は契約メソッド (SalesFacade) だが #51 実装分の
 *  ため、契約外拡張 3 つ (deletePayment/getSalesDigest/markExpiredQuotes) とまとめて 1 つの Pick に
 *  してある。getSalesDigest/markExpiredQuotes の ctx 都度渡し設計は上記 SalesFacadeExtended の
 *  コメント・下記 resolveSalesExecutionClient のコメント参照 (地雷: 他メソッドと同じ
 *  resolveClientAndUser(injectedClient) にすると cron/webhook 文脈で ctx が無視され E201 になる)。 */
export type SalesFacadePayments = Pick<
  SalesFacadeExtended,
  "recordPayment" | "deletePayment" | "getSalesDigest" | "markExpiredQuotes" | "getIssuedContentSnapshot"
>;

/** documents.tax_rounding (zTaxRounding と同じリテラル和 — repository.ts の inline 型と 1:1) */
type TaxRounding = "floor" | "round" | "ceil";

// ============================================================
// resolvePrintView (Issue #50 追加 — /print route 専用の橋渡しメソッド)
// ============================================================

/**
 * `/print/documents/[id]` (route group `(print)`、src/app 配下) は ESLint モジュール境界
 * (module-contracts.md §2) により sales/internal/** や sales/repository を直接 import できない
 * (他モジュール — というより「モジュール所属を持たない app 層」— からは facade 経由のみ許可)。
 * そのため、印刷トークンの検証・消費 → document/lines(+staging)/issuer の読み取り →
 * 角印署名 URL 解決までを 1 メソッドに薄くラップして公開する。
 *
 * 07-contracts-delta §D8 の契約メソッドにも 02-sales §6.2 の契約外拡張表にも載っていない
 * (canonical は route 実装がここまでの処理を repository 直読みで行う想定だったと読めるが、
 * 本リポジトリの ESLint 境界は app 層からの repository/internal 直 import を一律禁止しており、
 * telephony webhook (src/lib/telephony-signature.ts 前例) のような「モジュール非所属の共有
 * インフラ」に切り出す代替も、本メソッドは sales 固有の DB アクセス・業務ロジックを多く含むため
 * 適さないと判断した — facade への薄い追加が最も構造に合う。判断根拠を openIssues に記録する)。
 * 他モジュールからの呼び出しは禁止 (契約外拡張と同じ規約)。
 */
export type ResolvedPrintViewLine = {
  position: number;
  description: string;
  quantity: number;
  unit: string;
  unit_price_jpy: number;
  amount_jpy: number;
  tax_category: TaxCategory;
};

export type ResolvedPrintView = {
  docType: DocType;
  /** null = 未採番 (draft プレビュー、または発行フロー中で payload.doc_no も無いケース)。 */
  docNo: string | null;
  issueDate: string | null;
  transactionDate: string | null;
  validUntil: string | null;
  billingName: string;
  billingSuffix: "様" | "御中";
  billingAddress: string | null;
  siteName: string | null;
  siteAddress: string | null;
  notes: string | null;
  subtotalJpy: number;
  taxSummary: TaxSummary;
  totalJpy: number;
  issuer: IssuerSnapshot;
  /** server 側で解決済みの署名 URL (TTL 5 分)。null = 非印字 (未設定 or 解決失敗 — §10.6)。 */
  sealSignedUrl: string | null;
  lines: ResolvedPrintViewLine[];
  /** true = 「下書き(未発行)」透かし表示 (draft かつ purpose='preview' のときのみ — §10.2)。 */
  watermark: boolean;
};

export interface SalesPrintFacade {
  resolvePrintView(documentId: string, token: string): Promise<Result<ResolvedPrintView>>;
  /**
   * admin 印刷プレビュー用トークン発行 (Issue #50 追加。§7.3「発行者」の 2 者のうち admin プレビュー側 —
   * PDF 撮影直前の発行は internal/pdf.ts が担う)。呼び出し元は `src/app/admin/documents/actions.ts`
   * の `createPrintPreviewUrlAction` (#50 追加 — 実際にプレビューを開く UI ボタンは #51 が作る
   * `/admin/documents/[id]` 画面側)。resolvePrintView と同じ理由 (ESLint モジュール境界により
   * app 層は sales/internal/print-token を直接呼べない) でこの薄いブリッジを facade に置く。
   * purpose='preview' で TTL 5 分のトークンを発行し、`/print/documents/{id}?token=…` の絶対 URL を
   * 返す (internal/pdf.ts の自オリジン URL 構築ロジックと同型)。対象帳票の存在確認はしない
   * (存在しない document_id へのトークン発行は実害がなく、/print route 側で E621 拒否される)。
   */
  issuePrintPreviewToken(documentId: string): Promise<Result<{ url: string; expires_at: string }>>;
}

const BRANDING_ASSETS_BUCKET = "branding-assets";
const SEAL_SIGNED_URL_TTL_SECONDS = 300; // 5 分 (§10.6「描画時間内で十分」)
const zRevisionStagingHeader = zReviseDocumentInput.omit({ lines: true });
const zRevisionStagingLines = zDocumentLineInput.array();

// ============================================================
// 共通ヘルパ
// ============================================================

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * facade インスタンス単位で固定された client を CrmFacade/SettingsFacade へ渡す ctx に変換する
 * (実装計画書「地雷10」)。session (injectedClient 省略) は ctx 省略 (= crm/settings 内部で
 * cookie セッションへ解決)、service (injectedClient 指定) は `{mode:'service', client}` を明示する。
 */
function resolveCtx(injectedClient: SupabaseClient | undefined): ExecutionContext | undefined {
  return injectedClient ? { mode: "service", client: injectedClient } : undefined;
}

/**
 * repository 呼び出しに使う client + createdBy (created_by 列用の userId) の解決。
 * injectedClient 指定時はそれをそのまま使い created_by は null (service 実行に session ユーザーは無い)。
 * 省略時は session (未ログインは KMB-E201 — crm/facade.ts の resolveExecutionClient と同型)。
 */
async function resolveClientAndUser(
  injectedClient: SupabaseClient | undefined,
): Promise<Result<{ client: SupabaseClient; userId: string | null }>> {
  if (injectedClient) return { ok: true, value: { client: injectedClient, userId: null } };
  const { supabase, user } = await getSessionAndClient();
  if (!user) return { ok: false, code: "KMB-E201" };
  return { ok: true, value: { client: supabase, userId: user.id } };
}

/**
 * getSalesDigest/markExpiredQuotes 専用の client 解決 (実装計画書「地雷」節 — 最重要)。
 * この 2 メソッドは他の全メソッドと呼び出し規約が違う: 他は `createSalesFacade(injectedClient?)`
 * のファクトリ時点で client が固定される (`resolveClientAndUser(injectedClient)`) が、この 2 つは
 * 07-contracts-delta §D8「§3 の 1 の形」の規約により**呼び出し時**の `ctx` 引数で都度 client を
 * 決める (crm/facade.ts の resolveExecutionClient (facade.ts:234-248) と同型)。
 * crm-digest route は `createSalesFacade().markExpiredQuotes({mode:'service'})` のように
 * **ファクトリは無引数**で呼ぶ想定 (canonical §6.2 表・§7.5) — ここで誤って
 * `resolveClientAndUser(injectedClient)` (ファクトリのクロージャ変数) を使うと、ctx で
 * `{mode:'service'}` を渡しても無視され `getSessionAndClient()` (cookie セッション) に落ちて
 * cron/webhook 文脈で必ず KMB-E201 になる。
 */
async function resolveSalesExecutionClient(
  ctx: ExecutionContext | undefined,
): Promise<Result<{ client: SupabaseClient; userId: string | null }>> {
  if (ctx?.mode === "service") {
    try {
      const client = ctx.client ?? createSupabaseServiceClient();
      return { ok: true, value: { client, userId: null } };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: errMessage(err) };
    }
  }
  const { supabase, user } = await getSessionAndClient();
  if (!user) return { ok: false, code: "KMB-E201" };
  return { ok: true, value: { client: supabase, userId: user.id } };
}

/** 宛名複製 (02-sales §6.1): company 非 null → 会社名+御中+会社住所、null → 顧客名+様+顧客住所。
 *  billing_name/billing_suffix は documents の別カラムであり、文字列連結はしない (DDL §2.3.1)。 */
function deriveBillingFields(
  deal: DealRef,
): { billing_name: string; billing_suffix: "様" | "御中"; billing_address: string | null } {
  if (deal.company !== null) {
    return { billing_name: deal.company.name, billing_suffix: "御中", billing_address: deal.company.address };
  }
  return { billing_name: deal.customer.name, billing_suffix: "様", billing_address: deal.customer.address };
}

/**
 * tax_rounding の解決 (02-sales §6.1): settings 'invoice_issuer' から複製。取得失敗・未設定は
 * 理由を問わず既定 'floor' にフォールバックする (実装計画書「地雷11」— E901 かどうかで分岐しない)。
 */
async function resolveTaxRounding(ctx: ExecutionContext | undefined): Promise<TaxRounding> {
  const issuer = await settingsFacade.get("invoice_issuer", ctx);
  return issuer.ok ? issuer.value.tax_rounding : "floor";
}

/**
 * createDraftDocument / createDraftQuoteFromEstimate 共通コア: deal 参照 → 宛名複製 →
 * tax_rounding 解決 → totals 計算 → repository.createDraftDocument。
 * deriveDocument は billing 系・tax_rounding を派生元から複製する別経路のため、このヘルパは使わない。
 */
async function buildDraftDocumentFromDeal(
  client: SupabaseClient,
  ctx: ExecutionContext | undefined,
  params: {
    doc_type: DocType;
    deal_id: string;
    issue_date: string | null;
    valid_until: string | null;
    site_name: string | null;
    site_address: string | null;
    notes: string | null;
    lines: DocumentLineInput[];
    createdBy: string | null;
  },
): Promise<Result<{ document_id: string }>> {
  const dealRef = await crmFacade.getDealRef(params.deal_id, ctx);
  if (!dealRef.ok) return dealRef;

  const billing = deriveBillingFields(dealRef.value);
  const taxRounding = await resolveTaxRounding(ctx);
  const totals = computeDocumentTotals(params.lines, taxRounding);

  const created = await repoCreateDraftDocument(client, {
    doc_type: params.doc_type,
    deal_id: params.deal_id,
    source_document_id: null,
    billing_name: billing.billing_name,
    billing_suffix: billing.billing_suffix,
    billing_address: billing.billing_address,
    site_name: params.site_name,
    site_address: params.site_address,
    notes: params.notes,
    issue_date: params.issue_date,
    transaction_date: null,
    valid_until: params.valid_until,
    tax_rounding: taxRounding,
    lines: params.lines,
    totals,
    createdBy: params.createdBy,
  });
  if (!created.ok) return created;
  return { ok: true, value: { document_id: created.value.id } };
}

/** 状態遷移イベントの合成 ref による appendActivity 記録 (02-sales §6.2 注記 / §7.9)。
 *  実レコードを生まない遷移 (accepted/declined/voided) は ref_table='documents/'+event, ref_id=document_id。
 *  既に主操作 (status 更新) は成功済みのため、監査記録の失敗で主操作を失敗扱いにはしない
 *  (crm/facade.ts の relinkActivity 監査・updateDealStage lifecycle 昇格と同型の縮退 — warn のみ)。 */
async function recordDocumentEventActivity(
  ctx: ExecutionContext | undefined,
  doc: DocumentRow,
  // "expired" は #51 (markExpiredQuotes) 追加分。zDocumentEventActivityPayload (crm/contracts.ts) の
  // event enum には元から "expired" が含まれている (v1.7 D9 で先取り登録済み) — ここはこのファイル
  // ローカルの呼び出し元限定ユニオンを広げるだけでよい。
  event: "accepted" | "declined" | "voided" | "expired",
  title: string,
): Promise<void> {
  const appended = await crmFacade.appendActivity(
    {
      activity_type: "document_event",
      occurred_at: new Date().toISOString(),
      title,
      body: null,
      payload: {
        document_id: doc.id,
        doc_type: doc.doc_type,
        doc_no: doc.doc_no ?? "",
        event,
        total_jpy: doc.total_jpy,
        version: null,
      },
      ref_table: `documents/${event}`,
      ref_id: doc.id,
      links: [{ customer_id: null, company_id: null, deal_id: doc.deal_id }],
    },
    ctx,
  );
  if (!appended.ok) {
    console.warn(
      `[KMB-E901] ${event} の appendActivity 記録に失敗しました (document=${doc.id}):`,
      appended.code,
      appended.detail,
    );
  }
}

/** deriveDocument 入力 (contracts.ts に明記の無い facade 内部専用スキーマ — source_document_id/to_type
 *  はいずれも sales 自身が所有する契約 (zDocType) のみに依存するため crm 同様の再定義回避は不要)。 */
const zDeriveDocumentInput = z
  .object({
    source_document_id: z.string().uuid(),
    to_type: zDocType,
  })
  .strict();

// ============================================================
// issueDocument / reissueDocument / reviseAndReissueDocument 共通ヘルパ (Issue #50)
// ============================================================

/**
 * JST の「今日」を YYYY-MM-DD (zDateOnly 形式) で返す (§6.1 手順3: issue_date null → JST 今日)。
 * crm/internal/jst.ts は crm モジュール内部専用のため ESLint モジュール境界上 import できない
 * (許容された重複実装 — 契約書 §2 の定石と同型)。repository.ts の resolveJstYear と同じ
 * Intl.DateTimeFormat + Asia/Tokyo 手法 (en-CA ロケールは YYYY-MM-DD 形式を返す)。
 */
function jstTodayDateOnly(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(now);
}

/** JST 暦日 (YYYY-MM-DD) に days 日を加算する (quote_valid_days の適用 — §5.4)。date-only 文字列を
 *  UTC 起点の暦日算術として扱う (zDateOnly はタイムゾーン非依存の暦日表現のため、TZ 変換を経由しない)。 */
function addDaysToDateOnly(dateOnly: string, days: number): string {
  const d = new Date(`${dateOnly}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** DocumentLineRow → DocumentLineInput (document_save_draft RPC の p_lines / totals 計算の入力形式)。
 *  position/id/document_id/created_at を落とす (getDocumentDetail の既存 map と同型)。 */
function toDocumentLineInput(l: {
  description: string;
  quantity: number;
  unit: string;
  unit_price_jpy: number;
  amount_jpy: number;
  tax_category: string;
  work_type_key: string | null;
  source: unknown;
}): DocumentLineInput {
  return {
    description: l.description,
    quantity: l.quantity,
    unit: l.unit,
    unit_price_jpy: l.unit_price_jpy,
    amount_jpy: l.amount_jpy,
    tax_category: l.tax_category as TaxCategory,
    work_type_key: l.work_type_key,
    source: l.source as { grade_key: string; size_key: string; option_keys: string[] } | null,
  };
}

/**
 * 発行時ガード (02-sales §5.3「発行時ガード」— issueDocument / reviseAndReissueDocument 共通)。
 * 1. 各税率区分の taxable_jpy < 0 → E101 (値引きが課税標準を超過)
 * 2. total_jpy < 0 → E101
 * 3. doc_type='invoice' かつ total_jpy = 0 → E101 (0 円請求書は payments で完済に到達できず
 *    未消込のまま恒久残留するため — §2.4 パターン 23。quote/order/delivery の 0 円は許容)
 */
function validateIssueTaxGuard(docType: DocType, totals: DocumentTotals): Result<void> {
  for (const entry of totals.tax_summary) {
    if (entry.taxable_jpy < 0) {
      return {
        ok: false,
        code: "KMB-E101",
        detail: `値引きが課税対象額を超えています (区分: ${entry.tax_category})`,
      };
    }
  }
  if (totals.total_jpy < 0) {
    return { ok: false, code: "KMB-E101", detail: "合計金額がマイナスです。" };
  }
  if (docType === "invoice" && totals.total_jpy === 0) {
    return { ok: false, code: "KMB-E101", detail: "請求金額が 0 円の請求書は発行できません。" };
  }
  return { ok: true, value: undefined };
}

/** issued_documents.content_snapshot (zIssuedContentSnapshot) の構築 + 検証。zod parse を通す
 *  ことで、settings/documents 側の型と canonical 契約の乖離を握り潰さず E901 で顕在化させる
 *  (issuer.ts の buildIssuerSnapshot 末尾と同型の防御)。 */
function buildIssuedContentSnapshot(params: {
  docType: DocType;
  docNo: string;
  version: number;
  issueDate: string;
  transactionDate: string;
  validUntil: string | null;
  billingName: string;
  billingSuffix: "様" | "御中";
  billingAddress: string | null;
  siteName: string | null;
  siteAddress: string | null;
  notes: string | null;
  taxRounding: TaxRounding;
  issuer: IssuerSnapshot;
  lines: Array<{
    position: number;
    description: string;
    quantity: number;
    unit: string;
    unit_price_jpy: number;
    amount_jpy: number;
    tax_category: TaxCategory;
  }>;
  totals: DocumentTotals;
}): Result<IssuedContentSnapshot> {
  const candidate: IssuedContentSnapshot = {
    doc_type: params.docType,
    doc_no: params.docNo,
    version: params.version,
    issue_date: params.issueDate,
    transaction_date: params.transactionDate,
    valid_until: params.validUntil,
    billing_name: params.billingName,
    billing_suffix: params.billingSuffix,
    billing_address: params.billingAddress,
    site_name: params.siteName,
    site_address: params.siteAddress,
    notes: params.notes,
    tax_rounding: params.taxRounding,
    issuer: params.issuer,
    lines: params.lines,
    subtotal_jpy: params.totals.subtotal_jpy,
    tax_summary: params.totals.tax_summary,
    total_jpy: params.totals.total_jpy,
  };
  const parsed = zIssuedContentSnapshot.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      code: "KMB-E901",
      detail: `content_snapshot の構築に失敗しました (zIssuedContentSnapshot と不一致): ${parsed.error.message}`,
    };
  }
  return { ok: true, value: parsed.data };
}

/**
 * issueDocument/reissueDocument/reviseAndReissueDocument 共通: PDF 生成・印刷トークン・
 * pdf_render_lock はいずれも service 専用テーブル/Storage のため、admin セッション client
 * (authenticated ロール) とは別に service client を用意する (createDraftQuoteFromEstimate と
 * 同じパターン)。injectedClient 指定時 (テスト注入) はそれをそのまま service 用途にも使う。
 */
function resolvePdfServiceClient(injectedClient: SupabaseClient | undefined): Result<SupabaseClient> {
  try {
    return { ok: true, value: injectedClient ?? createSupabaseServiceClient() };
  } catch (err) {
    return { ok: false, code: "KMB-E640", detail: errMessage(err) };
  }
}

/** PRINT_TOKEN_SECRET / SUPABASE_SERVICE_ROLE_KEY の degrade 判定 (§6.1 手順1)。
 *  未設定時は PDF 生成に必ず失敗するため、Chromium 起動前に早期リターンする。 */
function checkIssuancePrerequisites(): Result<void> {
  if (!isServiceRoleConfigured() || !isPrintTokenSecretConfigured()) {
    return {
      ok: false,
      code: "KMB-E640",
      detail: "PRINT_TOKEN_SECRET または SUPABASE_SERVICE_ROLE_KEY が未設定です。PDF を生成できません。",
    };
  }
  return { ok: true, value: undefined };
}

// ============================================================
// facade 実装
// ============================================================

export function createSalesFacade(
  injectedClient?: SupabaseClient,
): SalesFacadeCore & SalesFacadeIssuance & SalesFacadePayments & SalesPrintFacade {
  const ctx = resolveCtx(injectedClient);

  return {
    // ---- 契約メソッド (07-contracts-delta §D8) ----

    async createDraftDocument(rawInput) {
      try {
        const parsed = zCreateDocumentInput.safeParse(rawInput);
        if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

        // quote 以外での valid_until 非 null は facade 側で E101 拒否する (updateDraftDocument と同じ
        // ガード — DB check (documents_valid_until_check) に頼ると生の E901 になり受入基準を満たさない)。
        // zCreateDocumentInput は doc_type を持つため、getDocumentById での再取得は不要。
        if (parsed.data.doc_type !== "quote" && parsed.data.valid_until !== null) {
          return {
            ok: false,
            code: "KMB-E101",
            detail: "見積以外の帳票には有効期限 (valid_until) を設定できません。",
          };
        }

        const resolved = await resolveClientAndUser(injectedClient);
        if (!resolved.ok) return resolved;
        const { client, userId } = resolved.value;

        return buildDraftDocumentFromDeal(client, ctx, {
          doc_type: parsed.data.doc_type,
          deal_id: parsed.data.deal_id,
          issue_date: parsed.data.issue_date,
          valid_until: parsed.data.valid_until,
          site_name: parsed.data.site_name,
          site_address: parsed.data.site_address,
          notes: parsed.data.notes,
          lines: parsed.data.lines,
          createdBy: userId,
        });
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async createDraftQuoteFromEstimate(rawInput) {
      try {
        // 常時 service 実行 (facade の生成方法に関わらず)。deal_id のみ実行時検証する — estimate は
        // crm 所有の SimEstimateSnapshot 契約 (型 import のみ許可。zod スキーマは再 import しない —
        // 実装計画書「モジュール境界」注記) のため、呼び出し元 (crm 側) で既に検証済みの値として扱う。
        const dealIdCheck = z.string().uuid().safeParse(rawInput.deal_id);
        if (!dealIdCheck.success) {
          return { ok: false, code: "KMB-E101", detail: dealIdCheck.error.message };
        }

        let serviceClient: SupabaseClient;
        try {
          serviceClient = injectedClient ?? createSupabaseServiceClient();
        } catch (err) {
          return { ok: false, code: "KMB-E901", detail: errMessage(err) };
        }
        const serviceCtx: ExecutionContext = { mode: "service", client: serviceClient };

        const draft = buildSimulatorQuoteDraft(rawInput.estimate);

        return buildDraftDocumentFromDeal(serviceClient, serviceCtx, {
          doc_type: "quote",
          deal_id: dealIdCheck.data,
          issue_date: null,
          valid_until: null,
          site_name: null,
          site_address: null,
          notes: draft.notes,
          lines: draft.lines,
          createdBy: null,
        });
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async deriveDocument(rawInput) {
      try {
        const parsed = zDeriveDocumentInput.safeParse(rawInput);
        if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

        const resolved = await resolveClientAndUser(injectedClient);
        if (!resolved.ok) return resolved;
        const { client, userId } = resolved.value;

        const sourceResult = await getDocumentById(client, parsed.data.source_document_id);
        if (!sourceResult.ok) return sourceResult;
        const source = sourceResult.value;
        if (!source) {
          return { ok: false, code: "KMB-E623", detail: "派生元の帳票が見つかりません。" };
        }

        const allowed = DERIVATION_RULES.some(
          (rule) => rule.from === source.doc_type && rule.to === parsed.data.to_type,
        );
        if (!allowed) {
          return { ok: false, code: "KMB-E623", detail: "この書類種別への派生は許可されていません。" };
        }
        if (source.status !== "issued" && source.status !== "accepted") {
          return {
            ok: false,
            code: "KMB-E623",
            detail: "派生元は発行済みまたは承諾済みである必要があります。",
          };
        }

        const sourceLinesResult = await listDocumentLines(client, source.id);
        if (!sourceLinesResult.ok) return sourceLinesResult;

        const derivedLines = buildDerivedDocumentLines(
          sourceLinesResult.value.map((line) => ({
            position: line.position,
            description: line.description,
            quantity: line.quantity,
            unit: line.unit,
            unit_price_jpy: line.unit_price_jpy,
            amount_jpy: line.amount_jpy,
            tax_category: line.tax_category as TaxCategory,
            work_type_key: line.work_type_key,
            source: line.source as { grade_key: string; size_key: string; option_keys: string[] } | null,
          })),
        );

        const transactionDate = resolveDerivedTransactionDate(
          source.doc_type as DocType,
          parsed.data.to_type,
          source.issue_date,
        );
        const taxRounding = source.tax_rounding as TaxRounding;
        const totals = computeDocumentTotals(derivedLines, taxRounding);

        const created = await repoCreateDraftDocument(client, {
          doc_type: parsed.data.to_type,
          deal_id: source.deal_id,
          source_document_id: source.id,
          billing_name: source.billing_name,
          billing_suffix: source.billing_suffix as "様" | "御中",
          billing_address: source.billing_address,
          site_name: source.site_name,
          site_address: source.site_address,
          notes: source.notes,
          issue_date: null,
          transaction_date: transactionDate,
          valid_until: null,
          tax_rounding: taxRounding,
          lines: derivedLines,
          totals,
          createdBy: userId,
        });
        if (!created.ok) return created;
        return { ok: true, value: { document_id: created.value.id } };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    /**
     * canonical: 02-sales.md §6.1 issueDocument (9 段階シーケンス、実装計画書「issueDocument
     * 実装順序」節と 1:1)。エラー全列挙: E101/E103/E620/E621/E622/E626/E640/E641/E643/E901。
     */
    async issueDocument(documentId, expectedUpdatedAt) {
      try {
        const resolved = await resolveClientAndUser(injectedClient);
        if (!resolved.ok) return resolved;
        const { client } = resolved.value;

        // 手順1 前提検証 (draft/明細/env)
        const docResult = await getDocumentById(client, documentId);
        if (!docResult.ok) return docResult;
        const doc = docResult.value;
        if (!doc) return { ok: false, code: "KMB-E621", detail: "帳票が見つかりません。" };
        if (doc.status !== "draft") {
          return { ok: false, code: "KMB-E621", detail: `draft 以外は発行できません (現在: ${doc.status})。` };
        }

        const linesResult = await listDocumentLines(client, documentId);
        if (!linesResult.ok) return linesResult;
        if (linesResult.value.length === 0) {
          return { ok: false, code: "KMB-E620", detail: "明細が 0 行のため発行できません。" };
        }
        const lineInputs = linesResult.value.map(toDocumentLineInput);

        const taxRounding = doc.tax_rounding as TaxRounding;
        const totals = computeDocumentTotals(lineInputs, taxRounding);
        const taxGuard = validateIssueTaxGuard(doc.doc_type as DocType, totals);
        if (!taxGuard.ok) return taxGuard;

        const prereq = checkIssuancePrerequisites();
        if (!prereq.ok) return prereq;
        const serviceClientResult = resolvePdfServiceClient(injectedClient);
        if (!serviceClientResult.ok) return serviceClientResult;
        const serviceClient = serviceClientResult.value;

        // 手順2 issuer_snapshot 合成 (settingsFacade.get('invoice_issuer') 不在/issuer_name 空 → E626)
        const issuerResult = await buildIssuerSnapshot(ctx);
        if (!issuerResult.ok) return issuerResult;
        const issuer = issuerResult.value;

        // 手順3 issue_date 確定 + quote の valid_until 補完 + 事前保存 (CAS チェーン)
        const issueDate = doc.issue_date ?? jstTodayDateOnly();
        let validUntil = doc.valid_until;
        if (doc.doc_type === "quote" && validUntil === null) {
          const issuerSettings = await settingsFacade.get("invoice_issuer", ctx);
          if (!issuerSettings.ok) {
            return {
              ok: false,
              code: "KMB-E626",
              detail: "請求書発行者の設定 (invoice_issuer) が見つかりません。",
            };
          }
          validUntil = addDaysToDateOnly(issueDate, issuerSettings.value.quote_valid_days);
        }

        const saved = await saveDraftDocument(
          client,
          documentId,
          expectedUpdatedAt,
          {
            issue_date: issueDate,
            transaction_date: doc.transaction_date,
            valid_until: validUntil,
            billing_name: doc.billing_name,
            billing_suffix: doc.billing_suffix as "様" | "御中",
            billing_address: doc.billing_address,
            site_name: doc.site_name,
            site_address: doc.site_address,
            notes: doc.notes,
            tax_rounding: taxRounding,
          },
          lineInputs,
          totals,
        );
        if (!saved.ok) return saved;

        // 手順4 採番 (この時点で番号は消費される — 以後の失敗は欠番として許容)
        const numbered = await issueDocumentNumber(client, doc.doc_type as DocType, issueDate);
        if (!numbered.ok) return numbered;

        // 手順5〜6 PDF 生成 + Storage 保存 (service client。doc_no は payload 経由 — DB 未保存のため)
        const pdfResult = await generateDocumentPdf(serviceClient, {
          documentId,
          version: 1,
          purpose: "pdf",
          payload: { doc_no: numbered.value.doc_no },
        });
        if (!pdfResult.ok) return pdfResult;

        const transactionDate = doc.transaction_date ?? issueDate;
        const snapshotResult = buildIssuedContentSnapshot({
          docType: doc.doc_type as DocType,
          docNo: numbered.value.doc_no,
          version: 1,
          issueDate,
          transactionDate,
          validUntil,
          billingName: doc.billing_name,
          billingSuffix: doc.billing_suffix as "様" | "御中",
          billingAddress: doc.billing_address,
          siteName: doc.site_name,
          siteAddress: doc.site_address,
          notes: doc.notes,
          taxRounding,
          issuer,
          lines: linesResult.value.map((l) => ({
            position: l.position,
            description: l.description,
            quantity: l.quantity,
            unit: l.unit,
            unit_price_jpy: l.unit_price_jpy,
            amount_jpy: l.amount_jpy,
            tax_category: l.tax_category as TaxCategory,
          })),
          totals,
        });
        if (!snapshotResult.ok) return snapshotResult;

        // 手順7 RPC document_finalize_issue (手順3 で更新された updated_at を CAS に使用)
        const finalized = await finalizeDocumentIssue(client, {
          documentId,
          expectedUpdatedAt: saved.value.updated_at,
          docNo: numbered.value.doc_no,
          issueDate,
          subtotalJpy: totals.subtotal_jpy,
          taxSummary: totals.tax_summary,
          totalJpy: totals.total_jpy,
          issuerSnapshot: issuer,
          sha256: pdfResult.value.sha256,
          storagePath: pdfResult.value.storagePath,
          counterparty: doc.billing_name,
          contentSnapshot: snapshotResult.value,
        });
        if (!finalized.ok) return finalized;

        // 手順8 appendActivity (失敗しても発行は成立 — console.warn + 乖離バッジ)
        const event: DocumentEventActivityPayload = {
          document_id: documentId,
          doc_type: doc.doc_type as DocType,
          doc_no: numbered.value.doc_no,
          event: "issued",
          total_jpy: totals.total_jpy,
          version: 1,
        };
        const appended = await crmFacade.appendActivity(
          {
            activity_type: "document_event",
            occurred_at: new Date().toISOString(),
            title: `発行: ${numbered.value.doc_no}`,
            body: null,
            payload: event,
            ref_table: "issued_documents",
            ref_id: finalized.value.issued_document_id,
            links: [{ customer_id: null, company_id: null, deal_id: doc.deal_id }],
          },
          ctx,
        );
        if (!appended.ok) {
          console.warn(
            `[KMB-E901] issued の appendActivity 記録に失敗しました (document=${documentId}):`,
            appended.code,
            appended.detail,
          );
        }

        // 手順9: 戻り値 event を返す (app 層が CrmFacade.updateDealStage を呼ぶ — sales は
        // deal.stage を書かない — §4.6)
        return {
          ok: true,
          value: {
            doc_no: numbered.value.doc_no,
            version: 1,
            pdf_storage_path: pdfResult.value.storagePath,
            event,
          },
        };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    /**
     * canonical: 02-sales.md §4.3-A / §6.1 reissueDocument。内容同一の再出力 (PDF 撮り直し →
     * Storage 保存 → RPC document_append_version → appendActivity('reissued'))。
     * エラー: E103/E621/E627/E640/E641/E643/E901。
     */
    async reissueDocument(documentId, expectedUpdatedAt) {
      try {
        const resolved = await resolveClientAndUser(injectedClient);
        if (!resolved.ok) return resolved;
        const { client } = resolved.value;

        const docResult = await getDocumentById(client, documentId);
        if (!docResult.ok) return docResult;
        const doc = docResult.value;
        if (!doc) return { ok: false, code: "KMB-E621", detail: "帳票が見つかりません。" };
        if (doc.status !== "issued" && doc.status !== "accepted" && doc.status !== "paid") {
          return {
            ok: false,
            code: "KMB-E621",
            detail: `この状態の帳票は再出力できません (現在: ${doc.status})。`,
          };
        }
        if (doc.doc_no === null || doc.issue_date === null) {
          // 発行済み系状態であれば doc_no/issue_date は必ず確定済み (document_finalize_issue が
          // 同一トランザクションで設定する) — 到達すれば台帳との不整合 (地雷回避: 握り潰さず E627)。
          return { ok: false, code: "KMB-E627", detail: "書類番号または発行日が未確定です。" };
        }

        const prereq = checkIssuancePrerequisites();
        if (!prereq.ok) return prereq;
        const serviceClientResult = resolvePdfServiceClient(injectedClient);
        if (!serviceClientResult.ok) return serviceClientResult;
        const serviceClient = serviceClientResult.value;

        const version = doc.current_version + 1;
        const pdfResult = await generateDocumentPdf(serviceClient, {
          documentId,
          version,
          purpose: "pdf",
          payload: null, // 内容同一 — DB 現在値のみで描画 (§4.3-A)
        });
        if (!pdfResult.ok) return pdfResult;

        const linesResult = await listDocumentLines(client, documentId);
        if (!linesResult.ok) return linesResult;

        const issuerParsed = zIssuerSnapshot.safeParse(doc.issuer_snapshot);
        if (!issuerParsed.success) {
          return {
            ok: false,
            code: "KMB-E901",
            detail: "発行済み帳票の issuer_snapshot が契約 (zIssuerSnapshot) と一致しません。",
          };
        }

        const transactionDate = doc.transaction_date ?? doc.issue_date;
        const snapshotResult = buildIssuedContentSnapshot({
          docType: doc.doc_type as DocType,
          docNo: doc.doc_no,
          version,
          issueDate: doc.issue_date,
          transactionDate,
          validUntil: doc.valid_until,
          billingName: doc.billing_name,
          billingSuffix: doc.billing_suffix as "様" | "御中",
          billingAddress: doc.billing_address,
          siteName: doc.site_name,
          siteAddress: doc.site_address,
          notes: doc.notes,
          taxRounding: doc.tax_rounding as TaxRounding,
          issuer: issuerParsed.data,
          lines: linesResult.value.map((l) => ({
            position: l.position,
            description: l.description,
            quantity: l.quantity,
            unit: l.unit,
            unit_price_jpy: l.unit_price_jpy,
            amount_jpy: l.amount_jpy,
            tax_category: l.tax_category as TaxCategory,
          })),
          totals: { subtotal_jpy: doc.subtotal_jpy, tax_summary: doc.tax_summary as TaxSummary, total_jpy: doc.total_jpy },
        });
        if (!snapshotResult.ok) return snapshotResult;

        const appendedVersion = await appendDocumentVersion(client, {
          documentId,
          expectedUpdatedAt,
          sha256: pdfResult.value.sha256,
          storagePath: pdfResult.value.storagePath,
          counterparty: doc.billing_name,
          contentSnapshot: snapshotResult.value,
        });
        if (!appendedVersion.ok) return appendedVersion;

        const event: DocumentEventActivityPayload = {
          document_id: documentId,
          doc_type: doc.doc_type as DocType,
          doc_no: doc.doc_no,
          event: "reissued",
          total_jpy: doc.total_jpy,
          version: appendedVersion.value.doc_version,
        };
        const appended = await crmFacade.appendActivity(
          {
            activity_type: "document_event",
            occurred_at: new Date().toISOString(),
            title: `再出力: ${doc.doc_no} (v${appendedVersion.value.doc_version})`,
            body: null,
            payload: event,
            ref_table: "issued_documents",
            ref_id: appendedVersion.value.issued_document_id,
            links: [{ customer_id: null, company_id: null, deal_id: doc.deal_id }],
          },
          ctx,
        );
        if (!appended.ok) {
          console.warn(
            `[KMB-E901] reissued の appendActivity 記録に失敗しました (document=${documentId}):`,
            appended.code,
            appended.detail,
          );
        }

        return {
          ok: true,
          value: { version: appendedVersion.value.doc_version, pdf_storage_path: pdfResult.value.storagePath },
        };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    /**
     * canonical: 02-sales.md §6.1 recordPayment (#51)。Zod → insertPayment (repository。
     * payments_apply trigger が invoice/issued 限定・残高超過ガードを担うため facade 側で
     * 重複検証しない — E621/E623/E625 は trigger の raise exception を pgErrorToResult が
     * KMB コードへ変換する) → 直後に documents を再取得 (地雷: PaymentRow には document の
     * 最新 status が含まれないため、trigger が書き換えた status='paid' を確認するには再取得が
     * 必須) → listPayments で合算し balance_jpy を算出 → appendActivity
     * (event: invoice_paid ? 'paid' : 'payment_recorded'。失敗は warn のみ — 主操作は成功のまま、
     * issueDocument 等と同じ縮退パターン)。
     * エラー: E101(Zod) / E621・E623・E625(trigger 由来) / E901。
     */
    async recordPayment(rawInput) {
      try {
        const parsed = zPaymentInput.safeParse(rawInput);
        if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

        const resolved = await resolveClientAndUser(injectedClient);
        if (!resolved.ok) return resolved;
        const { client, userId } = resolved.value;

        const inserted = await insertPayment(client, parsed.data, userId);
        if (!inserted.ok) return inserted;

        const docResult = await getDocumentById(client, parsed.data.document_id);
        if (!docResult.ok) return docResult;
        const doc = docResult.value;
        if (!doc) {
          return { ok: false, code: "KMB-E901", detail: "入金記録直後に帳票の再取得に失敗しました。" };
        }
        const invoicePaid = doc.status === "paid";

        const paymentsResult = await listPayments(client, parsed.data.document_id);
        if (!paymentsResult.ok) return paymentsResult;
        const paidTotal = paymentsResult.value.reduce((sum, p) => sum + p.amount_jpy, 0);
        const balanceJpy = doc.total_jpy - paidTotal;

        const event: DocumentEventActivityPayload = {
          document_id: parsed.data.document_id,
          doc_type: doc.doc_type as DocType,
          doc_no: doc.doc_no ?? "",
          event: invoicePaid ? "paid" : "payment_recorded",
          total_jpy: doc.total_jpy,
          version: doc.current_version,
        };
        const title = invoicePaid
          ? `入金記録: ¥${inserted.value.amount_jpy.toLocaleString("ja-JP")} (完済)`
          : `入金記録: ¥${inserted.value.amount_jpy.toLocaleString("ja-JP")} (残高 ¥${balanceJpy.toLocaleString("ja-JP")})`;

        const appended = await crmFacade.appendActivity(
          {
            activity_type: "document_event",
            occurred_at: new Date().toISOString(),
            title,
            body: null,
            payload: event,
            ref_table: "payments",
            ref_id: inserted.value.id,
            links: [{ customer_id: null, company_id: null, deal_id: doc.deal_id }],
          },
          ctx,
        );
        if (!appended.ok) {
          console.warn(
            `[KMB-E901] ${event.event} の appendActivity 記録に失敗しました (document=${parsed.data.document_id}):`,
            appended.code,
            appended.detail,
          );
        }

        return { ok: true, value: { payment_id: inserted.value.id, invoice_paid: invoicePaid, event } };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    /**
     * canonical: 02-sales.md §6.1 getDocumentLinesForBlocks。scheduling へ渡す用 (app 層合成)。
     * 対象: doc_type='order' の issued/accepted のみ (draft は E621、それ以外は E623)。
     * grade_key/size_key は空文字を null に正規化する (§6.1 注記)。
     */
    async getDocumentLinesForBlocks(documentId) {
      try {
        const resolved = await resolveClientAndUser(injectedClient);
        if (!resolved.ok) return resolved;
        const { client } = resolved.value;

        const docResult = await getDocumentById(client, documentId);
        if (!docResult.ok) return docResult;
        const doc = docResult.value;
        if (!doc) return { ok: false, code: "KMB-E621", detail: "帳票が見つかりません。" };
        if (doc.status === "draft") {
          return { ok: false, code: "KMB-E621", detail: "draft の帳票は対象外です。" };
        }
        if (doc.doc_type !== "order" || (doc.status !== "issued" && doc.status !== "accepted")) {
          return {
            ok: false,
            code: "KMB-E623",
            detail: "受注 (issued または accepted) の帳票のみ対象です。",
          };
        }

        const linesResult = await listDocumentLines(client, documentId);
        if (!linesResult.ok) return linesResult;

        const normalize = (v: string | undefined | null): string | null => {
          const trimmed = v?.trim() ?? "";
          return trimmed.length > 0 ? trimmed : null;
        };

        const value = linesResult.value.map((l) => {
          const source = l.source as { grade_key: string; size_key: string; option_keys: string[] } | null;
          return {
            description: l.description,
            work_type_key: l.work_type_key,
            quantity: l.quantity,
            grade_key: normalize(source?.grade_key),
            size_key: normalize(source?.size_key),
          };
        });
        return { ok: true, value };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    /**
     * canonical: 02-sales.md §6.1 createSignedPdfUrl。台帳行 (document_id, version) から
     * storage_path を引き、署名 URL (TTL 10 分) を service client で発行する。
     * エラー: E627 (版なし) / E641 (署名 URL 発行失敗) / E901。
     */
    async createSignedPdfUrl(documentId, version) {
      try {
        const serviceClientResult = resolvePdfServiceClient(injectedClient);
        if (!serviceClientResult.ok) {
          return { ok: false, code: "KMB-E901", detail: serviceClientResult.detail };
        }
        const serviceClient = serviceClientResult.value;

        const versionResult = await getIssuedDocumentByVersion(serviceClient, documentId, version);
        if (!versionResult.ok) return versionResult;
        if (!versionResult.value) {
          return { ok: false, code: "KMB-E627", detail: "指定の版が台帳に見つかりません。" };
        }

        const ttlSeconds = 600; // TTL 10 分 (§6.1)
        const { data, error } = await serviceClient.storage
          .from("issued-documents")
          .createSignedUrl(versionResult.value.storage_path, ttlSeconds);
        if (error || !data) {
          return { ok: false, code: "KMB-E641", detail: error?.message ?? "署名 URL の発行に失敗しました。" };
        }

        return {
          ok: true,
          value: { url: data.signedUrl, expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString() },
        };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    // ---- 契約外拡張 (02-sales.md §6.2、#49 実装分) ----

    async listDocuments(rawFilter, rawPage) {
      try {
        const filterParsed = zDocumentListFilter.safeParse(rawFilter);
        if (!filterParsed.success) return { ok: false, code: "KMB-E101", detail: filterParsed.error.message };
        const pageParsed = zPagination.safeParse(rawPage);
        if (!pageParsed.success) return { ok: false, code: "KMB-E101", detail: pageParsed.error.message };

        const resolved = await resolveClientAndUser(injectedClient);
        if (!resolved.ok) return resolved;
        const { client } = resolved.value;

        const page = await listDocumentsPage(
          client,
          {
            doc_type: filterParsed.data.doc_type,
            status: filterParsed.data.status,
            deal_id: filterParsed.data.deal_id,
            q: filterParsed.data.q,
          },
          pageParsed.data,
        );
        if (!page.ok) return page;

        const dealIds = [...new Set(page.value.items.map((d) => d.deal_id))];
        const dealRefs = await crmFacade.getDealRefs(dealIds, ctx);
        if (!dealRefs.ok) return dealRefs;
        const dealTitleMap = new Map(dealRefs.value.map((d) => [d.deal_id, d.title]));

        const items: DocumentListItem[] = page.value.items.map((d) => ({
          id: d.id,
          doc_type: d.doc_type as DocType,
          status: d.status,
          doc_no: d.doc_no,
          billing_name: d.billing_name,
          deal_id: d.deal_id,
          deal_title: dealTitleMap.get(d.deal_id) ?? "(不明)",
          total_jpy: d.total_jpy,
          issue_date: d.issue_date,
          created_at: d.created_at,
          updated_at: d.updated_at,
          source_document_id: d.source_document_id,
        }));

        return { ok: true, value: { items, next_cursor: page.value.next_cursor } };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async getDocumentDetail(documentId) {
      try {
        const resolved = await resolveClientAndUser(injectedClient);
        if (!resolved.ok) return resolved;
        const { client } = resolved.value;

        const docResult = await getDocumentById(client, documentId);
        if (!docResult.ok) return docResult;
        const doc = docResult.value;
        if (!doc) return { ok: false, code: "KMB-E621", detail: "帳票が見つかりません。" };

        const [linesResult, paymentsResult, dealRef, versionsResult] = await Promise.all([
          listDocumentLines(client, documentId),
          listPayments(client, documentId),
          crmFacade.getDealRef(doc.deal_id, ctx),
          listIssuedDocumentVersions(client, documentId),
        ]);
        if (!linesResult.ok) return linesResult;
        if (!paymentsResult.ok) return paymentsResult;
        if (!dealRef.ok) return dealRef;
        if (!versionsResult.ok) return versionsResult;

        const paidTotal = paymentsResult.value.reduce((sum, p) => sum + p.amount_jpy, 0);

        const detail: DocumentDetail = {
          document: {
            id: doc.id,
            doc_type: doc.doc_type as DocType,
            status: doc.status,
            doc_no: doc.doc_no,
            billing_name: doc.billing_name,
            deal_id: doc.deal_id,
            deal_title: dealRef.value.title,
            total_jpy: doc.total_jpy,
            issue_date: doc.issue_date,
            created_at: doc.created_at,
            updated_at: doc.updated_at,
            source_document_id: doc.source_document_id,
            current_version: doc.current_version,
            transaction_date: doc.transaction_date,
            valid_until: doc.valid_until,
            billing_suffix: doc.billing_suffix as "様" | "御中",
            billing_address: doc.billing_address,
            site_name: doc.site_name,
            site_address: doc.site_address,
            notes: doc.notes,
            tax_rounding: doc.tax_rounding as TaxRounding,
            subtotal_jpy: doc.subtotal_jpy,
            tax_summary: doc.tax_summary as TaxSummary,
            issuer_snapshot: doc.issuer_snapshot as IssuerSnapshot | null,
            status_reason: doc.status_reason,
            issued_at: doc.issued_at,
            paid_at: doc.paid_at,
          },
          lines: linesResult.value.map((l) => ({
            id: l.id,
            position: l.position,
            description: l.description,
            quantity: l.quantity,
            unit: l.unit,
            unit_price_jpy: l.unit_price_jpy,
            amount_jpy: l.amount_jpy,
            tax_category: l.tax_category as TaxCategory,
            work_type_key: l.work_type_key,
            source: l.source as { grade_key: string; size_key: string; option_keys: string[] } | null,
          })),
          payments: paymentsResult.value.map((p) => ({
            id: p.id,
            paid_on: p.paid_on,
            amount_jpy: p.amount_jpy,
            method: p.method as "bank_transfer" | "cash" | "other",
            memo: p.memo,
            created_at: p.created_at,
          })),
          // issued_documents (版履歴)。content_snapshot は軽量な DocumentDetail.versions 型に含めない
          // (版間差分ダイアログはこの一覧を使わず、開いたときに getIssuedContentSnapshot で
          // 該当 2 版分を別途遅延ロードする — 実装計画書「成果物6」)。
          versions: versionsResult.value.map((v) => ({
            issued_document_id: v.issued_document_id,
            version: v.version,
            sha256: v.sha256,
            issued_at: v.issued_at,
            supersedes: v.supersedes,
            storage_path: v.storage_path,
          })),
          balance_jpy: doc.total_jpy - paidTotal,
          derivable_to: computeDerivableTo(doc.doc_type as DocType, doc.status as DocumentStatus),
        };

        return { ok: true, value: detail };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async updateDraftDocument(documentId, rawInput, expectedUpdatedAt) {
      try {
        const parsed = zUpdateDraftDocumentInput.safeParse(rawInput);
        if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

        const resolved = await resolveClientAndUser(injectedClient);
        if (!resolved.ok) return resolved;
        const { client } = resolved.value;

        // quote 以外での valid_until 非 null は facade 側で E101 拒否する (実装計画書「地雷3」— DB
        // check (documents_valid_until_check) に頼ると生の E901 になり受入基準を満たさない)。
        // 対象が見つからない場合はこの pre-check を素通りさせ、RPC 自身の KMB-E621 に委ねる
        // (matrix — 02-sales §6.3 — に updateDraftDocument の E621 は無いため facade で重複実装しない)。
        const docResult = await getDocumentById(client, documentId);
        if (!docResult.ok) return docResult;
        const doc = docResult.value;
        if (doc && doc.doc_type !== "quote" && parsed.data.valid_until !== null) {
          return {
            ok: false,
            code: "KMB-E101",
            detail: "見積以外の帳票には有効期限 (valid_until) を設定できません。",
          };
        }

        const totals = computeDocumentTotals(parsed.data.lines, parsed.data.tax_rounding);

        const saved = await saveDraftDocument(
          client,
          documentId,
          expectedUpdatedAt,
          {
            issue_date: parsed.data.issue_date,
            transaction_date: parsed.data.transaction_date,
            valid_until: parsed.data.valid_until,
            billing_name: parsed.data.billing_name,
            billing_suffix: parsed.data.billing_suffix,
            billing_address: parsed.data.billing_address,
            site_name: parsed.data.site_name,
            site_address: parsed.data.site_address,
            notes: parsed.data.notes,
            tax_rounding: parsed.data.tax_rounding,
          },
          parsed.data.lines,
          totals,
        );
        if (!saved.ok) return saved;
        return { ok: true, value: { updated_at: saved.value.updated_at } };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async deleteDraftDocument(documentId, expectedUpdatedAt) {
      try {
        const resolved = await resolveClientAndUser(injectedClient);
        if (!resolved.ok) return resolved;
        const { client } = resolved.value;
        return repoDeleteDraftDocument(client, documentId, expectedUpdatedAt);
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async acceptQuote(documentId, expectedUpdatedAt) {
      try {
        const resolved = await resolveClientAndUser(injectedClient);
        if (!resolved.ok) return resolved;
        const { client } = resolved.value;

        const docResult = await getDocumentById(client, documentId);
        if (!docResult.ok) return docResult;
        const doc = docResult.value;
        if (!doc) return { ok: false, code: "KMB-E621", detail: "帳票が見つかりません。" };
        if (doc.doc_type !== "quote") {
          return { ok: false, code: "KMB-E621", detail: "見積のみ承諾できます。" };
        }
        if (!canTransition("quote", doc.status as DocumentStatus, "accepted")) {
          return { ok: false, code: "KMB-E621", detail: "現在の状態からは承諾できません。" };
        }

        const updated = await updateDocumentStatusWithCas(
          client,
          documentId,
          { status: "accepted", status_reason: null, voided_at: null },
          expectedUpdatedAt,
        );
        if (!updated.ok) return updated;

        await recordDocumentEventActivity(ctx, updated.value, "accepted", "見積承諾");
        return { ok: true, value: undefined };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async declineQuote(documentId, reason, expectedUpdatedAt) {
      try {
        const resolved = await resolveClientAndUser(injectedClient);
        if (!resolved.ok) return resolved;
        const { client } = resolved.value;

        const docResult = await getDocumentById(client, documentId);
        if (!docResult.ok) return docResult;
        const doc = docResult.value;
        if (!doc) return { ok: false, code: "KMB-E621", detail: "帳票が見つかりません。" };
        if (doc.doc_type !== "quote") {
          return { ok: false, code: "KMB-E621", detail: "見積のみ辞退できます。" };
        }
        if (!canTransition("quote", doc.status as DocumentStatus, "declined")) {
          return { ok: false, code: "KMB-E621", detail: "現在の状態からは辞退できません。" };
        }

        const updated = await updateDocumentStatusWithCas(
          client,
          documentId,
          { status: "declined", status_reason: reason, voided_at: null },
          expectedUpdatedAt,
        );
        if (!updated.ok) return updated;

        await recordDocumentEventActivity(ctx, updated.value, "declined", "見積辞退");
        return { ok: true, value: undefined };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    async voidDocument(documentId, reason, expectedUpdatedAt) {
      try {
        if (!reason || reason.trim().length === 0) {
          return { ok: false, code: "KMB-E101", detail: "取消理由を入力してください。" };
        }

        const resolved = await resolveClientAndUser(injectedClient);
        if (!resolved.ok) return resolved;
        const { client } = resolved.value;

        const docResult = await getDocumentById(client, documentId);
        if (!docResult.ok) return docResult;
        const doc = docResult.value;
        if (!doc) return { ok: false, code: "KMB-E621", detail: "帳票が見つかりません。" };
        if (!canTransition(doc.doc_type as DocType, doc.status as DocumentStatus, "voided")) {
          return { ok: false, code: "KMB-E621", detail: "現在の状態からは取消できません。" };
        }

        // 入金存在ガードは trigger (documents_freeze_after_issue) が最終防波堤として再検証する
        // (facade の事前チェックは必須ではない — 実装計画書 §「facade」10)。
        const updated = await updateDocumentStatusWithCas(
          client,
          documentId,
          { status: "voided", status_reason: reason, voided_at: new Date().toISOString() },
          expectedUpdatedAt,
        );
        if (!updated.ok) return updated;

        await recordDocumentEventActivity(ctx, updated.value, "voided", "帳票取消");
        return { ok: true, value: undefined };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    computeTotalsPreview(rawLines, rounding) {
      const parsed = zDocumentLineInput.array().safeParse(rawLines);
      if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };
      return { ok: true, value: computeDocumentTotals(parsed.data, rounding) };
    },

    /**
     * canonical: 02-sales.md §4.3-B / §6.2 reviseAndReissueDocument (v1.1 原子化)。
     * Zod + 税ガード → staging INSERT (孤児掃除ベストエフォート) → staging 内容で PDF 生成・
     * Storage 保存 → RPC document_apply_revision (documents 更新 + 明細置換 + 台帳 append +
     * version 前進を単一トランザクションで確定) → appendActivity('reissued')。
     * エラー: E101/E103/E620(zod min(1)で構造的に到達しない)/E621/E627/E640/E641/E643/E901。
     * tax_rounding は凍結 (丸め方式の変更は void + 再発行 — §5.2 zReviseDocumentInput 注記) のため
     * doc.tax_rounding をそのまま使い、入力からは受け取らない。
     */
    async reviseAndReissueDocument(documentId, rawInput, expectedUpdatedAt) {
      try {
        const parsed = zReviseDocumentInput.safeParse(rawInput);
        if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

        const resolved = await resolveClientAndUser(injectedClient);
        if (!resolved.ok) return resolved;
        const { client, userId } = resolved.value;

        const docResult = await getDocumentById(client, documentId);
        if (!docResult.ok) return docResult;
        const doc = docResult.value;
        if (!doc) return { ok: false, code: "KMB-E621", detail: "帳票が見つかりません。" };
        if (doc.status !== "issued" && doc.status !== "accepted") {
          return {
            ok: false,
            code: "KMB-E621",
            detail: `この状態の帳票は訂正できません (現在: ${doc.status})。`,
          };
        }
        if (doc.doc_no === null) {
          return { ok: false, code: "KMB-E627", detail: "書類番号が未確定です。" };
        }
        // quote 以外での valid_until 非 null は facade 側で E101 拒否する (updateDraftDocument /
        // createDraftDocument と同じガード — DB check の生 E901 化を防ぐ)。
        if (doc.doc_type !== "quote" && parsed.data.valid_until !== null) {
          return {
            ok: false,
            code: "KMB-E101",
            detail: "見積以外の帳票には有効期限 (valid_until) を設定できません。",
          };
        }

        const taxRounding = doc.tax_rounding as TaxRounding;
        const totals = computeDocumentTotals(parsed.data.lines, taxRounding);
        const taxGuard = validateIssueTaxGuard(doc.doc_type as DocType, totals);
        if (!taxGuard.ok) return taxGuard;

        const prereq = checkIssuancePrerequisites();
        if (!prereq.ok) return prereq;
        const serviceClientResult = resolvePdfServiceClient(injectedClient);
        if (!serviceClientResult.ok) return serviceClientResult;
        const serviceClient = serviceClientResult.value;

        // 冒頭で古い staging をベストエフォート掃除 (repository.cleanupOrphanRevisionStagings の
        // JSDoc 参照 — 失敗しても訂正処理自体は継続する。cleanupExpiredPrintTokens と同型の縮退)。
        await cleanupOrphanRevisionStagings(serviceClient, documentId);

        const header = {
          issue_date: parsed.data.issue_date,
          transaction_date: parsed.data.transaction_date,
          valid_until: parsed.data.valid_until,
          billing_name: parsed.data.billing_name,
          billing_suffix: parsed.data.billing_suffix,
          billing_address: parsed.data.billing_address,
          site_name: parsed.data.site_name,
          site_address: parsed.data.site_address,
          notes: parsed.data.notes,
        };
        const stagingInserted = await insertRevisionStaging(serviceClient, {
          documentId,
          header,
          lines: parsed.data.lines,
          totals,
          createdBy: userId,
        });
        if (!stagingInserted.ok) return stagingInserted;

        const version = doc.current_version + 1;
        const pdfResult = await generateDocumentPdf(serviceClient, {
          documentId,
          version,
          purpose: "pdf",
          payload: { staging_id: stagingInserted.value.id },
        });
        if (!pdfResult.ok) return pdfResult;

        // 発行者情報は訂正で変えない (凍結済み issuer_snapshot をそのまま使う — §4.3-B)。
        const issuerParsed = zIssuerSnapshot.safeParse(doc.issuer_snapshot);
        if (!issuerParsed.success) {
          return {
            ok: false,
            code: "KMB-E901",
            detail: "発行済み帳票の issuer_snapshot が契約 (zIssuerSnapshot) と一致しません。",
          };
        }

        const transactionDate = parsed.data.transaction_date ?? parsed.data.issue_date;
        const snapshotResult = buildIssuedContentSnapshot({
          docType: doc.doc_type as DocType,
          docNo: doc.doc_no,
          version,
          issueDate: parsed.data.issue_date,
          transactionDate,
          validUntil: parsed.data.valid_until,
          billingName: parsed.data.billing_name,
          billingSuffix: parsed.data.billing_suffix,
          billingAddress: parsed.data.billing_address,
          siteName: parsed.data.site_name,
          siteAddress: parsed.data.site_address,
          notes: parsed.data.notes,
          taxRounding,
          issuer: issuerParsed.data,
          lines: parsed.data.lines.map((l, index) => ({
            position: index,
            description: l.description,
            quantity: l.quantity,
            unit: l.unit,
            unit_price_jpy: l.unit_price_jpy,
            amount_jpy: l.amount_jpy,
            tax_category: l.tax_category,
          })),
          totals,
        });
        if (!snapshotResult.ok) return snapshotResult;

        const applied = await applyDocumentRevision(client, {
          documentId,
          expectedUpdatedAt,
          stagingId: stagingInserted.value.id,
          sha256: pdfResult.value.sha256,
          storagePath: pdfResult.value.storagePath,
          contentSnapshot: snapshotResult.value,
        });
        if (!applied.ok) return applied;

        const event: DocumentEventActivityPayload = {
          document_id: documentId,
          doc_type: doc.doc_type as DocType,
          doc_no: doc.doc_no,
          event: "reissued",
          total_jpy: totals.total_jpy,
          version: applied.value.doc_version,
        };
        const appended = await crmFacade.appendActivity(
          {
            activity_type: "document_event",
            occurred_at: new Date().toISOString(),
            title: `訂正発行: ${doc.doc_no} (v${applied.value.doc_version})`,
            body: null,
            payload: event,
            ref_table: "issued_documents",
            ref_id: applied.value.issued_document_id,
            links: [{ customer_id: null, company_id: null, deal_id: doc.deal_id }],
          },
          ctx,
        );
        if (!appended.ok) {
          console.warn(
            `[KMB-E901] reissued (訂正発行) の appendActivity 記録に失敗しました (document=${documentId}):`,
            appended.code,
            appended.detail,
          );
        }

        return {
          ok: true,
          value: { version: applied.value.doc_version, pdf_storage_path: pdfResult.value.storagePath },
        };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    // ---- 契約外拡張 (02-sales.md §6.2、#51 実装分) ----

    /**
     * canonical: 02-sales.md §6.2 deletePayment。DELETE のみ (repository の insertPayment/
     * deletePayment 経由 — 訂正 = 削除 + recordPayment 再実行)。payments_apply trigger が
     * 完済⇔発行済みの状態復帰を行う。appendActivity は呼ばない (§11.3 — 上記インターフェース
     * コメント参照)。エラー: E101(Zod) / E621(対象なし、repository が判定) / E901。
     */
    async deletePayment(rawPaymentId) {
      try {
        const parsed = z.string().uuid().safeParse(rawPaymentId);
        if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

        const resolved = await resolveClientAndUser(injectedClient);
        if (!resolved.ok) return resolved;
        const { client } = resolved.value;

        return repoDeletePayment(client, parsed.data);
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    /**
     * canonical: 02-sales.md §6.2 getSalesDigest。ctx を都度渡す設計 (上記
     * resolveSalesExecutionClient のコメント参照 — 地雷)。JST 今日 + 7 日のカットオフで
     * expiring_quotes/unpaid_invoices を集計する。エラー: E901 のみ。
     */
    async getSalesDigest(ctx) {
      try {
        const resolved = await resolveSalesExecutionClient(ctx);
        if (!resolved.ok) return resolved;
        const { client } = resolved.value;

        const today = jstTodayDateOnly();
        const cutoff = addDaysToDateOnly(today, 7);

        const [expiringResult, unpaidResult] = await Promise.all([
          listExpiringQuotes(client, cutoff),
          listUnpaidInvoices(client),
        ]);
        if (!expiringResult.ok) return expiringResult;
        if (!unpaidResult.ok) return unpaidResult;

        const documentIds = unpaidResult.value.map((d) => d.document_id);
        const paymentsResult: Result<PaymentRow[]> =
          documentIds.length > 0 ? await listPaymentsForDocuments(client, documentIds) : { ok: true, value: [] };
        if (!paymentsResult.ok) return paymentsResult;

        const paidByDocument = new Map<string, number>();
        for (const p of paymentsResult.value) {
          paidByDocument.set(p.document_id, (paidByDocument.get(p.document_id) ?? 0) + p.amount_jpy);
        }

        const expiringQuotes: SalesDigest["expiring_quotes"] = [];
        for (const q of expiringResult.value) {
          // doc_no は status='issued' フィルタにより業務不変条件上必ず非 null (document_finalize_issue
          // が doc_no/issue_date を同一トランザクションで設定してから status を 'issued' にする —
          // reissueDocument の同種チェック (facade.ts 上部) と同じ理由)。null であれば台帳との
          // 不整合であり、握り潰さず E901 で顕在化させる (地雷回避: 実装計画書「エラー握り潰し厳禁」)。
          if (q.doc_no === null || q.valid_until === null) {
            return {
              ok: false,
              code: "KMB-E901",
              detail: `issued 状態の見積の doc_no/valid_until が null です (document_id=${q.document_id})`,
            };
          }
          expiringQuotes.push({
            document_id: q.document_id,
            doc_no: q.doc_no,
            billing_name: q.billing_name,
            valid_until: q.valid_until,
            total_jpy: q.total_jpy,
          });
        }

        const unpaidInvoices: SalesDigest["unpaid_invoices"] = [];
        for (const inv of unpaidResult.value) {
          if (inv.doc_no === null || inv.issue_date === null) {
            return {
              ok: false,
              code: "KMB-E901",
              detail: `issued 状態の請求書の doc_no/issue_date が null です (document_id=${inv.document_id})`,
            };
          }
          const paidJpy = paidByDocument.get(inv.document_id) ?? 0;
          unpaidInvoices.push({
            document_id: inv.document_id,
            doc_no: inv.doc_no,
            billing_name: inv.billing_name,
            issue_date: inv.issue_date,
            total_jpy: inv.total_jpy,
            paid_jpy: paidJpy,
            balance_jpy: inv.total_jpy - paidJpy,
          });
        }

        return {
          ok: true,
          value: { expiring_quotes: expiringQuotes, unpaid_invoices: unpaidInvoices },
        };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    /**
     * canonical: 02-sales.md §6.2 markExpiredQuotes。valid_until < JST 今日の issued 見積を
     * 一括で expired 化 (repository.bulkExpireOverdueQuotes — CAS なしバッチ更新)。各行について
     * appendActivity('expired') を記録する (1 件失敗しても全体は失敗させない — 既存の warn-only
     * パターンを踏襲)。status_reason は「有効期限切れ(自動判定)」固定文言
     * (canonical に指定なし — 実装計画書「未解決点5」、実装者判断。openIssues に記録)。
     * エラー: E901 のみ。
     */
    async markExpiredQuotes(ctx) {
      try {
        const resolved = await resolveSalesExecutionClient(ctx);
        if (!resolved.ok) return resolved;
        const { client } = resolved.value;

        const today = jstTodayDateOnly();
        const expired = await bulkExpireOverdueQuotes(client, today);
        if (!expired.ok) return expired;

        for (const doc of expired.value) {
          await recordDocumentEventActivity(ctx, doc, "expired", `見積失効: ${doc.doc_no ?? doc.id}`);
        }

        return { ok: true, value: undefined };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    /**
     * canonical: 02-sales.md §11.1 (版間差分ダイアログの入力取得)。契約外拡張 (実装計画書
     * 「未解決点3」)。listIssuedDocumentVersions を再利用し (repository.ts の JSDoc 参照 —
     * 1 帳票の版数は小さいため専用の単版クエリを別途持たない設計判断)、該当版の content_snapshot を
     * zIssuedContentSnapshot で検証してから返す (issued_documents.content_snapshot は jsonb —
     * DB 側の型保証がないため、ここで parse せず握り潰すと版間差分ダイアログが不正な値のまま
     * 描画されてしまう — 地雷回避)。
     */
    async getIssuedContentSnapshot(documentId, version) {
      try {
        const resolved = await resolveClientAndUser(injectedClient);
        if (!resolved.ok) return resolved;
        const { client } = resolved.value;

        const versionsResult = await listIssuedDocumentVersions(client, documentId);
        if (!versionsResult.ok) return versionsResult;

        const found = versionsResult.value.find((v) => v.version === version);
        if (!found) {
          return { ok: false, code: "KMB-E627", detail: "指定の版が台帳に見つかりません。" };
        }

        const parsed = zIssuedContentSnapshot.safeParse(found.content_snapshot);
        if (!parsed.success) {
          return {
            ok: false,
            code: "KMB-E901",
            detail: `台帳の content_snapshot が契約 (zIssuedContentSnapshot) と一致しません: ${parsed.error.message}`,
          };
        }
        return { ok: true, value: parsed.data };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    // ---- /print route 専用の橋渡しメソッド (Issue #50 追加。上記コメント参照) ----
    async resolvePrintView(documentId, token) {
      try {
        // print route は Chromium からの無セッションアクセス (token のみが認可) のため、
        // 常に service client を使う (injectedClient 指定時はそれを優先 — テスト注入用)。
        const client = injectedClient ?? createSupabaseServiceClient();

        const verified = await verifyAndConsumePrintToken(client, token);
        if (!verified.ok) return verified;
        if (verified.value.documentId !== documentId) {
          return { ok: false, code: "KMB-E642" };
        }

        const docResult = await getDocumentById(client, documentId);
        if (!docResult.ok) return docResult;
        const doc = docResult.value;
        if (!doc) return { ok: false, code: "KMB-E621", detail: "帳票が見つかりません。" };

        const stagingId = verified.value.payload?.staging_id ?? null;
        const payloadDocNo = verified.value.payload?.doc_no ?? null;

        let lines: ResolvedPrintViewLine[];
        let subtotalJpy: number;
        let taxSummary: TaxSummary;
        let totalJpy: number;
        let issueDate: string | null;
        let transactionDate: string | null;
        let validUntil: string | null;
        let billingName: string;
        let billingSuffix: "様" | "御中";
        let billingAddress: string | null;
        let siteName: string | null;
        let siteAddress: string | null;
        let notes: string | null;

        if (stagingId) {
          // 訂正発行フロー (§4.3-B): DB 反映前の staging 内容を描画する。
          const stagingResult = await getRevisionStagingById(client, stagingId);
          if (!stagingResult.ok) return stagingResult;
          const staging = stagingResult.value;
          if (!staging || staging.document_id !== documentId) {
            return { ok: false, code: "KMB-E621", detail: "訂正内容 (staging) が見つかりません。" };
          }
          const headerParsed = zRevisionStagingHeader.safeParse(staging.header);
          const linesParsed = zRevisionStagingLines.safeParse(staging.lines);
          if (!headerParsed.success || !linesParsed.success) {
            return {
              ok: false,
              code: "KMB-E901",
              detail: "訂正内容 (document_revision_stagings) の内容が契約 (zReviseDocumentInput) と一致しません。",
            };
          }
          lines = linesParsed.data.map((line, index) => ({
            position: index,
            description: line.description,
            quantity: line.quantity,
            unit: line.unit,
            unit_price_jpy: line.unit_price_jpy,
            amount_jpy: line.amount_jpy,
            tax_category: line.tax_category,
          }));
          subtotalJpy = staging.subtotal_jpy;
          taxSummary = staging.tax_summary as TaxSummary;
          totalJpy = staging.total_jpy;
          issueDate = headerParsed.data.issue_date;
          transactionDate = headerParsed.data.transaction_date;
          validUntil = headerParsed.data.valid_until;
          billingName = headerParsed.data.billing_name;
          billingSuffix = headerParsed.data.billing_suffix;
          billingAddress = headerParsed.data.billing_address;
          siteName = headerParsed.data.site_name;
          siteAddress = headerParsed.data.site_address;
          notes = headerParsed.data.notes;
        } else {
          const linesResult = await listDocumentLines(client, documentId);
          if (!linesResult.ok) return linesResult;
          lines = linesResult.value.map((line) => ({
            position: line.position,
            description: line.description,
            quantity: line.quantity,
            unit: line.unit,
            unit_price_jpy: line.unit_price_jpy,
            amount_jpy: line.amount_jpy,
            tax_category: line.tax_category as TaxCategory,
          }));
          subtotalJpy = doc.subtotal_jpy;
          taxSummary = doc.tax_summary as TaxSummary;
          totalJpy = doc.total_jpy;
          issueDate = doc.issue_date;
          transactionDate = doc.transaction_date;
          validUntil = doc.valid_until;
          billingName = doc.billing_name;
          billingSuffix = doc.billing_suffix as "様" | "御中";
          billingAddress = doc.billing_address;
          siteName = doc.site_name;
          siteAddress = doc.site_address;
          notes = doc.notes;
        }

        // issuer_snapshot: 発行済み (status != 'draft') は documents.issuer_snapshot の凍結値、
        // draft (プレビュー/発行フロー中) は settings から合成した現在値を使う (§10.3 注記)。
        let issuer: IssuerSnapshot;
        if (doc.status !== "draft") {
          const parsed = zIssuerSnapshot.safeParse(doc.issuer_snapshot);
          if (!parsed.success) {
            return {
              ok: false,
              code: "KMB-E901",
              detail: "発行済み帳票の issuer_snapshot が契約 (zIssuerSnapshot) と一致しません。",
            };
          }
          issuer = parsed.data;
        } else {
          const built = await buildIssuerSnapshot({ mode: "service", client });
          if (!built.ok) return built;
          issuer = built.value;
        }

        let sealSignedUrl: string | null = null;
        if (issuer.seal_storage_path) {
          const { data, error } = await client.storage
            .from(BRANDING_ASSETS_BUCKET)
            .createSignedUrl(issuer.seal_storage_path, SEAL_SIGNED_URL_TTL_SECONDS);
          // 解決失敗は角印の印字省略のみに degrade する (角印は法的要件ではない — §10.6)。
          sealSignedUrl = error ? null : (data?.signedUrl ?? null);
        }

        const docNo = doc.status === "draft" ? payloadDocNo : doc.doc_no;
        const watermark = doc.status === "draft" && verified.value.purpose === "preview";

        return {
          ok: true,
          value: {
            docType: doc.doc_type as DocType,
            docNo,
            issueDate,
            transactionDate,
            validUntil,
            billingName,
            billingSuffix,
            billingAddress,
            siteName,
            siteAddress,
            notes,
            subtotalJpy,
            taxSummary,
            totalJpy,
            issuer,
            sealSignedUrl,
            lines,
            watermark,
          },
        };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },

    // ---- admin 印刷プレビュー用トークン発行 (Issue #50 追加。上記 SalesPrintFacade コメント参照) ----
    async issuePrintPreviewToken(documentId) {
      try {
        const idCheck = z.string().uuid().safeParse(documentId);
        if (!idCheck.success) return { ok: false, code: "KMB-E101", detail: idCheck.error.message };

        const prereq = checkIssuancePrerequisites();
        if (!prereq.ok) return prereq;
        const serviceClientResult = resolvePdfServiceClient(injectedClient);
        if (!serviceClientResult.ok) return serviceClientResult;

        const tokenResult = await issuePrintToken(serviceClientResult.value, {
          documentId: idCheck.data,
          purpose: "preview",
          payload: null,
        });
        if (!tokenResult.ok) return tokenResult;

        let env: ReturnType<typeof getEnv>;
        try {
          env = getEnv();
        } catch (err) {
          return { ok: false, code: "KMB-E901", detail: errMessage(err) };
        }
        const url = new URL(`/print/documents/${idCheck.data}`, env.NEXT_PUBLIC_SITE_URL);
        url.searchParams.set("token", tokenResult.value.token);

        return { ok: true, value: { url: url.toString(), expires_at: tokenResult.value.expiresAt } };
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: errMessage(err) };
      }
    },
  };
}

/**
 * 版間差分ダイアログ (§11.1・§8.4「前の版と比較」) 専用の facade ブリッジ。`internal/diff.ts` の
 * 純関数 `diffIssuedSnapshots` は ESLint モジュール境界により app 層から直 import できない
 * (実装計画書「成果物5」注記 — resolvePrintView と同型のブリッジパターンを選択)。DB アクセスを
 * 持たない純粋な計算のため `createSalesFacade()` の戻り値オブジェクトには含めず、モジュールの
 * トップレベル関数としてそのまま公開する (Result 型に包まない — 失敗しうる I/O が無いため)。
 */
export function computeVersionDiff(
  older: IssuedContentSnapshot,
  newer: IssuedContentSnapshot,
): IssuedSnapshotDiff {
  return diffIssuedSnapshots(older, newer);
}
