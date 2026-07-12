import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/modules/sales/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/sales/repository")>();
  return {
    ...actual,
    createDraftDocument: (...args: unknown[]) => repoCreateDraftDocumentMock(...args),
    deleteDraftDocument: (...args: unknown[]) => repoDeleteDraftDocumentMock(...args),
    getDocumentById: (...args: unknown[]) => getDocumentByIdMock(...args),
    listDocumentLines: (...args: unknown[]) => listDocumentLinesMock(...args),
    listDocumentsPage: (...args: unknown[]) => listDocumentsPageMock(...args),
    listPayments: (...args: unknown[]) => listPaymentsMock(...args),
    saveDraftDocument: (...args: unknown[]) => saveDraftDocumentMock(...args),
    updateDocumentStatusWithCas: (...args: unknown[]) => updateDocumentStatusWithCasMock(...args),
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
    customer: { customer_id: "c-1", name: "田中太郎", kind: "person", address: "顧客住所" },
    company: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionAndClientMock.mockResolvedValue({ supabase: {}, user: { id: "user-1" } });
  settingsGetMock.mockResolvedValue({ ok: true, value: { tax_rounding: "floor" } });
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
      value: dealRef({ company: null, customer: { customer_id: "c-1", name: "田中太郎", kind: "person", address: "顧客住所4-5-6" } }),
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

describe("createSalesFacade().getDocumentDetail — versions 固定空配列 + derivable_to 配線", () => {
  it("versions は常に空配列 (issued_documents は #50 未実装)、derivable_to は internal/state.ts の算出結果と一致する", async () => {
    getDocumentByIdMock.mockResolvedValue({
      ok: true,
      value: documentRow({ doc_type: "quote", status: "issued" }),
    });
    listDocumentLinesMock.mockResolvedValue({ ok: true, value: [] });
    listPaymentsMock.mockResolvedValue({ ok: true, value: [] });
    getDealRefMock.mockResolvedValue({ ok: true, value: dealRef() });

    const facade = createSalesFacade();
    const result = await facade.getDocumentDetail(DOC_ID);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.versions).toEqual([]);
      expect(result.value.derivable_to).toEqual(["order", "invoice"]);
      expect(result.value.balance_jpy).toBe(result.value.document.total_jpy);
    }
  });

  it("対象文書が存在しない場合は KMB-E621", async () => {
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: null });

    const facade = createSalesFacade();
    const result = await facade.getDocumentDetail(DOC_ID);

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E621" }));
  });
});
