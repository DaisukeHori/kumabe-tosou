import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * canonical: docs/design/crm-suite/02-sales.md §6.1 (契約メソッド 3 つの実装分) / §6.2
 * (契約外拡張 8 つ) / §6.3 (エラーマトリクス) / §4.4 (deriveDocument の派生条件)。
 *
 * createSalesFacade() の単体テスト。tests/sales-repository.test.ts の FakeChain パターンとは
 * 別に、facade.ts が直接呼ぶ repository / crmFacade / settingsFacade / session を全て vi.mock
 * し (scheduling-facade.test.ts / ai-studio-image-selection.test.ts の確立パターン踏襲)、実 DB
 * には一切接続しない。internal/state.ts・internal/derive.ts・tax.ts は純関数のため実体のまま
 * 使う (facade がこれらを正しく配線しているかも合わせて検証する)。
 *
 * 対象 (タスク指示の 4 項目):
 *  1. createDraftDocument の宛名複製ロジック (company 有無で御中/様 + 住所)
 *  2. deriveDocument の E623 分岐 (派生元不在・許可表外・状態条件外)
 *  3. updateDraftDocument の valid_until refine (quote 以外で E101)
 *  4. voidDocument の理由必須 E101
 * 加えて、実装計画書の受入基準に明記された createDraftQuoteFromEstimate の service 注入経路、
 * および契約外拡張の主要分岐 (acceptQuote/declineQuote/listDocuments/getDocumentDetail/
 * deleteDraftDocument/computeTotalsPreview) を軽量に確認する。
 */

const getSessionAndClientMock = vi.fn();
vi.mock("@/lib/supabase/session", () => ({
  getSessionAndClient: (...args: unknown[]) => getSessionAndClientMock(...args),
}));

const createSupabaseServiceClientMock = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: (...args: unknown[]) => createSupabaseServiceClientMock(...args),
}));

const getDealRefMock = vi.fn();
const getDealRefsMock = vi.fn();
const appendActivityMock = vi.fn();
vi.mock("@/modules/crm/facade", () => ({
  crmFacade: {
    getDealRef: (...args: unknown[]) => getDealRefMock(...args),
    getDealRefs: (...args: unknown[]) => getDealRefsMock(...args),
    appendActivity: (...args: unknown[]) => appendActivityMock(...args),
  },
}));

const settingsGetMock = vi.fn();
vi.mock("@/modules/settings/facade", () => ({
  settingsFacade: { get: (...args: unknown[]) => settingsGetMock(...args) },
}));

const repoCreateDraftDocumentMock = vi.fn();
const repoDeleteDraftDocumentMock = vi.fn();
const getDocumentByIdMock = vi.fn();
const listDocumentLinesMock = vi.fn();
const listDocumentsPageMock = vi.fn();
const listPaymentsMock = vi.fn();
const saveDraftDocumentMock = vi.fn();
const updateDocumentStatusWithCasMock = vi.fn();
// #51 追加: getDocumentDetail の版履歴取得 (listIssuedDocumentVersions) / 版間差分ダイアログの
// getIssuedContentSnapshot が使う repository 関数。個別 mock しないと importOriginal の実体が
// 呼ばれ、この test file のセッション client (`{}` — .from を持たない) で TypeError になる。
const listIssuedDocumentVersionsMock = vi.fn();
// #101 追加: getDocumentDetail の送信履歴取得 (listDocumentEmails)。同じ理由で個別 mock しないと
// importOriginal の実体が呼ばれ TypeError になる。全 describe 共通のデフォルト (空配列) を
// 下の beforeEach に設定する (他の #49/#50/#51 系テストは getDocumentDetail を経由しないため無害)。
const listDocumentEmailsMock = vi.fn();
// #51 追加: recordPayment/deletePayment/getSalesDigest/markExpiredQuotes が呼ぶ repository 関数
// (同じ理由で個別 mock しないと importOriginal の実体が呼ばれ TypeError になる)。
const insertPaymentMock = vi.fn();
const repoDeletePaymentMock = vi.fn();
const listExpiringQuotesMock = vi.fn();
const listUnpaidInvoicesMock = vi.fn();
const listPaymentsForDocumentsMock = vi.fn();
const bulkExpireOverdueQuotesMock = vi.fn();

vi.mock("@/modules/sales/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/sales/repository")>();
  return {
    ...actual,
    createDraftDocument: (...args: unknown[]) => repoCreateDraftDocumentMock(...args),
    deleteDraftDocument: (...args: unknown[]) => repoDeleteDraftDocumentMock(...args),
    getDocumentById: (...args: unknown[]) => getDocumentByIdMock(...args),
    listDocumentLines: (...args: unknown[]) => listDocumentLinesMock(...args),
    listDocumentsPage: (...args: unknown[]) => listDocumentsPageMock(...args),
    listIssuedDocumentVersions: (...args: unknown[]) => listIssuedDocumentVersionsMock(...args),
    listDocumentEmails: (...args: unknown[]) => listDocumentEmailsMock(...args),
    listPayments: (...args: unknown[]) => listPaymentsMock(...args),
    saveDraftDocument: (...args: unknown[]) => saveDraftDocumentMock(...args),
    updateDocumentStatusWithCas: (...args: unknown[]) => updateDocumentStatusWithCasMock(...args),
    insertPayment: (...args: unknown[]) => insertPaymentMock(...args),
    deletePayment: (...args: unknown[]) => repoDeletePaymentMock(...args),
    listExpiringQuotes: (...args: unknown[]) => listExpiringQuotesMock(...args),
    listUnpaidInvoices: (...args: unknown[]) => listUnpaidInvoicesMock(...args),
    listPaymentsForDocuments: (...args: unknown[]) => listPaymentsForDocumentsMock(...args),
    bulkExpireOverdueQuotes: (...args: unknown[]) => bulkExpireOverdueQuotesMock(...args),
  };
});

import { createSalesFacade } from "@/modules/sales/facade";
import type { DocumentRow } from "@/modules/sales/repository";
import type { CreateDocumentInput, DocumentLineInput, UpdateDraftDocumentInput } from "@/modules/sales/contracts";

const DEAL_ID = "22222222-2222-4222-8222-222222222222";
const DOC_ID = "33333333-3333-4333-8333-333333333333";
const SOURCE_DOC_ID = "44444444-4444-4444-8444-444444444444";

function lineInput(overrides: Partial<DocumentLineInput> = {}): DocumentLineInput {
  return {
    description: "施工費",
    quantity: 1,
    unit: "式",
    unit_price_jpy: 10_000,
    amount_jpy: 10_000,
    tax_category: "standard_10",
    work_type_key: null,
    source: null,
    ...overrides,
  };
}

