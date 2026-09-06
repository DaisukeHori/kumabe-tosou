import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/crm-suite/02-sales.md §4.3-B (訂正発行) / §6.1 issueDocument 手順3。
 *
 * 回帰テスト: reviseAndReissueDocument で quote の valid_until が null のまま渡された場合、
 * issueDocument と同じく issue_date + invoice_issuer.quote_valid_days で補完すること。
 * 補完されないと訂正版の見積だけ有効期限が null になり、期限切れ判定と印字から抜け落ちる。
 *
 * tests/sales-facade.test.ts の vi.mock パターン (repository / crmFacade / settingsFacade /
 * session / service を差し替え) に加え、PDF 生成 (internal/pdf) と lib/env の前提条件チェックも
 * モックし、実 DB・Chromium には触れない。
 */

const getSessionAndClientMock = vi.fn();
vi.mock("@/lib/supabase/session", () => ({
  getSessionAndClient: (...args: unknown[]) => getSessionAndClientMock(...args),
}));

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({}),
}));

vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return {
    ...actual,
    isServiceRoleConfigured: () => true,
    isPrintTokenSecretConfigured: () => true,
  };
});

const appendActivityMock = vi.fn();
vi.mock("@/modules/crm/facade", () => ({
  crmFacade: {
    appendActivity: (...args: unknown[]) => appendActivityMock(...args),
  },
}));

const settingsGetMock = vi.fn();
vi.mock("@/modules/settings/facade", () => ({
  settingsFacade: { get: (...args: unknown[]) => settingsGetMock(...args) },
}));

const generateDocumentPdfMock = vi.fn();
vi.mock("@/modules/sales/internal/pdf", () => ({
  generateDocumentPdf: (...args: unknown[]) => generateDocumentPdfMock(...args),
}));

const getDocumentByIdMock = vi.fn();
const insertRevisionStagingMock = vi.fn();
const applyDocumentRevisionMock = vi.fn();
const cleanupOrphanRevisionStagingsMock = vi.fn();
vi.mock("@/modules/sales/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/sales/repository")>();
  return {
    ...actual,
    getDocumentById: (...args: unknown[]) => getDocumentByIdMock(...args),
    insertRevisionStaging: (...args: unknown[]) => insertRevisionStagingMock(...args),
    applyDocumentRevision: (...args: unknown[]) => applyDocumentRevisionMock(...args),
    cleanupOrphanRevisionStagings: (...args: unknown[]) => cleanupOrphanRevisionStagingsMock(...args),
  };
});

import { createSalesFacade } from "@/modules/sales/facade";
import type { DocumentRow } from "@/modules/sales/repository";
import type { ReviseDocumentInput } from "@/modules/sales/contracts";

const DEAL_ID = "22222222-2222-4222-8222-222222222222";
const DOC_ID = "33333333-3333-4333-8333-333333333333";

const ISSUER_SNAPSHOT = {
  issuer_name: "山岸塗装",
  registration_number: null,
  address: null,
  tel: null,
  email: null,
  seal_storage_path: null,
  bank_account: null,
  transfer_fee_note: null,
};

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
    issuer_snapshot: ISSUER_SNAPSHOT,
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

function reviseInput(overrides: Partial<ReviseDocumentInput> = {}): ReviseDocumentInput {
  return {
    issue_date: "2026-07-10",
    transaction_date: null,
    valid_until: null,
    billing_name: "サンプル建設",
    billing_suffix: "様",
    billing_address: null,
    site_name: null,
    site_address: null,
    notes: null,
    lines: [
      {
        description: "施工費",
        quantity: 1,
        unit: "式",
        unit_price_jpy: 10_000,
        amount_jpy: 10_000,
        tax_category: "standard_10",
        work_type_key: null,
        source: null,
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionAndClientMock.mockResolvedValue({ supabase: {}, user: { id: "user-1" } });
  settingsGetMock.mockResolvedValue({ ok: true, value: { tax_rounding: "floor", quote_valid_days: 14 } });
  cleanupOrphanRevisionStagingsMock.mockResolvedValue(undefined);
  insertRevisionStagingMock.mockResolvedValue({ ok: true, value: { id: "staging-1" } });
  generateDocumentPdfMock.mockResolvedValue({
    ok: true,
    value: { sha256: "a".repeat(64), storagePath: "documents/doc/v2.pdf" },
  });
  applyDocumentRevisionMock.mockResolvedValue({
    ok: true,
    value: { issued_document_id: "ledger-2", doc_version: 2, new_updated_at: "u2" },
  });
  appendActivityMock.mockResolvedValue({ ok: true, value: undefined });
});

describe("createSalesFacade().reviseAndReissueDocument — quote の valid_until 補完", () => {
  it("quote で valid_until=null なら issue_date + quote_valid_days を staging と content_snapshot に入れる", async () => {
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: documentRow() });

    const facade = createSalesFacade();
    const result = await facade.reviseAndReissueDocument(DOC_ID, reviseInput({ issue_date: "2026-07-10" }), "u1");

    expect(result).toEqual({ ok: true, value: { version: 2, pdf_storage_path: "documents/doc/v2.pdf" } });
    expect(settingsGetMock).toHaveBeenCalledWith("invoice_issuer", undefined);
    // 2026-07-10 + 14 日 = 2026-07-24
    expect(insertRevisionStagingMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ header: expect.objectContaining({ valid_until: "2026-07-24" }) }),
    );
    expect(applyDocumentRevisionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ contentSnapshot: expect.objectContaining({ valid_until: "2026-07-24" }) }),
    );
  });

  it("quote で valid_until が明示されていればそのまま使い、invoice_issuer は参照しない", async () => {
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: documentRow() });

    const facade = createSalesFacade();
    const result = await facade.reviseAndReissueDocument(DOC_ID, reviseInput({ valid_until: "2026-09-30" }), "u1");

    expect(result.ok).toBe(true);
    expect(settingsGetMock).not.toHaveBeenCalledWith("invoice_issuer", expect.anything());
    expect(insertRevisionStagingMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ header: expect.objectContaining({ valid_until: "2026-09-30" }) }),
    );
  });

  it("quote 以外 (invoice) の valid_until=null は補完せず null のまま (invoice_issuer も参照しない)", async () => {
    getDocumentByIdMock.mockResolvedValue({
      ok: true,
      value: documentRow({ doc_type: "invoice", doc_no: "I-2026-0001", valid_until: null }),
    });

    const facade = createSalesFacade();
    const result = await facade.reviseAndReissueDocument(DOC_ID, reviseInput(), "u1");

    expect(result.ok).toBe(true);
    expect(settingsGetMock).not.toHaveBeenCalled();
    expect(insertRevisionStagingMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ header: expect.objectContaining({ valid_until: null }) }),
    );
  });

  it("invoice_issuer 設定が取得できない場合は KMB-E626 で止め、staging を作らない", async () => {
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: documentRow() });
    settingsGetMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "boom" });

    const facade = createSalesFacade();
    const result = await facade.reviseAndReissueDocument(DOC_ID, reviseInput(), "u1");

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E626" }));
    expect(insertRevisionStagingMock).not.toHaveBeenCalled();
    expect(generateDocumentPdfMock).not.toHaveBeenCalled();
  });
});
