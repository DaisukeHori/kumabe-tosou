import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * canonical: docs/design/crm-suite/02-sales.md §18 → 本編化 (issue #101)。
 *
 * createSalesFacade().sendDocumentByEmail の単体テスト。tests/sales-facade.test.ts と同型パターン
 * (repository / crmFacade / lib/env / lib/supabase/service・session / internal/email を vi.mock し、
 * 実 DB・実 Resend 呼び出しには一切接続しない)。
 *
 * 検証対象 (issue #101 受入基準・設計「エラー全列挙」と 1:1):
 *  - E621 (draft・帳票不在) / E623 (voided/declined/expired) / E627 (版なし・doc_no 未確定) /
 *    E645 (宛先不正・未指定) / E644 (RESEND_API_KEY 未設定・Resend API エラー)
 *  - 送信失敗時も document_emails に status='failed' 行が記録されること (E644 を返す前に INSERT 済み)
 *  - 成功時の document_emails 行 (status='sent') + appendActivity('email', direction:'outbound') 呼び出し
 *  - appendActivity 失敗時も送信自体は成功扱い (console.warn 縮退 — issueDocument と同型)
 */

const getSessionAndClientMock = vi.fn();
vi.mock("@/lib/supabase/session", () => ({
  getSessionAndClient: (...args: unknown[]) => getSessionAndClientMock(...args),
}));

const createSupabaseServiceClientMock = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: (...args: unknown[]) => createSupabaseServiceClientMock(...args),
}));

const isResendConfiguredMock = vi.fn();
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return {
    ...actual,
    isResendConfigured: (...args: unknown[]) => isResendConfiguredMock(...args),
  };
});

const appendActivityMock = vi.fn();
vi.mock("@/modules/crm/facade", () => ({
  crmFacade: {
    appendActivity: (...args: unknown[]) => appendActivityMock(...args),
  },
}));

const getDocumentByIdMock = vi.fn();
const getIssuedDocumentByVersionMock = vi.fn();
const downloadIssuedDocumentPdfMock = vi.fn();
const insertDocumentEmailMock = vi.fn();

vi.mock("@/modules/sales/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/sales/repository")>();
  return {
    ...actual,
    getDocumentById: (...args: unknown[]) => getDocumentByIdMock(...args),
    getIssuedDocumentByVersion: (...args: unknown[]) => getIssuedDocumentByVersionMock(...args),
    downloadIssuedDocumentPdf: (...args: unknown[]) => downloadIssuedDocumentPdfMock(...args),
    insertDocumentEmail: (...args: unknown[]) => insertDocumentEmailMock(...args),
  };
});

const sendDocumentEmailMock = vi.fn();
vi.mock("@/modules/sales/internal/email", () => ({
  sendDocumentEmail: (...args: unknown[]) => sendDocumentEmailMock(...args),
}));

import { createSalesFacade } from "@/modules/sales/facade";
import type { DocumentRow } from "@/modules/sales/repository";
import type { SendDocumentEmailInput } from "@/modules/sales/contracts";

const DOC_ID = "33333333-3333-4333-8333-333333333333";
const DEAL_ID = "22222222-2222-4222-8222-222222222222";