function documentRow(overrides: Partial<DocumentRow> = {}): DocumentRow {
  return {
    id: DOC_ID,
    doc_type: "quote",
    status: "issued",
    deal_id: DEAL_ID,
    source_document_id: null,
    doc_no: "Q-2026-0001",
    current_version: 1,
    issue_date: "2026-07-01",
    transaction_date: null,
    valid_until: "2026-08-01",
    billing_name: "サンプル建設",
    billing_suffix: "様",
    billing_address: null,
    site_name: null,
    site_address: null,
    notes: null,
    tax_rounding: "floor",
    subtotal_jpy: 10_000,
    tax_summary: [],
    total_jpy: 11_000,
    issuer_snapshot: null,
    status_reason: null,
    issued_at: "2026-07-01T00:00:00Z",
    paid_at: null,
    voided_at: null,
    created_by: null,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function dealRef(overrides: Record<string, unknown> = {}) {
  return {
    deal_id: DEAL_ID,
    title: "サンプル案件",
    stage: "quoted",
    updated_at: "2026-07-01T00:00:00Z",
    customer: { customer_id: "c-1", name: "田中太郎", kind: "person", address: "顧客住所", billing: null, shipping: null },
    company: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionAndClientMock.mockResolvedValue({ supabase: {}, user: { id: "user-1" } });
  settingsGetMock.mockResolvedValue({ ok: true, value: { tax_rounding: "floor" } });
  listDocumentEmailsMock.mockResolvedValue({ ok: true, value: [] });
});

// ============================================================
// 1. createDraftDocument — 宛名複製ロジック
// ============================================================

describe("createSalesFacade().createDraftDocument — 宛名複製 (company 有無で御中/様 + 住所)", () => {
  function validInput(): CreateDocumentInput {
    return {
      doc_type: "quote",
      deal_id: DEAL_ID,
      issue_date: null,
      valid_until: null,
      site_name: null,
      site_address: null,
      lines: [lineInput()],
      notes: null,
    };
  }

  it("company 非 null: billing_name=会社名 (連結しない)・billing_suffix='御中'・billing_address=会社住所", async () => {
    getDealRefMock.mockResolvedValue({
      ok: true,
      value: dealRef({ company: { company_id: "co-1", name: "サンプル建設株式会社", address: "会社住所1-2-3" } }),
    });
    repoCreateDraftDocumentMock.mockResolvedValue({ ok: true, value: { id: "doc-new", updated_at: "t" } });

    const facade = createSalesFacade();
    const result = await facade.createDraftDocument(validInput());

    expect(result).toEqual({ ok: true, value: { document_id: "doc-new" } });
    expect(repoCreateDraftDocumentMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        billing_name: "サンプル建設株式会社",
        billing_suffix: "御中",
        billing_address: "会社住所1-2-3",
      }),
    );
  });

  it("company が null: billing_name=顧客名 (連結しない)・billing_suffix='様'・billing_address=顧客住所", async () => {
    getDealRefMock.mockResolvedValue({
      ok: true,
      value: dealRef({ company: null, customer: { customer_id: "c-1", name: "田中太郎", kind: "person", address: "顧客住所4-5-6", billing: null, shipping: null } }),
    });
    repoCreateDraftDocumentMock.mockResolvedValue({ ok: true, value: { id: "doc-new2", updated_at: "t" } });

    const facade = createSalesFacade();
    const result = await facade.createDraftDocument(validInput());

    expect(result.ok).toBe(true);
    expect(repoCreateDraftDocumentMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        billing_name: "田中太郎",
        billing_suffix: "様",
        billing_address: "顧客住所4-5-6",
      }),
    );
  });

  it("CrmFacade.getDealRef の失敗 (E603) をそのまま透過し、repository には触れない", async () => {
    getDealRefMock.mockResolvedValue({ ok: false, code: "KMB-E603" });

    const facade = createSalesFacade();
    const result = await facade.createDraftDocument(validInput());

    expect(result).toEqual({ ok: false, code: "KMB-E603" });
    expect(repoCreateDraftDocumentMock).not.toHaveBeenCalled();
  });

  it("Zod parse 失敗 (lines 0 行) は KMB-E101 を返し、getDealRef にも触れない", async () => {
    const facade = createSalesFacade();
    const result = await facade.createDraftDocument({ ...validInput(), lines: [] });

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E101" }));
    expect(getDealRefMock).not.toHaveBeenCalled();
  });

  it("SettingsFacade.get('invoice_issuer') が失敗しても既定 'floor' にフォールバックする (E901 かどうかで分岐しない)", async () => {
    getDealRefMock.mockResolvedValue({ ok: true, value: dealRef() });
    settingsGetMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "未設定" });
    repoCreateDraftDocumentMock.mockResolvedValue({ ok: true, value: { id: "doc-x", updated_at: "t" } });

    const facade = createSalesFacade();
    await facade.createDraftDocument(validInput());

    expect(repoCreateDraftDocumentMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tax_rounding: "floor" }),
    );
  });

  it("SettingsFacade.get('invoice_issuer') が成功時はその tax_rounding をそのまま使う (無条件 floor ではない)", async () => {
    getDealRefMock.mockResolvedValue({ ok: true, value: dealRef() });
    settingsGetMock.mockResolvedValue({ ok: true, value: { tax_rounding: "round" } });
    repoCreateDraftDocumentMock.mockResolvedValue({ ok: true, value: { id: "doc-y", updated_at: "t" } });

    const facade = createSalesFacade();
    await facade.createDraftDocument(validInput());

    expect(repoCreateDraftDocumentMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ tax_rounding: "round" }),
    );
  });

  it("session 実行時、CrmFacade/SettingsFacade へは ctx を省略して呼ぶ (ctx 引数 undefined)", async () => {
    getDealRefMock.mockResolvedValue({ ok: true, value: dealRef() });
    repoCreateDraftDocumentMock.mockResolvedValue({ ok: true, value: { id: "doc-z", updated_at: "t" } });

    const facade = createSalesFacade();
    await facade.createDraftDocument(validInput());

    expect(getDealRefMock).toHaveBeenCalledWith(DEAL_ID, undefined);
    expect(settingsGetMock).toHaveBeenCalledWith("invoice_issuer", undefined);
  });
});

// ============================================================
// createDraftDocument — valid_until refine (quote 以外で E101。updateDraftDocument と同じガード)
// ============================================================

describe("createSalesFacade().createDraftDocument — valid_until refine (quote 以外で E101)", () => {
  function baseInput(overrides: Partial<CreateDocumentInput> = {}): CreateDocumentInput {
    return {
      doc_type: "quote",
      deal_id: DEAL_ID,
      issue_date: null,
      valid_until: null,
      site_name: null,
      site_address: null,
      lines: [lineInput()],
      notes: null,
      ...overrides,
    };
  }

  it("doc_type='order' + valid_until 非 null は KMB-E101 を返し、getDealRef/repository には触れない", async () => {
    const facade = createSalesFacade();
    const result = await facade.createDraftDocument(
      baseInput({ doc_type: "order", valid_until: "2026-08-01" }),
    );

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E101" }));
    expect(getDealRefMock).not.toHaveBeenCalled();
    expect(repoCreateDraftDocumentMock).not.toHaveBeenCalled();
  });

  it("doc_type='invoice' + valid_until 非 null も同様に KMB-E101", async () => {
    const facade = createSalesFacade();
    const result = await facade.createDraftDocument(
      baseInput({ doc_type: "invoice", valid_until: "2026-08-01" }),
    );

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E101" }));
    expect(repoCreateDraftDocumentMock).not.toHaveBeenCalled();
  });

  it("doc_type='delivery' + valid_until 非 null も同様に KMB-E101", async () => {
    const facade = createSalesFacade();
    const result = await facade.createDraftDocument(
      baseInput({ doc_type: "delivery", valid_until: "2026-08-01" }),
    );

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E101" }));
    expect(repoCreateDraftDocumentMock).not.toHaveBeenCalled();
  });

  it("doc_type='quote' + valid_until 非 null は許可され、repository.createDraftDocument が呼ばれる", async () => {
    getDealRefMock.mockResolvedValue({ ok: true, value: dealRef() });
    repoCreateDraftDocumentMock.mockResolvedValue({ ok: true, value: { id: "doc-quote-valid", updated_at: "t" } });

    const facade = createSalesFacade();
    const result = await facade.createDraftDocument(
      baseInput({ doc_type: "quote", valid_until: "2026-08-01" }),
    );

    expect(result).toEqual({ ok: true, value: { document_id: "doc-quote-valid" } });
    expect(repoCreateDraftDocumentMock).toHaveBeenCalled();
  });

  it("valid_until が null なら doc_type に関わらず許可される (order でも通る)", async () => {
    getDealRefMock.mockResolvedValue({ ok: true, value: dealRef() });
    repoCreateDraftDocumentMock.mockResolvedValue({ ok: true, value: { id: "doc-order-null", updated_at: "t" } });

    const facade = createSalesFacade();
    const result = await facade.createDraftDocument(
      baseInput({ doc_type: "order", valid_until: null }),
    );

    expect(result.ok).toBe(true);
    expect(repoCreateDraftDocumentMock).toHaveBeenCalled();
  });
});

// ============================================================
// createDraftQuoteFromEstimate — 常時 service 実行 (受入基準: admin セッションなしで動作)
// ============================================================

