import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/crm-suite/01-crm.md §5.2 (zCustomerListFilter.q の注記
 * 「名前/かな/email/電話の部分一致 (電話は E.164 正規化後に前方一致)」)。
 *
 * crmFacade.listCustomers が q を normalizeJpPhoneToE164 で正規化できる場合に telE164Prefix を
 * repository (listCustomersPage) へ渡し、正規化できない q では null のまま従来どおり渡すことを検証する。
 * getSessionAndClient / crm/repository をモックし実 DB には接続しない
 * (tests/crm-timeline-facade-degrade.test.ts と同型パターン踏襲)。
 */

const getSessionAndClientMock = vi.fn();
vi.mock("@/lib/supabase/session", () => ({
  getSessionAndClient: (...args: unknown[]) => getSessionAndClientMock(...args),
}));

const listCustomersPageMock = vi.fn();
vi.mock("@/modules/crm/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/crm/repository")>();
  return {
    ...actual,
    listCustomersPage: (...args: unknown[]) => listCustomersPageMock(...args),
  };
});

import { crmFacade } from "@/modules/crm/facade";

const USER_ID = "33333333-3333-4333-8333-333333333333";

describe("crmFacade.listCustomers — 電話番号検索の E.164 正規化", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionAndClientMock.mockResolvedValue({ supabase: {}, user: { id: USER_ID } });
    listCustomersPageMock.mockResolvedValue({ ok: true, value: { items: [], next_cursor: null } });
  });

  it.each([
    ["090-1234-5678", "+819012345678"],
    ["09012345678", "+819012345678"],
    ["096 123 4567", "+81961234567"],
    ["+819012345678", "+819012345678"],
  ])("q=%s は telE164Prefix=%s として repository へ渡す (q 自体も従来どおり渡す)", async (q, expected) => {
    const result = await crmFacade.listCustomers({ q, lifecycle: "active", include_merged: false }, { limit: 20, cursor: null });
    expect(result.ok).toBe(true);
    expect(listCustomersPageMock).toHaveBeenCalledTimes(1);
    expect(listCustomersPageMock.mock.calls[0][1]).toEqual({
      q,
      lifecycle: "active",
      includeMerged: false,
      telE164Prefix: expected,
    });
  });

  it.each(["山田", "yamada@example.com", "5678", "090-1234"])(
    "電話番号として正規化できない q=%s は telE164Prefix=null (名前/かな/email/電話の部分一致のみ)",
    async (q) => {
      const result = await crmFacade.listCustomers({ q, lifecycle: "all", include_merged: true }, { limit: 20, cursor: null });
      expect(result.ok).toBe(true);
      expect(listCustomersPageMock.mock.calls[0][1]).toEqual({
        q,
        lifecycle: "all",
        includeMerged: true,
        telE164Prefix: null,
      });
    },
  );

  it("q=null なら telE164Prefix も null", async () => {
    await crmFacade.listCustomers({ q: null, lifecycle: "active", include_merged: false }, { limit: 20, cursor: null });
    expect(listCustomersPageMock.mock.calls[0][1]).toMatchObject({ q: null, telE164Prefix: null });
  });

  it("未ログインなら KMB-E201 で repository を呼ばない", async () => {
    getSessionAndClientMock.mockResolvedValue({ supabase: {}, user: null });
    const result = await crmFacade.listCustomers(
      { q: "090-1234-5678", lifecycle: "active", include_merged: false },
      { limit: 20, cursor: null },
    );
    expect(result).toEqual({ ok: false, code: "KMB-E201" });
    expect(listCustomersPageMock).not.toHaveBeenCalled();
  });
});