function documentRow(overrides: Partial<DocumentRow> = {}): DocumentRow {
  return {
    id: DOC_ID,
    doc_type: "invoice",
    status: "issued",
    deal_id: DEAL_ID,
    source_document_id: null,
    doc_no: "I-2026-0001",
    current_version: 1,
    issue_date: "2026-07-01",
    transaction_date: "2026-07-01",
    valid_until: null,
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
    issuer_snapshot: {
      issuer_name: "隈部塗装",
      registration_number: null,
      address: null,
      tel: null,
      email: "issuer@example.com",
      seal_storage_path: null,
      bank_account: null,
      transfer_fee_note: null,
    },
    status_reason: null,
    issued_at: "2026-07-01T00:00:00Z",
    paid_at: null,
    voided_at: null,
    created_by: "user-1",
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function validInput(overrides: Partial<SendDocumentEmailInput> = {}): SendDocumentEmailInput {
  return {
    to: "customer@example.com",
    cc: null,
    subject: "【隈部塗装】請求書のご送付 (I-2026-0001)",
    body: "本文です。",
    version: 1,
    ...overrides,
  };
}

const SERVICE_CLIENT_MARKER = { marker: "service" } as unknown as SupabaseClient;

beforeEach(() => {
  vi.clearAllMocks();
  getSessionAndClientMock.mockResolvedValue({ supabase: {}, user: { id: "user-1" } });
  createSupabaseServiceClientMock.mockReturnValue(SERVICE_CLIENT_MARKER);
  isResendConfiguredMock.mockReturnValue(true);
  getIssuedDocumentByVersionMock.mockResolvedValue({
    ok: true,
    value: { id: "issued-doc-1", storage_path: "documents/x/v1.pdf" },
  });
  downloadIssuedDocumentPdfMock.mockResolvedValue({ ok: true, value: Buffer.from("pdf-bytes") });
  sendDocumentEmailMock.mockResolvedValue({ ok: true, value: { provider_message_id: "msg-1" } });
  insertDocumentEmailMock.mockResolvedValue({ ok: true, value: { id: "email-1", sent_at: "2026-07-14T00:00:00Z" } });
  appendActivityMock.mockResolvedValue({ ok: true, value: { activity_id: "activity-1", created: true } });
});

describe("createSalesFacade().sendDocumentByEmail — 入力検証", () => {
  it("subject 欠落等 (to 以外のフィールド不正) は KMB-E101 を返す", async () => {
    const facade = createSalesFacade();
    const result = await facade.sendDocumentByEmail(DOC_ID, { ...validInput(), subject: "" } as SendDocumentEmailInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("KMB-E101");
    expect(getDocumentByIdMock).not.toHaveBeenCalled();
  });

  it("to が不正な形式の場合は専用コード KMB-E645 を返す (E101 と区別する)", async () => {
    const facade = createSalesFacade();
    const result = await facade.sendDocumentByEmail(DOC_ID, validInput({ to: "not-an-email" }));
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E645" }));
    expect(getDocumentByIdMock).not.toHaveBeenCalled();
  });

  it("to が空文字 (未指定相当) の場合も KMB-E645 を返す", async () => {
    const facade = createSalesFacade();
    const result = await facade.sendDocumentByEmail(DOC_ID, validInput({ to: "" }));
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E645" }));
  });
});

describe("createSalesFacade().sendDocumentByEmail — 帳票状態ガード", () => {
  it("帳票が存在しない場合は KMB-E621", async () => {
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: null });
    const facade = createSalesFacade();
    const result = await facade.sendDocumentByEmail(DOC_ID, validInput());
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E621" }));
  });

  it("draft の帳票は KMB-E621 (未発行は送付できない)", async () => {
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: documentRow({ status: "draft" }) });
    const facade = createSalesFacade();
    const result = await facade.sendDocumentByEmail(DOC_ID, validInput());
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E621" }));
    expect(isResendConfiguredMock).not.toHaveBeenCalled();
  });

  it.each(["voided", "declined", "expired"] as const)(
    "%s の帳票は KMB-E623 (発行済み系状態のみ許可)",
    async (status) => {
      getDocumentByIdMock.mockResolvedValue({ ok: true, value: documentRow({ status }) });
      const facade = createSalesFacade();
      const result = await facade.sendDocumentByEmail(DOC_ID, validInput());
      expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E623" }));
    },
  );

  it.each(["issued", "accepted", "paid"] as const)("%s の帳票は状態ガードを通過する", async (status) => {
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: documentRow({ status }) });
    const facade = createSalesFacade();
    const result = await facade.sendDocumentByEmail(DOC_ID, validInput());
    expect(result.ok).toBe(true);
  });

  it("doc_no が未確定 (到達不能ガード) の場合は KMB-E627", async () => {
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: documentRow({ doc_no: null }) });
    const facade = createSalesFacade();
    const result = await facade.sendDocumentByEmail(DOC_ID, validInput());
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E627" }));
  });
});

describe("createSalesFacade().sendDocumentByEmail — Resend 未設定・版なし・PDF取得失敗", () => {
  beforeEach(() => {
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: documentRow() });
  });

  it("RESEND_API_KEY 未設定は KMB-E644 (PDF ダウンロード前に早期リターン)", async () => {
    isResendConfiguredMock.mockReturnValue(false);
    const facade = createSalesFacade();
    const result = await facade.sendDocumentByEmail(DOC_ID, validInput());
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E644" }));
    expect(getIssuedDocumentByVersionMock).not.toHaveBeenCalled();
    expect(insertDocumentEmailMock).not.toHaveBeenCalled();
  });

  it("指定版が台帳に無い場合は KMB-E627", async () => {
    getIssuedDocumentByVersionMock.mockResolvedValue({ ok: true, value: null });
    const facade = createSalesFacade();
    const result = await facade.sendDocumentByEmail(DOC_ID, validInput());
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E627" }));
    expect(downloadIssuedDocumentPdfMock).not.toHaveBeenCalled();
  });

  it("PDF ダウンロード失敗は Result をそのまま透過する (E641)", async () => {
    downloadIssuedDocumentPdfMock.mockResolvedValue({ ok: false, code: "KMB-E641", detail: "not found" });
    const facade = createSalesFacade();
    const result = await facade.sendDocumentByEmail(DOC_ID, validInput());
    expect(result).toEqual({ ok: false, code: "KMB-E641", detail: "not found" });
    expect(sendDocumentEmailMock).not.toHaveBeenCalled();
  });
});