describe("createSalesFacade().createDraftQuoteFromEstimate — service client 注入ファクトリ経由で動作する", () => {
  function estimateInput() {
    return {
      deal_id: DEAL_ID,
      estimate: {
        grade_key: "premium",
        grade_label: "プレミアム",
        size_key: "m",
        size_label: "M",
        quantity: 2,
        option_keys: [],
        quote_only: false,
        total_min: 1000,
        total_max: 2200,
        applied_tier: null,
        breakdown: [],
      },
    };
  }

  it("client 省略でファクトリ生成した場合: createSupabaseServiceClient() で生成した client を使い、session (getSessionAndClient) には一切触れない", async () => {
    const fakeServiceClient = { tag: "service-client" };
    createSupabaseServiceClientMock.mockReturnValue(fakeServiceClient);
    getDealRefMock.mockResolvedValue({ ok: true, value: dealRef() });
    repoCreateDraftDocumentMock.mockResolvedValue({ ok: true, value: { id: "doc-sim", updated_at: "t" } });

    const facade = createSalesFacade(); // session ファクトリだが createDraftQuoteFromEstimate は常時 service
    const result = await facade.createDraftQuoteFromEstimate(estimateInput());

    expect(result).toEqual({ ok: true, value: { document_id: "doc-sim" } });
    expect(createSupabaseServiceClientMock).toHaveBeenCalledTimes(1);
    expect(getSessionAndClientMock).not.toHaveBeenCalled();
    expect(getDealRefMock).toHaveBeenCalledWith(DEAL_ID, { mode: "service", client: fakeServiceClient });
    expect(repoCreateDraftDocumentMock).toHaveBeenCalledWith(fakeServiceClient, expect.anything());
  });

  it("facade 生成時に client を注入した場合: createSupabaseServiceClient() は呼ばれず、注入 client をそのまま使う", async () => {
    const injectedClient = { tag: "injected-client" };
    getDealRefMock.mockResolvedValue({ ok: true, value: dealRef() });
    repoCreateDraftDocumentMock.mockResolvedValue({ ok: true, value: { id: "doc-sim2", updated_at: "t" } });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const facade = createSalesFacade(injectedClient as any);
    await facade.createDraftQuoteFromEstimate(estimateInput());

    expect(createSupabaseServiceClientMock).not.toHaveBeenCalled();
    expect(getDealRefMock).toHaveBeenCalledWith(DEAL_ID, { mode: "service", client: injectedClient });
    expect(repoCreateDraftDocumentMock).toHaveBeenCalledWith(injectedClient, expect.anything());
  });

  it("doc_type は常に 'quote' 固定、valid_until は null 固定で作成する", async () => {
    getDealRefMock.mockResolvedValue({ ok: true, value: dealRef() });
    repoCreateDraftDocumentMock.mockResolvedValue({ ok: true, value: { id: "doc-sim3", updated_at: "t" } });

    const facade = createSalesFacade();
    await facade.createDraftQuoteFromEstimate(estimateInput());

    expect(repoCreateDraftDocumentMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ doc_type: "quote", valid_until: null }),
    );
  });

  it("deal_id が uuid でない場合は KMB-E101 (service client 生成前に弾く)", async () => {
    const facade = createSalesFacade();
    const result = await facade.createDraftQuoteFromEstimate({ ...estimateInput(), deal_id: "not-a-uuid" });

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E101" }));
    expect(createSupabaseServiceClientMock).not.toHaveBeenCalled();
    expect(getDealRefMock).not.toHaveBeenCalled();
  });
});

// ============================================================
// 2. deriveDocument — E623 分岐
// ============================================================

describe("createSalesFacade().deriveDocument — E623 分岐 (§4.4)", () => {
  it("派生元が存在しない (getDocumentById が value:null) 場合は KMB-E623", async () => {
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: null });

    const facade = createSalesFacade();
    const result = await facade.deriveDocument({ source_document_id: SOURCE_DOC_ID, to_type: "order" });

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E623" }));
    expect(repoCreateDraftDocumentMock).not.toHaveBeenCalled();
  });

  it("DERIVATION_RULES に無い経路 (invoice→quote) は KMB-E623", async () => {
    getDocumentByIdMock.mockResolvedValue({
      ok: true,
      value: documentRow({ doc_type: "invoice", status: "issued" }),
    });

    const facade = createSalesFacade();
    const result = await facade.deriveDocument({ source_document_id: SOURCE_DOC_ID, to_type: "quote" });

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E623" }));
    expect(repoCreateDraftDocumentMock).not.toHaveBeenCalled();
  });

  it("許可経路だが派生元の状態が draft (issued/accepted でない) の場合は KMB-E623", async () => {
    getDocumentByIdMock.mockResolvedValue({
      ok: true,
      value: documentRow({ doc_type: "quote", status: "draft" }),
    });

    const facade = createSalesFacade();
    const result = await facade.deriveDocument({ source_document_id: SOURCE_DOC_ID, to_type: "order" });

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E623" }));
    expect(repoCreateDraftDocumentMock).not.toHaveBeenCalled();
  });

  it("許可経路だが派生元の状態が voided の場合も KMB-E623", async () => {
    getDocumentByIdMock.mockResolvedValue({
      ok: true,
      value: documentRow({ doc_type: "quote", status: "voided" }),
    });

    const facade = createSalesFacade();
    const result = await facade.deriveDocument({ source_document_id: SOURCE_DOC_ID, to_type: "order" });

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E623" }));
  });

  it("許可経路 + status=accepted (issued でなくても accepted は許可) は成功する", async () => {
    getDocumentByIdMock.mockResolvedValue({
      ok: true,
      value: documentRow({ doc_type: "quote", status: "accepted" }),
    });
    listDocumentLinesMock.mockResolvedValue({ ok: true, value: [] });
    repoCreateDraftDocumentMock.mockResolvedValue({ ok: true, value: { id: "doc-derived", updated_at: "t" } });

    const facade = createSalesFacade();
    const result = await facade.deriveDocument({ source_document_id: SOURCE_DOC_ID, to_type: "order" });

    expect(result).toEqual({ ok: true, value: { document_id: "doc-derived" } });
  });

  it("delivery→invoice の派生成功時のみ transaction_date に派生元 issue_date を引き継ぐ", async () => {
    getDocumentByIdMock.mockResolvedValue({
      ok: true,
      value: documentRow({ id: SOURCE_DOC_ID, doc_type: "delivery", status: "issued", issue_date: "2026-07-05" }),
    });
    listDocumentLinesMock.mockResolvedValue({ ok: true, value: [] });
    repoCreateDraftDocumentMock.mockResolvedValue({ ok: true, value: { id: "doc-derived2", updated_at: "t" } });

    const facade = createSalesFacade();
    await facade.deriveDocument({ source_document_id: SOURCE_DOC_ID, to_type: "invoice" });

    expect(repoCreateDraftDocumentMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        transaction_date: "2026-07-05",
        source_document_id: SOURCE_DOC_ID,
        deal_id: DEAL_ID,
        doc_type: "invoice",
        issue_date: null,
        valid_until: null,
      }),
    );
  });

  it("order→delivery の派生では transaction_date は null (引継ぎ対象外)", async () => {
    getDocumentByIdMock.mockResolvedValue({
      ok: true,
      value: documentRow({ doc_type: "order", status: "issued", issue_date: "2026-07-05" }),
    });
    listDocumentLinesMock.mockResolvedValue({ ok: true, value: [] });
    repoCreateDraftDocumentMock.mockResolvedValue({ ok: true, value: { id: "doc-derived3", updated_at: "t" } });

    const facade = createSalesFacade();
    await facade.deriveDocument({ source_document_id: SOURCE_DOC_ID, to_type: "delivery" });

    expect(repoCreateDraftDocumentMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ transaction_date: null }),
    );
  });

  it("明細・宛名・tax_rounding を派生元から複製する", async () => {
    getDocumentByIdMock.mockResolvedValue({
      ok: true,
      value: documentRow({
        doc_type: "quote",
        status: "issued",
        billing_name: "派生元建設",
        billing_suffix: "御中",
        billing_address: "派生元住所",
        tax_rounding: "ceil",
      }),
    });
    listDocumentLinesMock.mockResolvedValue({
      ok: true,
      value: [
        {
          id: "line-1",
          document_id: SOURCE_DOC_ID,
          position: 0,
          description: "作業A",
          quantity: 2,
          unit: "個",
          unit_price_jpy: 1000,
          amount_jpy: 2000,
          tax_category: "standard_10",
          work_type_key: "sanding",
          source: null,
          created_at: "t",
        },
      ],
    });
    repoCreateDraftDocumentMock.mockResolvedValue({ ok: true, value: { id: "doc-derived4", updated_at: "t" } });

    const facade = createSalesFacade();
    await facade.deriveDocument({ source_document_id: SOURCE_DOC_ID, to_type: "order" });

    expect(repoCreateDraftDocumentMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        billing_name: "派生元建設",
        billing_suffix: "御中",
        billing_address: "派生元住所",
        tax_rounding: "ceil",
        lines: [
          expect.objectContaining({
            description: "作業A",
            quantity: 2,
            unit: "個",
            unit_price_jpy: 1000,
            amount_jpy: 2000,
            tax_category: "standard_10",
            work_type_key: "sanding",
          }),
        ],
      }),
    );
  });

  it("source_document_id / to_type が Zod 検証を満たさない場合 (uuid でない) は KMB-E101", async () => {
    const facade = createSalesFacade();
    const result = await facade.deriveDocument({
      source_document_id: "not-a-uuid",
      to_type: "order",
    });

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E101" }));
    expect(getDocumentByIdMock).not.toHaveBeenCalled();
  });
});

// ============================================================
// 3. updateDraftDocument — valid_until refine (quote 以外で E101)
// ============================================================

