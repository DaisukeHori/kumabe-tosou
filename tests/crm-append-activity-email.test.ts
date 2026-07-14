import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/crm-suite/01-crm.md §6.6 手順2b (issue #101 — J7 Phase 2 段階解禁)。
 *
 * crmFacade.appendActivity('email') の受入/拒否を検証する:
 *  - direction='inbound' は KMB-E604 で拒否される。二段階 parse の直後・client 解決の**前**に
 *    短絡することを確認する (getSessionAndClient / repository が一切呼ばれないこと)。
 *  - direction='outbound' (sales.sendDocumentByEmail が呼ぶ経路) は受け入れられ、
 *    activities への INSERT + activity_links への INSERT まで進む。
 *
 * getSessionAndClient / crm/repository をモックし実 DB には接続しない
 * (tests/crm-timeline-facade-degrade.test.ts と同型パターン踏襲)。
 */

const getSessionAndClientMock = vi.fn();
vi.mock("@/lib/supabase/session", () => ({
  getSessionAndClient: (...args: unknown[]) => getSessionAndClientMock(...args),
}));

const getDealByIdMock = vi.fn();
const appendActivityRowMock = vi.fn();
const linkActivityRowMock = vi.fn();

vi.mock("@/modules/crm/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/crm/repository")>();
  return {
    ...actual,
    getDealById: (...args: unknown[]) => getDealByIdMock(...args),
    appendActivityRow: (...args: unknown[]) => appendActivityRowMock(...args),
    linkActivityRow: (...args: unknown[]) => linkActivityRowMock(...args),
  };
});

import { crmFacade } from "@/modules/crm/facade";
import type { AppendActivityInput } from "@/modules/crm/contracts";

const DEAL_ID = "11111111-1111-4111-8111-111111111111";
const DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";
const ACTIVITY_ID = "33333333-3333-4333-8333-333333333333";

function emailAppendInput(overrides: {
  direction: "inbound" | "outbound";
}): AppendActivityInput {
  return {
    activity_type: "email",
    occurred_at: "2026-07-14T00:00:00.000Z",
    title: "送付: I-2026-0001",
    body: null,
    payload: {
      direction: overrides.direction,
      subject: "【隈部塗装】請求書のご送付 (I-2026-0001)",
      to: "customer@example.com",
      document_id: DOCUMENT_ID,
      doc_no: "I-2026-0001",
      version: 1,
      provider_message_id: overrides.direction === "outbound" ? "msg-1" : null,
    },
    ref_table: "document_emails",
    ref_id: "44444444-4444-4444-8444-444444444444",
    links: [{ customer_id: null, company_id: null, deal_id: DEAL_ID }],
  };
}

describe("crmFacade.appendActivity('email') — J7 Phase 2 段階解禁 (#101)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("direction='inbound' は KMB-E604 で拒否され、client 解決 (getSessionAndClient) にすら到達しない (受信基盤が無いための短絡)", async () => {
    const result = await crmFacade.appendActivity(emailAppendInput({ direction: "inbound" }));

    expect(result).toEqual({
      ok: false,
      code: "KMB-E604",
      detail: "メールの受信取込は未対応です (送信のみ対応)。",
    });
    expect(getSessionAndClientMock).not.toHaveBeenCalled();
    expect(appendActivityRowMock).not.toHaveBeenCalled();
  });

  it("direction='outbound' は受け入れられ、activities への INSERT + activity_links への INSERT まで進む", async () => {
    getSessionAndClientMock.mockResolvedValue({ supabase: {}, user: { id: "user-1" } });
    getDealByIdMock.mockResolvedValue({ ok: true, value: { id: DEAL_ID } });
    appendActivityRowMock.mockResolvedValue({
      ok: true,
      value: {
        row: {
          id: ACTIVITY_ID,
          activity_type: "email",
          occurred_at: "2026-07-14T00:00:00.000Z",
          title: "送付: I-2026-0001",
          body: null,
          payload: {},
          ref_table: "document_emails",
          ref_id: "44444444-4444-4444-8444-444444444444",
          created_by: "user-1",
          created_at: "2026-07-14T00:00:00.000Z",
          updated_at: "2026-07-14T00:00:00.000Z",
        },
        created: true,
      },
    });
    linkActivityRowMock.mockResolvedValue({
      ok: true,
      value: {
        row: { id: "link-1", activity_id: ACTIVITY_ID, customer_id: null, company_id: null, deal_id: DEAL_ID, created_at: "2026-07-14T00:00:00.000Z" },
        created: true,
      },
    });

    const result = await crmFacade.appendActivity(emailAppendInput({ direction: "outbound" }));

    expect(result).toEqual({ ok: true, value: { activity_id: ACTIVITY_ID, created: true } });
    expect(appendActivityRowMock).toHaveBeenCalledTimes(1);
    expect(appendActivityRowMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({ activity_type: "email", ref_table: "document_emails" }),
    );
    expect(linkActivityRowMock).toHaveBeenCalledTimes(1);
  });

  it("payload が zEmailActivityPayload と不一致 (二段階 parse の内側) の場合は direction を見る前に KMB-E604 になる", async () => {
    const invalid: AppendActivityInput = {
      ...emailAppendInput({ direction: "outbound" }),
      payload: { direction: "outbound", subject: "件名のみ" }, // #101 拡張フィールド欠落
    };

    const result = await crmFacade.appendActivity(invalid);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("KMB-E604");
    expect(getSessionAndClientMock).not.toHaveBeenCalled();
  });
});