describe("createSalesFacade().sendDocumentByEmail — 送信失敗 (Resend エラー)", () => {
  beforeEach(() => {
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: documentRow() });
  });

  it("送信失敗時は document_emails に status='failed' + error_detail 行を記録した上で KMB-E644 を返す (握り潰さない)", async () => {
    sendDocumentEmailMock.mockResolvedValue({ ok: false, code: "KMB-E644", detail: "Resend API error" });

    const facade = createSalesFacade();
    const result = await facade.sendDocumentByEmail(DOC_ID, validInput());

    expect(result).toEqual({ ok: false, code: "KMB-E644", detail: "Resend API error" });
    expect(insertDocumentEmailMock).toHaveBeenCalledTimes(1);
    expect(insertDocumentEmailMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        status: "failed",
        errorDetail: "Resend API error",
        providerMessageId: null,
        issuedDocumentId: "issued-doc-1",
      }),
    );
    // 送信失敗時は案件タイムラインへは記録しない (appendActivity は成功送信のみ呼ぶ設計)
    expect(appendActivityMock).not.toHaveBeenCalled();
  });

  it("insertDocumentEmail 自体が失敗した場合はその Result を優先して返す (送信失敗の情報より DB エラーが優先)", async () => {
    sendDocumentEmailMock.mockResolvedValue({ ok: false, code: "KMB-E644", detail: "Resend API error" });
    insertDocumentEmailMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "db down" });

    const facade = createSalesFacade();
    const result = await facade.sendDocumentByEmail(DOC_ID, validInput());

    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "db down" });
  });
});

describe("createSalesFacade().sendDocumentByEmail — 成功", () => {
  beforeEach(() => {
    getDocumentByIdMock.mockResolvedValue({ ok: true, value: documentRow() });
  });

  it("成功時は document_emails に status='sent' 行を記録し、appendActivity('email', direction:'outbound') を呼び、{document_email_id, sent_at} を返す", async () => {
    const facade = createSalesFacade();
    const result = await facade.sendDocumentByEmail(DOC_ID, validInput({ cc: "cc@example.com" }));

    expect(result).toEqual({ ok: true, value: { document_email_id: "email-1", sent_at: "2026-07-14T00:00:00Z" } });

    expect(insertDocumentEmailMock).toHaveBeenCalledTimes(1);
    expect(insertDocumentEmailMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        documentId: DOC_ID,
        issuedDocumentId: "issued-doc-1",
        toEmail: "customer@example.com",
        ccEmail: "cc@example.com",
        status: "sent",
        errorDetail: null,
        providerMessageId: "msg-1",
        createdBy: "user-1",
      }),
    );

    expect(sendDocumentEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        docType: "invoice",
        docNo: "I-2026-0001",
        version: 1,
        to: "customer@example.com",
        cc: "cc@example.com",
        replyTo: "issuer@example.com",
      }),
    );

    expect(appendActivityMock).toHaveBeenCalledTimes(1);
    const [payload] = appendActivityMock.mock.calls[0];
    expect(payload).toEqual(
      expect.objectContaining({
        activity_type: "email",
        ref_table: "document_emails",
        ref_id: "email-1",
        payload: {
          direction: "outbound",
          subject: validInput().subject,
          to: "customer@example.com",
          document_id: DOC_ID,
          doc_no: "I-2026-0001",
          version: 1,
          provider_message_id: "msg-1",
        },
        links: [{ customer_id: null, company_id: null, deal_id: DEAL_ID }],
      }),
    );
  });

  it("issuer_snapshot.email が null の場合は replyTo を省略 (null) で送信する", async () => {
    getDocumentByIdMock.mockResolvedValue({
      ok: true,
      value: documentRow({
        issuer_snapshot: {
          issuer_name: "隈部塗装",
          registration_number: null,
          address: null,
          tel: null,
          email: null,
          seal_storage_path: null,
          bank_account: null,
          transfer_fee_note: null,
        },
      }),
    });
    const facade = createSalesFacade();
    await facade.sendDocumentByEmail(DOC_ID, validInput());
    expect(sendDocumentEmailMock).toHaveBeenCalledWith(expect.objectContaining({ replyTo: null }));
  });

  it("appendActivity が失敗しても送信自体は成功扱いで返る (console.warn 縮退 — issueDocument と同型)", async () => {
    appendActivityMock.mockResolvedValue({ ok: false, code: "KMB-E604", detail: "boom" });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const facade = createSalesFacade();
    const result = await facade.sendDocumentByEmail(DOC_ID, validInput());

    expect(result).toEqual({ ok: true, value: { document_email_id: "email-1", sent_at: "2026-07-14T00:00:00Z" } });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