describe("createSalesFacade().updateDraftDocument — valid_until refine (地雷3: quote 以外で E101)", () => {
  function validUpdateInput(overrides: Partial<UpdateDraftDocumentInput> = {}): UpdateDraftDocumentInput {
    return {
      issue_date: null,
      transaction_date: null,
      valid_until: null,
      billing_name: "サンプル建設",
      billing_suffix: "様",
      billing_address: null,
      site_name: null,
      site_address: null,
      notes: null,
      tax_rounding: "floor",
      lines: [lineInput()],
      ...overrides,
    };
  }

  it("doc_type='order' (quote 以外) + valid_until 非 null は KMB-E101 を返し、saveDraftDocument には触れない", async () => {
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: documentRow({ doc_type: "order" }) });

    const facade = createSalesFacade();
    const result = await facade.updateDraftDocument(
      DOC_ID,
      validUpdateInput({ valid_until: "2026-08-01" }),
      "2026-07-01T00:00:00Z",
    );

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E101" }));
    expect(saveDraftDocumentMock).not.toHaveBeenCalled();
  });

  it("doc_type='invoice' + valid_until 非 null も同様に KMB-E101", async () => {
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: documentRow({ doc_type: "invoice" }) });

    const facade = createSalesFacade();
    const result = await facade.updateDraftDocument(
      DOC_ID,
      validUpdateInput({ valid_until: "2026-08-01" }),
      "2026-07-01T00:00:00Z",
    );

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E101" }));
  });

  it("doc_type='quote' + valid_until 非 null は許可され、saveDraftDocument が呼ばれる", async () => {
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: documentRow({ doc_type: "quote" }) });
    saveDraftDocumentMock.mockResolvedValue({ ok: true, value: { updated_at: "2026-07-02T00:00:00Z" } });

    const facade = createSalesFacade();
    const result = await facade.updateDraftDocument(
      DOC_ID,
      validUpdateInput({ valid_until: "2026-08-01" }),
      "2026-07-01T00:00:00Z",
    );

    expect(result).toEqual({ ok: true, value: { updated_at: "2026-07-02T00:00:00Z" } });
    expect(saveDraftDocumentMock).toHaveBeenCalled();
  });

  it("valid_until が null なら doc_type に関わらず許可される (order でも通る)", async () => {
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: documentRow({ doc_type: "order" }) });
    saveDraftDocumentMock.mockResolvedValue({ ok: true, value: { updated_at: "t2" } });

    const facade = createSalesFacade();
    const result = await facade.updateDraftDocument(DOC_ID, validUpdateInput({ valid_until: null }), "t1");

    expect(result.ok).toBe(true);
    expect(saveDraftDocumentMock).toHaveBeenCalled();
  });

  it("対象文書が存在しない場合 (getDocumentById が value:null) は facade の pre-check をすり抜けて RPC へ委譲する (RPC 側の E621/E624 に任せる設計)", async () => {
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: null });
    saveDraftDocumentMock.mockResolvedValue({ ok: false, code: "KMB-E621", detail: "帳票が見つかりません。" });

    const facade = createSalesFacade();
    const result = await facade.updateDraftDocument(
      DOC_ID,
      validUpdateInput({ valid_until: "2026-08-01" }),
      "t1",
    );

    // facade 独自の E101 (valid_until refine) は出さず、RPC の結果がそのまま返る
    expect(result).toEqual({ ok: false, code: "KMB-E621", detail: "帳票が見つかりません。" });
    expect(saveDraftDocumentMock).toHaveBeenCalled();
  });

  it("getDocumentById 自体が失敗した場合はそのまま透過し、saveDraftDocument には触れない", async () => {
    getDocumentByIdMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "db down" });

    const facade = createSalesFacade();
    const result = await facade.updateDraftDocument(DOC_ID, validUpdateInput(), "t1");

    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "db down" });
    expect(saveDraftDocumentMock).not.toHaveBeenCalled();
  });

  it("Zod parse 失敗 (billing_suffix 不正) は KMB-E101 を返し、getDocumentById には触れない", async () => {
    const facade = createSalesFacade();
    const result = await facade.updateDraftDocument(
      DOC_ID,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      validUpdateInput({ billing_suffix: "殿" as any }),
      "t1",
    );

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E101" }));
    expect(getDocumentByIdMock).not.toHaveBeenCalled();
  });
});

// ============================================================
// 4. voidDocument — 理由必須 E101
// ============================================================

describe("createSalesFacade().voidDocument — 理由必須 (KMB-E101)", () => {
  it("reason が空文字の場合は KMB-E101 を返し、session/DB には一切触れない", async () => {
    const facade = createSalesFacade();
    const result = await facade.voidDocument(DOC_ID, "", "t1");

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E101" }));
    expect(getSessionAndClientMock).not.toHaveBeenCalled();
    expect(getDocumentByIdMock).not.toHaveBeenCalled();
  });

  it("reason が空白のみの場合も KMB-E101 (trim 判定)", async () => {
    const facade = createSalesFacade();
    const result = await facade.voidDocument(DOC_ID, "   ", "t1");

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E101" }));
  });

  it("reason が null の場合も KMB-E101", async () => {
    const facade = createSalesFacade();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await facade.voidDocument(DOC_ID, null as any, "t1");

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E101" }));
  });

  it("対象文書が存在しない場合は KMB-E621", async () => {
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: null });

    const facade = createSalesFacade();
    const result = await facade.voidDocument(DOC_ID, "取消理由", "t1");

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E621" }));
    expect(updateDocumentStatusWithCasMock).not.toHaveBeenCalled();
  });

  it("現在の状態から voided へ遷移できない場合 (draft) は KMB-E621", async () => {
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: documentRow({ doc_type: "quote", status: "draft" }) });

    const facade = createSalesFacade();
    const result = await facade.voidDocument(DOC_ID, "取消理由", "t1");

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E621" }));
    expect(updateDocumentStatusWithCasMock).not.toHaveBeenCalled();
  });

  it("有効な理由 + 遷移可能な状態 (issued) は成功し、status_reason に理由を渡し、appendActivity を合成 ref で呼ぶ", async () => {
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: documentRow({ doc_type: "quote", status: "issued" }) });
    updateDocumentStatusWithCasMock.mockResolvedValue({
      ok: true,
      value: documentRow({ doc_type: "quote", status: "voided", status_reason: "取消理由" }),
    });
    appendActivityMock.mockResolvedValue({ ok: true, value: { activity_id: "act-1", created: true } });

    const facade = createSalesFacade();
    const result = await facade.voidDocument(DOC_ID, "取消理由", "t1");

    expect(result).toEqual({ ok: true, value: undefined });
    expect(updateDocumentStatusWithCasMock).toHaveBeenCalledWith(
      expect.anything(),
      DOC_ID,
      expect.objectContaining({ status: "voided", status_reason: "取消理由" }),
      "t1",
    );
    expect(appendActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activity_type: "document_event",
        ref_table: "documents/voided",
        ref_id: DOC_ID,
      }),
      undefined,
    );
  });

  it("appendActivity が失敗しても voidDocument 自体は成功のまま返す (主操作は既に成功済み — 監査記録の失敗で握り潰さないが、主操作は失敗扱いにしない設計)", async () => {
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: documentRow({ doc_type: "quote", status: "issued" }) });
    updateDocumentStatusWithCasMock.mockResolvedValue({ ok: true, value: documentRow({ status: "voided" }) });
    appendActivityMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "activities insert failed" });

    const facade = createSalesFacade();
    const result = await facade.voidDocument(DOC_ID, "取消理由", "t1");

    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("updateDocumentStatusWithCas が CAS 不一致 (E103) を返した場合はそのまま透過し、appendActivity は呼ばれない", async () => {
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: documentRow({ doc_type: "quote", status: "issued" }) });
    updateDocumentStatusWithCasMock.mockResolvedValue({ ok: false, code: "KMB-E103", detail: "stale" });

    const facade = createSalesFacade();
    const result = await facade.voidDocument(DOC_ID, "取消理由", "t1");

    expect(result).toEqual({ ok: false, code: "KMB-E103", detail: "stale" });
    expect(appendActivityMock).not.toHaveBeenCalled();
  });
});

// ============================================================
// 補助 (受入基準・地雷の残り): acceptQuote/declineQuote/deleteDraftDocument/computeTotalsPreview/
// listDocuments (N+1 回避)/getDocumentDetail (versions固定・derivable_to配線)
// ============================================================

