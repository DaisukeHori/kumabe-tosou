import "server-only";

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSessionAndClient } from "@/lib/supabase/session";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { ExecutionContext, Paged, Pagination, Result, TaxCategory } from "@/modules/platform/contracts";
import { zPagination } from "@/modules/platform/contracts";

import { crmFacade } from "@/modules/crm/facade";
// sales→crm は crmFacade 経由の 3 メソッド (getDealRef/getDealRefs/appendActivity) + 型 import のみ許可
// (実装計画書「モジュール境界」注記)。DealRef/SimEstimateSnapshot/DocumentEventActivityPayload は
// いずれも型のみ (crm 側の zod スキーマを sales 側で再 import・再 parse しない — 契約の canonical
// 分担を crm 側に残す)。DocumentEventActivityPayload は SalesFacade (D8 契約) の
// issueDocument/reissueDocument/recordPayment 戻り値型の宣言に必要 (#50/#51 実装分。本 Issue (#49)
// では未実装だが、型宣言のフルセットを保つため import する)。
import type { DealRef, DocumentEventActivityPayload, SimEstimateSnapshot } from "@/modules/crm/contracts";

import { settingsFacade } from "@/modules/settings/facade";

import {
  DERIVATION_RULES,
  zCreateDocumentInput,
  zDocType,
  zDocumentLineInput,
  zDocumentListFilter,
  zUpdateDraftDocumentInput,
  type CreateDocumentInput,
  type DocType,
  type DocumentDetail,
  type DocumentListFilter,
  type DocumentListItem,
  type DocumentLineInput,
  type DocumentStatus,
  type DocumentTotals,
  type IssuerSnapshot,
  type PaymentInput,
  type TaxSummary,
  type UpdateDraftDocumentInput,
} from "./contracts";
import { canTransition, computeDerivableTo } from "./internal/state";
import { buildDerivedDocumentLines, buildSimulatorQuoteDraft, resolveDerivedTransactionDate } from "./internal/derive";
import { computeDocumentTotals } from "./tax";
import {
  createDraftDocument as repoCreateDraftDocument,
  deleteDraftDocument as repoDeleteDraftDocument,
  getDocumentById,
  listDocumentLines,
  listDocumentsPage,
  listPayments,
  saveDraftDocument,
  updateDocumentStatusWithCas,
  type DocumentRow,
} from "./repository";

/**
 * sales モジュールの公開 facade (02-sales.md §6)。
 *
 * `SalesFacade` (07-contracts-delta §D8 契約 8 メソッド。シグネチャ変更禁止) と
 * `SalesFacadeExtended` (02-sales §6.2 契約外拡張。本 Issue (#49) の実装範囲である 8 つのみを
 * 型宣言 — reviseAndReissueDocument/deletePayment/getSalesDigest/markExpiredQuotes は #50/#51 の
 * 担当のため型宣言にも含めない) を型としてフルセット/部分セットで宣言する
 * (scheduling/facade.ts の SchedulingFacade/SchedulingFacadeExtended 分割と同型)。
 *
 * ---- この Issue (#49) での実装範囲 ----
 * `createSalesFacade()` が実際に export するのは、契約メソッドのうち
 * `createDraftDocument`/`createDraftQuoteFromEstimate`/`deriveDocument` の 3 つと、
 * 契約外拡張のうち `listDocuments`/`getDocumentDetail`/`updateDraftDocument`/
 * `deleteDraftDocument`/`acceptQuote`/`declineQuote`/`voidDocument`/`computeTotalsPreview` の
 * 8 つ、計 11 メソッドのみ。残り 5 契約メソッド (issueDocument/reissueDocument/recordPayment/
 * getDocumentLinesForBlocks/createSignedPdfUrl) は #50/#51 が実装するため、本ファイルでは型宣言
 * のみに留め、戻り値型を `Pick<SalesFacadeExtended, ...>` に絞ることで「未実装メソッドをスタブで
 * 誤魔化す」ことを構造的に防ぐ (呼び出せば型検査の時点でエラーになる)。
 *
 * 実行文脈: `createSalesFacade(client?: SupabaseClient)` はファクトリ関数。省略時は session
 * (admin セッション — `getSessionAndClient()`)、指定時は facade インスタンス単位でその client を
 * 全メソッドに固定する (D8 のシグネチャに ctx 引数が無いため、crm/settings のようなメソッド単位
 * ctx 引数は取らない設計 — 02-sales §6.1 createDraftQuoteFromEstimate 注記)。
 * `createDraftQuoteFromEstimate` のみ、facade の生成方法に関わらず常に service 実行
 * (anon route `/api/shop/lead` からセッション無しで呼ばれるため)。
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

/** documents.tax_rounding (zTaxRounding と同じリテラル和 — repository.ts の inline 型と 1:1) */
type TaxRounding = "floor" | "round" | "ceil";

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
  event: "accepted" | "declined" | "voided",
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
// facade 実装
// ============================================================

export function createSalesFacade(injectedClient?: SupabaseClient): SalesFacadeCore {
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

        const [linesResult, paymentsResult, dealRef] = await Promise.all([
          listDocumentLines(client, documentId),
          listPayments(client, documentId),
          crmFacade.getDealRef(doc.deal_id, ctx),
        ]);
        if (!linesResult.ok) return linesResult;
        if (!paymentsResult.ok) return paymentsResult;
        if (!dealRef.ok) return dealRef;

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
          // issued_documents (版履歴) は #50 のスコープ。空配列固定 (Issue #49 本文に明記)。
          versions: [],
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
  };
}