describe("createSalesFacade().acceptQuote / declineQuote — 状態遷移 + 種別限定 + 合成 ref イベント記録", () => {
  it("acceptQuote: doc_type が quote 以外は KMB-E621", async () => {
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: documentRow({ doc_type: "order", status: "issued" }) });

    const facade = createSalesFacade();
    const result = await facade.acceptQuote(DOC_ID, "t1");

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E621" }));
    expect(updateDocumentStatusWithCasMock).not.toHaveBeenCalled();
  });

  it("acceptQuote: quote かつ issued → accepted は成功し、appendActivity の ref_table が 'documents/accepted'", async () => {
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: documentRow({ doc_type: "quote", status: "issued" }) });
    updateDocumentStatusWithCasMock.mockResolvedValue({ ok: true, value: documentRow({ status: "accepted" }) });
    appendActivityMock.mockResolvedValue({ ok: true, value: { activity_id: "a", created: true } });

    const facade = createSalesFacade();
    const result = await facade.acceptQuote(DOC_ID, "t1");

    expect(result).toEqual({ ok: true, value: undefined });
    expect(appendActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ ref_table: "documents/accepted", ref_id: DOC_ID }),
      undefined,
    );
  });

  it("acceptQuote: quote かつ expired → accepted (遅れ承諾) も成功する", async () => {
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: documentRow({ doc_type: "quote", status: "expired" }) });
    updateDocumentStatusWithCasMock.mockResolvedValue({ ok: true, value: documentRow({ status: "accepted" }) });
    appendActivityMock.mockResolvedValue({ ok: true, value: { activity_id: "a", created: false } });

    const facade = createSalesFacade();
    const result = await facade.acceptQuote(DOC_ID, "t1");

    expect(result.ok).toBe(true);
  });

  it("declineQuote: reason=null (nullable) でも Zod/facade バリデーションに拒否されず成功する", async () => {
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: documentRow({ doc_type: "quote", status: "issued" }) });
    updateDocumentStatusWithCasMock.mockResolvedValue({ ok: true, value: documentRow({ status: "declined" }) });
    appendActivityMock.mockResolvedValue({ ok: true, value: { activity_id: "a", created: true } });

    const facade = createSalesFacade();
    const result = await facade.declineQuote(DOC_ID, null, "t1");

    expect(result).toEqual({ ok: true, value: undefined });
    expect(updateDocumentStatusWithCasMock).toHaveBeenCalledWith(
      expect.anything(),
      DOC_ID,
      expect.objectContaining({ status: "declined", status_reason: null }),
      "t1",
    );
  });

  it("declineQuote: doc_type が quote 以外は KMB-E621", async () => {
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: documentRow({ doc_type: "invoice", status: "issued" }) });

    const facade = createSalesFacade();
    const result = await facade.declineQuote(DOC_ID, "理由", "t1");

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E621" }));
  });
});

describe("createSalesFacade().deleteDraftDocument — repository への薄いラッパー", () => {
  it("repository.deleteDraftDocument の結果をそのまま返す", async () => {
    repoDeleteDraftDocumentMock.mockResolvedValue({ ok: true, value: undefined });

    const facade = createSalesFacade();
    const result = await facade.deleteDraftDocument(DOC_ID, "t1");

    expect(result).toEqual({ ok: true, value: undefined });
    expect(repoDeleteDraftDocumentMock).toHaveBeenCalledWith(expect.anything(), DOC_ID, "t1");
  });

  it("repository のエラー (E621) をそのまま透過する", async () => {
    repoDeleteDraftDocumentMock.mockResolvedValue({ ok: false, code: "KMB-E621", detail: "見つかりません" });

    const facade = createSalesFacade();
    const result = await facade.deleteDraftDocument(DOC_ID, "t1");

    expect(result).toEqual({ ok: false, code: "KMB-E621", detail: "見つかりません" });
  });
});

describe("createSalesFacade().computeTotalsPreview — 同期メソッド、DB 非依存", () => {
  it("正常な明細から tax.ts の集計をそのまま返す", () => {
    const facade = createSalesFacade();
    const result = facade.computeTotalsPreview([lineInput({ amount_jpy: 10_000 })], "floor");

    expect(result).toEqual({
      ok: true,
      value: { subtotal_jpy: 10_000, tax_summary: [{ tax_category: "standard_10", taxable_jpy: 10_000, tax_jpy: 1_000 }], total_jpy: 11_000 },
    });
  });

  it("Zod parse 失敗 (unit_price_jpy が上限超過) は KMB-E101", () => {
    const facade = createSalesFacade();
    const result = facade.computeTotalsPreview([lineInput({ unit_price_jpy: 99_999_999 })], "floor");

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E101" }));
  });
});

describe("createSalesFacade().listDocuments — getDealRefs の batch 呼び出しで N+1 を回避する", () => {
  it("同一 deal_id が複数件あっても getDealRefs は重複排除した配列で 1 回だけ呼ばれる", async () => {
    listDocumentsPageMock.mockResolvedValue({
      ok: true,
      value: {
        items: [
          documentRow({ id: "d1", deal_id: "deal-a" }),
          documentRow({ id: "d2", deal_id: "deal-a" }),
          documentRow({ id: "d3", deal_id: "deal-b" }),
        ],
        next_cursor: null,
      },
    });
    getDealRefsMock.mockResolvedValue({
      ok: true,
      value: [
        dealRef({ deal_id: "deal-a", title: "案件A" }),
        dealRef({ deal_id: "deal-b", title: "案件B" }),
      ],
    });

    const facade = createSalesFacade();
    const result = await facade.listDocuments(
      { doc_type: null, status: null, deal_id: null, q: null },
      { cursor: null, limit: 50 },
    );

    expect(getDealRefsMock).toHaveBeenCalledTimes(1);
    expect(getDealRefsMock).toHaveBeenCalledWith(["deal-a", "deal-b"], undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items.map((i) => i.deal_title)).toEqual(["案件A", "案件A", "案件B"]);
    }
  });
});

describe("createSalesFacade().getDocumentDetail — versions (#51: listIssuedDocumentVersions 配線) + derivable_to 配線", () => {
  it("versions は listIssuedDocumentVersions の結果 (content_snapshot を除いた軽量射影) を返し、derivable_to は internal/state.ts の算出結果と一致する", async () => {
    getDocumentByIdMock.mockResolvedValue({
      ok: true,
      value: documentRow({ doc_type: "quote", status: "issued" }),
    });
    listDocumentLinesMock.mockResolvedValue({ ok: true, value: [] });
    listPaymentsMock.mockResolvedValue({ ok: true, value: [] });
    getDealRefMock.mockResolvedValue({ ok: true, value: dealRef() });
    listIssuedDocumentVersionsMock.mockResolvedValue({
      ok: true,
      value: [
        {
          issued_document_id: "v-2",
          version: 2,
          sha256: "b".repeat(64),
          issued_at: "2026-07-02T00:00:00Z",
          supersedes: "v-1",
          storage_path: "documents/x/v2.pdf",
          content_snapshot: { dummy: true },
        },
        {
          issued_document_id: "v-1",
          version: 1,
          sha256: "a".repeat(64),
          issued_at: "2026-07-01T00:00:00Z",
          supersedes: null,
          storage_path: "documents/x/v1.pdf",
          content_snapshot: { dummy: true },
        },
      ],
    });

    const facade = createSalesFacade();
    const result = await facade.getDocumentDetail(DOC_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.versions).toEqual([
        {
          issued_document_id: "v-2",
          version: 2,
          sha256: "b".repeat(64),
          issued_at: "2026-07-02T00:00:00Z",
          supersedes: "v-1",
          storage_path: "documents/x/v2.pdf",
        },
        {
          issued_document_id: "v-1",
          version: 1,
          sha256: "a".repeat(64),
          issued_at: "2026-07-01T00:00:00Z",
          supersedes: null,
          storage_path: "documents/x/v1.pdf",
        },
      ]);
      // content_snapshot は DocumentDetail.versions の軽量型に含めない (実装計画書「成果物6」)
      expect(result.value.versions[0]).not.toHaveProperty("content_snapshot");
      expect(result.value.derivable_to).toEqual(["order", "invoice"]);
      expect(result.value.balance_jpy).toBe(result.value.document.total_jpy);
    }
  });

  it("#101: emails は listDocumentEmails の結果を返し、version は issued_document_id を versions と突き合わせて補完する", async () => {
    getDocumentByIdMock.mockResolvedValue({
      ok: true,
      value: documentRow({ doc_type: "invoice", status: "issued" }),
    });
    listDocumentLinesMock.mockResolvedValue({ ok: true, value: [] });
    listPaymentsMock.mockResolvedValue({ ok: true, value: [] });
    getDealRefMock.mockResolvedValue({ ok: true, value: dealRef() });
    listIssuedDocumentVersionsMock.mockResolvedValue({
      ok: true,
      value: [
        {
          issued_document_id: "v-1",
          version: 1,
          sha256: "a".repeat(64),
          issued_at: "2026-07-01T00:00:00Z",
          supersedes: null,
          storage_path: "documents/x/v1.pdf",
          content_snapshot: { dummy: true },
        },
      ],
    });
    listDocumentEmailsMock.mockResolvedValue({
      ok: true,
      value: [
        {
          id: "email-1",
          document_id: DOC_ID,
          issued_document_id: "v-1",
          to_email: "customer@example.com",
          cc_email: null,
          subject: "件名",
          body: "本文",
          status: "sent",
          error_detail: null,
          provider_message_id: "msg-1",
          sent_at: "2026-07-03T00:00:00Z",
          created_by: "user-1",
          created_at: "2026-07-03T00:00:00Z",
        },
        {
          id: "email-2",
          document_id: DOC_ID,
          issued_document_id: "v-unknown", // versions に無い issued_document_id (整合性崩れ) → v0 に degrade
          to_email: "bad@example.com",
          cc_email: null,
          subject: "件名2",
          body: "本文2",
          status: "failed",
          error_detail: "RESEND_API_KEY 未設定です",
          provider_message_id: null,
          sent_at: "2026-07-04T00:00:00Z",
          created_by: "user-1",
          created_at: "2026-07-04T00:00:00Z",
        },
      ],
    });

    const facade = createSalesFacade();
    const result = await facade.getDocumentDetail(DOC_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.emails).toEqual([
        {
          id: "email-1",
          to_email: "customer@example.com",
          cc_email: null,
          subject: "件名",
          body: "本文",
          status: "sent",
          error_detail: null,
          provider_message_id: "msg-1",
          version: 1,
          sent_at: "2026-07-03T00:00:00Z",
        },
        {
          id: "email-2",
          to_email: "bad@example.com",
          cc_email: null,
          subject: "件名2",
          body: "本文2",
          status: "failed",
          error_detail: "RESEND_API_KEY 未設定です",
          provider_message_id: null,
          version: 0,
          sent_at: "2026-07-04T00:00:00Z",
        },
      ]);
    }
  });

  it("listIssuedDocumentVersions が失敗したら E901 等をそのまま透過する (握り潰さない)", async () => {
    getDocumentByIdMock.mockResolvedValue({
      ok: true,
      value: documentRow({ doc_type: "quote", status: "issued" }),
    });
    listDocumentLinesMock.mockResolvedValue({ ok: true, value: [] });
    listPaymentsMock.mockResolvedValue({ ok: true, value: [] });
    getDealRefMock.mockResolvedValue({ ok: true, value: dealRef() });
    listIssuedDocumentVersionsMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "boom" });

    const facade = createSalesFacade();
    const result = await facade.getDocumentDetail(DOC_ID);

    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "boom" });
  });

  it("対象文書が存在しない場合は KMB-E621", async () => {
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: null });

    const facade = createSalesFacade();
    const result = await facade.getDocumentDetail(DOC_ID);

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E621" }));
  });
});

// ============================================================
// getIssuedContentSnapshot (#51 — 版間差分ダイアログ §11.1 の入力取得)
// ============================================================

function issuedContentSnapshotFixture(overrides: Record<string, unknown> = {}) {
  return {
    doc_type: "quote",
    doc_no: "Q-2026-0001",
    version: 1,
    issue_date: "2026-07-01",
    transaction_date: "2026-07-01",
    valid_until: "2026-08-01",
    billing_name: "サンプル建設",
    billing_suffix: "様",
    billing_address: null,
    site_name: null,
    site_address: null,
    notes: null,
    tax_rounding: "floor",
    issuer: {
      issuer_name: "隈部塗装",
      registration_number: null,
      address: null,
      tel: null,
      email: null,
      seal_storage_path: null,
      bank_account: null,
      transfer_fee_note: null,
    },
    lines: [
      {
        position: 0,
        description: "施工費",
        quantity: 1,
        unit: "式",
        unit_price_jpy: 10_000,
        amount_jpy: 10_000,
        tax_category: "standard_10",
      },
    ],
    subtotal_jpy: 10_000,
    tax_summary: [{ tax_category: "standard_10", taxable_jpy: 10_000, tax_jpy: 1_000 }],
    total_jpy: 11_000,
    ...overrides,
  };
}

describe("createSalesFacade().getIssuedContentSnapshot", () => {
  it("該当版の content_snapshot を zIssuedContentSnapshot で検証して返す", async () => {
    listIssuedDocumentVersionsMock.mockResolvedValue({
      ok: true,
      value: [
        { issued_document_id: "v-1", version: 1, sha256: "a".repeat(64), issued_at: "2026-07-01T00:00:00Z", supersedes: null, storage_path: "p1", content_snapshot: issuedContentSnapshotFixture() },
      ],
    });

    const facade = createSalesFacade();
    const result = await facade.getIssuedContentSnapshot(DOC_ID, 1);

    expect(result).toEqual({ ok: true, value: issuedContentSnapshotFixture() });
  });

  it("指定版が台帳に見つからない場合は KMB-E627", async () => {
    listIssuedDocumentVersionsMock.mockResolvedValue({ ok: true, value: [] });

    const facade = createSalesFacade();
    const result = await facade.getIssuedContentSnapshot(DOC_ID, 3);

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E627" }));
  });

  it("content_snapshot が zIssuedContentSnapshot と不一致なら握り潰さず KMB-E901", async () => {
    listIssuedDocumentVersionsMock.mockResolvedValue({
      ok: true,
      value: [
        { issued_document_id: "v-1", version: 1, sha256: "a".repeat(64), issued_at: "2026-07-01T00:00:00Z", supersedes: null, storage_path: "p1", content_snapshot: { broken: true } },
      ],
    });

    const facade = createSalesFacade();
    const result = await facade.getIssuedContentSnapshot(DOC_ID, 1);

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E901" }));
  });
});

// ============================================================
// recordPayment (#51 — 02-sales.md §6.1)。地雷: PaymentRow には document の最新 status が
// 含まれないため、insertPayment 成功後の getDocumentById 再取得が invoice_paid 判定に必須。
// ============================================================

function paymentInputFixture(overrides: Record<string, unknown> = {}) {
  return {
    document_id: DOC_ID,
    paid_on: "2026-07-05",
    amount_jpy: 3000,
    method: "bank_transfer" as const,
    memo: null,
    ...overrides,
  };
}

function paymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "pay-1",
    document_id: DOC_ID,
    paid_on: "2026-07-05",
    amount_jpy: 3000,
    method: "bank_transfer",
    memo: null,
    created_by: null,
    created_at: "2026-07-05T00:00:00Z",
    ...overrides,
  };
}

describe("createSalesFacade().recordPayment — 部分入金/完済判定 (§6.1)", () => {
  it("Zod parse 失敗 (amount_jpy=0) は KMB-E101 を返し、insertPayment には触れない", async () => {
    const facade = createSalesFacade();
    const result = await facade.recordPayment(paymentInputFixture({ amount_jpy: 0 }));

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E101" }));
    expect(insertPaymentMock).not.toHaveBeenCalled();
  });

  it("insertPayment が trigger 由来の KMB-E625 (残高超過) を返した場合はそのまま透過し、getDocumentById には触れない", async () => {
    insertPaymentMock.mockResolvedValue({
      ok: false,
      code: "KMB-E625",
      detail: "KMB-E625: 入金合計が請求金額を超えます",
    });

    const facade = createSalesFacade();
    const result = await facade.recordPayment(paymentInputFixture());

    expect(result).toEqual({ ok: false, code: "KMB-E625", detail: "KMB-E625: 入金合計が請求金額を超えます" });
    expect(getDocumentByIdMock).not.toHaveBeenCalled();
  });

  it("部分入金 (再取得した document.status が 'issued' のまま): invoice_paid=false・event='payment_recorded'・タイトルに残高を含む", async () => {
    insertPaymentMock.mockResolvedValue({ ok: true, value: paymentRow({ id: "pay-1", amount_jpy: 3000 }) });
    getDocumentByIdMock.mockResolvedValue({
      ok: true,
      value: documentRow({ status: "issued", doc_type: "invoice", doc_no: "I-2026-0001", total_jpy: 11000, current_version: 1, deal_id: DEAL_ID }),
    });
    listPaymentsMock.mockResolvedValue({ ok: true, value: [paymentRow({ id: "pay-1", amount_jpy: 3000 })] });
    appendActivityMock.mockResolvedValue({ ok: true, value: { activity_id: "act-1", created: true } });

    const facade = createSalesFacade();
    const result = await facade.recordPayment(paymentInputFixture({ amount_jpy: 3000 }));

    expect(result).toEqual({
      ok: true,
      value: {
        payment_id: "pay-1",
        invoice_paid: false,
        event: {
          document_id: DOC_ID,
          doc_type: "invoice",
          doc_no: "I-2026-0001",
          event: "payment_recorded",
          total_jpy: 11000,
          version: 1,
        },
      },
    });
    expect(appendActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activity_type: "document_event",
        ref_table: "payments",
        ref_id: "pay-1",
        title: expect.stringContaining("残高 ¥8,000"),
        links: [{ customer_id: null, company_id: null, deal_id: DEAL_ID }],
      }),
      undefined,
    );
  });

  it("完済 (再取得した document.status が 'paid'): invoice_paid=true・event='paid'・タイトルに完済を含む", async () => {
    insertPaymentMock.mockResolvedValue({ ok: true, value: paymentRow({ id: "pay-2", amount_jpy: 6000 }) });
    getDocumentByIdMock.mockResolvedValue({
      ok: true,
      value: documentRow({ status: "paid", doc_type: "invoice", doc_no: "I-2026-0002", total_jpy: 11000, current_version: 1, deal_id: DEAL_ID }),
    });
    listPaymentsMock.mockResolvedValue({
      ok: true,
      value: [paymentRow({ id: "pay-1", amount_jpy: 5000 }), paymentRow({ id: "pay-2", amount_jpy: 6000 })],
    });
    appendActivityMock.mockResolvedValue({ ok: true, value: { activity_id: "act-2", created: true } });

    const facade = createSalesFacade();
    const result = await facade.recordPayment(paymentInputFixture({ amount_jpy: 6000 }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.invoice_paid).toBe(true);
      expect(result.value.event.event).toBe("paid");
    }
    expect(appendActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining("完済") }),
      undefined,
    );
  });

  it("insertPayment 成功直後の getDocumentById が value:null (地雷: 再取得失敗) は KMB-E901 を明示的に返す (握り潰さない)", async () => {
    insertPaymentMock.mockResolvedValue({ ok: true, value: paymentRow() });
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: null });

    const facade = createSalesFacade();
    const result = await facade.recordPayment(paymentInputFixture());

    expect(result).toEqual({
      ok: false,
      code: "KMB-E901",
      detail: "入金記録直後に帳票の再取得に失敗しました。",
    });
    expect(listPaymentsMock).not.toHaveBeenCalled();
  });

  it("getDocumentById 自体の失敗はそのまま透過し、listPayments には触れない", async () => {
    insertPaymentMock.mockResolvedValue({ ok: true, value: paymentRow() });
    getDocumentByIdMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "db down" });

    const facade = createSalesFacade();
    const result = await facade.recordPayment(paymentInputFixture());

    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "db down" });
    expect(listPaymentsMock).not.toHaveBeenCalled();
  });

  it("listPayments の失敗はそのまま透過する (balance_jpy 未算出のまま握り潰さない)", async () => {
    insertPaymentMock.mockResolvedValue({ ok: true, value: paymentRow() });
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: documentRow({ status: "issued" }) });
    listPaymentsMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "boom" });

    const facade = createSalesFacade();
    const result = await facade.recordPayment(paymentInputFixture());

    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "boom" });
  });

  it("appendActivity が失敗しても recordPayment 自体は成功のまま返す (主操作は既に成功済み — warn のみ)", async () => {
    insertPaymentMock.mockResolvedValue({ ok: true, value: paymentRow() });
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: documentRow({ status: "issued" }) });
    listPaymentsMock.mockResolvedValue({ ok: true, value: [paymentRow()] });
    appendActivityMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "activities insert failed" });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const facade = createSalesFacade();
    const result = await facade.recordPayment(paymentInputFixture());

    expect(result.ok).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ============================================================
// deletePayment (#51 — 02-sales.md §6.2)。DELETE のみ・appendActivity は呼ばない (§11.3)。
// ============================================================

describe("createSalesFacade().deletePayment — 入金訂正 (DELETE のみ、appendActivity は呼ばない)", () => {
  it("uuid でない payment_id は KMB-E101 を返し、session/repository には一切触れない", async () => {
    const facade = createSalesFacade();
    const result = await facade.deletePayment("not-a-uuid");

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E101" }));
    expect(getSessionAndClientMock).not.toHaveBeenCalled();
    expect(repoDeletePaymentMock).not.toHaveBeenCalled();
  });

  it("有効な uuid: repository.deletePayment の結果をそのまま返し、appendActivity は呼ばない (§11.3: 台帳と復帰trigger自体が監査痕跡)", async () => {
    repoDeletePaymentMock.mockResolvedValue({ ok: true, value: undefined });

    const facade = createSalesFacade();
    const result = await facade.deletePayment("55555555-5555-4555-8555-555555555555");

    expect(result).toEqual({ ok: true, value: undefined });
    expect(repoDeletePaymentMock).toHaveBeenCalledWith(expect.anything(), "55555555-5555-4555-8555-555555555555");
    expect(appendActivityMock).not.toHaveBeenCalled();
  });

  it("repository のエラー (対象なし KMB-E621) をそのまま透過する", async () => {
    repoDeletePaymentMock.mockResolvedValue({ ok: false, code: "KMB-E621", detail: "入金記録が見つかりません。" });

    const facade = createSalesFacade();
    const result = await facade.deletePayment("55555555-5555-4555-8555-555555555555");

    expect(result).toEqual({ ok: false, code: "KMB-E621", detail: "入金記録が見つかりません。" });
  });
});

// ============================================================
// getSalesDigest (#51 — 02-sales.md §6.2)。地雷 (最重要): ctx を都度渡す設計であり、
// ファクトリの injectedClient と混同してはならない (resolveSalesExecutionClient)。
// ============================================================

/** ctx.client / injectedClient に渡すダミー SupabaseClient (any 禁止のため unknown 経由でキャスト
 *  する最小ヘルパ — tests/sales-repository.test.ts の buildClient と同じ「unknown 経由」の作法)。 */
function fakeSupabaseClient(marker: Record<string, unknown> = {}): SupabaseClient {
  return marker as unknown as SupabaseClient;
}

describe("createSalesFacade().getSalesDigest — ctx 都度渡し (地雷回帰防止: injectedClient と混同しない)", () => {
  it("factory に injectedClient を渡していても、ctx を省略して呼べば session (getSessionAndClient) を使う (injectedClient は無視される)", async () => {
    const factoryInjectedClient = fakeSupabaseClient({ tag: "factory-injected" });
    const sessionClient = { tag: "session-client" };
    getSessionAndClientMock.mockResolvedValue({ supabase: sessionClient, user: { id: "user-1" } });
    listExpiringQuotesMock.mockResolvedValue({ ok: true, value: [] });
    listUnpaidInvoicesMock.mockResolvedValue({ ok: true, value: [] });

    const facade = createSalesFacade(factoryInjectedClient);
    const result = await facade.getSalesDigest();

    expect(result.ok).toBe(true);
    expect(getSessionAndClientMock).toHaveBeenCalledTimes(1);
    expect(listExpiringQuotesMock).toHaveBeenCalledWith(sessionClient, expect.any(String));
    expect(listUnpaidInvoicesMock).toHaveBeenCalledWith(sessionClient);
  });

  it("ctx={mode:'service',client} を明示的に渡すと session を使わずその client を使う", async () => {
    const serviceClient = fakeSupabaseClient({ tag: "service-client" });
    listExpiringQuotesMock.mockResolvedValue({ ok: true, value: [] });
    listUnpaidInvoicesMock.mockResolvedValue({ ok: true, value: [] });

    const facade = createSalesFacade();
    const result = await facade.getSalesDigest({ mode: "service", client: serviceClient });

    expect(result.ok).toBe(true);
    expect(getSessionAndClientMock).not.toHaveBeenCalled();
    expect(listExpiringQuotesMock).toHaveBeenCalledWith(serviceClient, expect.any(String));
  });

  it("ctx={mode:'service'} で client 省略時は createSupabaseServiceClient() を生成して使う", async () => {
    const generatedClient = fakeSupabaseClient({ tag: "generated" });
    createSupabaseServiceClientMock.mockReturnValue(generatedClient);
    listExpiringQuotesMock.mockResolvedValue({ ok: true, value: [] });
    listUnpaidInvoicesMock.mockResolvedValue({ ok: true, value: [] });

    const facade = createSalesFacade();
    const result = await facade.getSalesDigest({ mode: "service" });

    expect(result.ok).toBe(true);
    expect(createSupabaseServiceClientMock).toHaveBeenCalledTimes(1);
    expect(listExpiringQuotesMock).toHaveBeenCalledWith(generatedClient, expect.any(String));
  });

  it("ctx 省略・未ログインセッションは KMB-E201 (repository には触れない)", async () => {
    getSessionAndClientMock.mockResolvedValue({ supabase: {}, user: null });

    const facade = createSalesFacade();
    const result = await facade.getSalesDigest();

    expect(result).toEqual({ ok: false, code: "KMB-E201" });
    expect(listExpiringQuotesMock).not.toHaveBeenCalled();
  });
});

describe("createSalesFacade().getSalesDigest — カットオフ計算・集計 (JST 今日+7日)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T03:00:00Z")); // JST 2026-07-14 12:00
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cutoff = JST今日+7日 で listExpiringQuotes を呼び、unpaid_invoices は listPaymentsForDocuments の合算で balance_jpy を算出する", async () => {
    listExpiringQuotesMock.mockResolvedValue({
      ok: true,
      value: [
        { document_id: "q-1", doc_no: "Q-2026-0001", billing_name: "サンプル建設", valid_until: "2026-07-20", total_jpy: 22000 },
      ],
    });
    listUnpaidInvoicesMock.mockResolvedValue({
      ok: true,
      value: [
        { document_id: "i-1", doc_no: "I-2026-0001", billing_name: "サンプル建設", issue_date: "2026-07-01", total_jpy: 11000 },
      ],
    });
    listPaymentsForDocumentsMock.mockResolvedValue({
      ok: true,
      value: [
        paymentRow({ id: "p-1", document_id: "i-1", amount_jpy: 4000 }),
        paymentRow({ id: "p-2", document_id: "i-1", amount_jpy: 2000 }),
      ],
    });

    const facade = createSalesFacade();
    const result = await facade.getSalesDigest({ mode: "service", client: fakeSupabaseClient() });

    expect(listExpiringQuotesMock).toHaveBeenCalledWith(expect.anything(), "2026-07-21");
    expect(listPaymentsForDocumentsMock).toHaveBeenCalledWith(expect.anything(), ["i-1"]);
    expect(result).toEqual({
      ok: true,
      value: {
        expiring_quotes: [
          { document_id: "q-1", doc_no: "Q-2026-0001", billing_name: "サンプル建設", valid_until: "2026-07-20", total_jpy: 22000 },
        ],
        unpaid_invoices: [
          {
            document_id: "i-1",
            doc_no: "I-2026-0001",
            billing_name: "サンプル建設",
            issue_date: "2026-07-01",
            total_jpy: 11000,
            paid_jpy: 6000,
            balance_jpy: 5000,
          },
        ],
      },
    });
  });

  it("unpaid_invoices が空なら listPaymentsForDocuments を呼ばない (N+1回避の空配列ショートサーキット)", async () => {
    listExpiringQuotesMock.mockResolvedValue({ ok: true, value: [] });
    listUnpaidInvoicesMock.mockResolvedValue({ ok: true, value: [] });

    const facade = createSalesFacade();
    const result = await facade.getSalesDigest({ mode: "service", client: fakeSupabaseClient() });

    expect(listPaymentsForDocumentsMock).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, value: { expiring_quotes: [], unpaid_invoices: [] } });
  });

  it("expiring_quotes の doc_no が null (台帳不整合) は握り潰さず KMB-E901", async () => {
    listExpiringQuotesMock.mockResolvedValue({
      ok: true,
      value: [{ document_id: "q-1", doc_no: null, billing_name: "x", valid_until: "2026-07-20", total_jpy: 1000 }],
    });
    listUnpaidInvoicesMock.mockResolvedValue({ ok: true, value: [] });

    const facade = createSalesFacade();
    const result = await facade.getSalesDigest({ mode: "service", client: fakeSupabaseClient() });

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E901" }));
  });

  it("unpaid_invoices の issue_date が null (台帳不整合) は握り潰さず KMB-E901", async () => {
    listExpiringQuotesMock.mockResolvedValue({ ok: true, value: [] });
    listUnpaidInvoicesMock.mockResolvedValue({
      ok: true,
      value: [{ document_id: "i-1", doc_no: "I-1", billing_name: "x", issue_date: null, total_jpy: 1000 }],
    });

    const facade = createSalesFacade();
    const result = await facade.getSalesDigest({ mode: "service", client: fakeSupabaseClient() });

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E901" }));
  });

  it("listExpiringQuotes の失敗はそのまま透過する", async () => {
    listExpiringQuotesMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "boom" });

    const facade = createSalesFacade();
    const result = await facade.getSalesDigest({ mode: "service", client: fakeSupabaseClient() });

    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "boom" });
  });

  it("listUnpaidInvoices の失敗はそのまま透過する", async () => {
    listExpiringQuotesMock.mockResolvedValue({ ok: true, value: [] });
    listUnpaidInvoicesMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "boom2" });

    const facade = createSalesFacade();
    const result = await facade.getSalesDigest({ mode: "service", client: fakeSupabaseClient() });

    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "boom2" });
  });

  it("listPaymentsForDocuments の失敗はそのまま透過する", async () => {
    listExpiringQuotesMock.mockResolvedValue({ ok: true, value: [] });
    listUnpaidInvoicesMock.mockResolvedValue({
      ok: true,
      value: [{ document_id: "i-1", doc_no: "I-1", billing_name: "x", issue_date: "2026-07-01", total_jpy: 1000 }],
    });
    listPaymentsForDocumentsMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "boom3" });

    const facade = createSalesFacade();
    const result = await facade.getSalesDigest({ mode: "service", client: fakeSupabaseClient() });

    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "boom3" });
  });
});

// ============================================================
// markExpiredQuotes (#51 — 02-sales.md §6.2)。ctx 必須・バッチ処理。
// ============================================================

describe("createSalesFacade().markExpiredQuotes — 一括expired化 + 行ごとappendActivity (§6.2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-14T03:00:00Z")); // JST 2026-07-14 12:00
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("bulkExpireOverdueQuotes に JST 今日を渡し、返された各行に appendActivity(event:'expired', ref_table:'documents/expired') を呼ぶ", async () => {
    const doc1 = documentRow({ id: "d-1", doc_type: "quote", status: "expired", doc_no: "Q-1", deal_id: DEAL_ID });
    const doc2 = documentRow({ id: "d-2", doc_type: "quote", status: "expired", doc_no: "Q-2", deal_id: DEAL_ID });
    bulkExpireOverdueQuotesMock.mockResolvedValue({ ok: true, value: [doc1, doc2] });
    appendActivityMock.mockResolvedValue({ ok: true, value: { activity_id: "a", created: true } });
    const ctxClient = fakeSupabaseClient();

    const facade = createSalesFacade();
    const result = await facade.markExpiredQuotes({ mode: "service", client: ctxClient });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(bulkExpireOverdueQuotesMock).toHaveBeenCalledWith(expect.anything(), "2026-07-14");
    expect(appendActivityMock).toHaveBeenCalledTimes(2);
    expect(appendActivityMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        activity_type: "document_event",
        ref_table: "documents/expired",
        ref_id: "d-1",
        payload: expect.objectContaining({ event: "expired" }),
      }),
      { mode: "service", client: ctxClient },
    );
  });

  it("1件のappendActivity失敗があっても他の行の処理は続行し、全体は成功のまま返す (warn のみ)", async () => {
    const doc1 = documentRow({ id: "d-1", doc_type: "quote", status: "expired", doc_no: "Q-1", deal_id: DEAL_ID });
    const doc2 = documentRow({ id: "d-2", doc_type: "quote", status: "expired", doc_no: "Q-2", deal_id: DEAL_ID });
    bulkExpireOverdueQuotesMock.mockResolvedValue({ ok: true, value: [doc1, doc2] });
    appendActivityMock
      .mockResolvedValueOnce({ ok: false, code: "KMB-E901", detail: "insert failed" })
      .mockResolvedValueOnce({ ok: true, value: { activity_id: "a2", created: true } });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const facade = createSalesFacade();
    const result = await facade.markExpiredQuotes({ mode: "service", client: fakeSupabaseClient() });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(appendActivityMock).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("対象0件なら appendActivity は呼ばれず成功で返る", async () => {
    bulkExpireOverdueQuotesMock.mockResolvedValue({ ok: true, value: [] });

    const facade = createSalesFacade();
    const result = await facade.markExpiredQuotes({ mode: "service", client: fakeSupabaseClient() });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(appendActivityMock).not.toHaveBeenCalled();
  });

  it("bulkExpireOverdueQuotes の失敗はそのまま透過し、appendActivity は呼ばれない", async () => {
    bulkExpireOverdueQuotesMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "boom" });

    const facade = createSalesFacade();
    const result = await facade.markExpiredQuotes({ mode: "service", client: fakeSupabaseClient() });

    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "boom" });
    expect(appendActivityMock).not.toHaveBeenCalled();
  });

  it("地雷回帰防止: factory に injectedClient を渡していても、呼び出し時の ctx.client が bulkExpireOverdueQuotes に渡る (ファクトリの injectedClient は無視される)", async () => {
    const factoryClient = fakeSupabaseClient({ tag: "factory" });
    const ctxClient = fakeSupabaseClient({ tag: "ctx-client" });
    bulkExpireOverdueQuotesMock.mockResolvedValue({ ok: true, value: [] });

    const facade = createSalesFacade(factoryClient);
    await facade.markExpiredQuotes({ mode: "service", client: ctxClient });

    expect(bulkExpireOverdueQuotesMock).toHaveBeenCalledWith(ctxClient, expect.any(String));
  });
});
