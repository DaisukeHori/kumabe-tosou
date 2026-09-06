import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/crm-suite/01-crm.md §6.1 契約表 relinkActivity 行 (E201・E202 (session 時)) / §6.7。
 *
 * relinkActivity は置換を service client (RLS 非適用) で実行するため、session モードでは
 * ログイン確認だけでなく platformFacade.isAdmin(userId) を確認し、非 admin には KMB-E202 を返す
 * ことを検証する。service モード (ctx.mode="service") では admin 判定を行わない。
 * getSessionAndClient / platform facade / service client / crm repository をモックし実 DB には接続しない。
 */

const getSessionAndClientMock = vi.fn();
vi.mock("@/lib/supabase/session", () => ({
  getSessionAndClient: (...args: unknown[]) => getSessionAndClientMock(...args),
}));

const isAdminMock = vi.fn();
vi.mock("@/modules/platform/facade", () => ({
  platformFacade: {
    isAdmin: (...args: unknown[]) => isAdminMock(...args),
    requireAdmin: vi.fn(),
  },
}));

const SERVICE_CLIENT = { __service: true };
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => SERVICE_CLIENT,
}));

const getActivityByIdMock = vi.fn();
const getCustomerByIdMock = vi.fn();
const listActivityLinksByActivityMock = vi.fn();
const deleteActivityLinksByActivityMock = vi.fn();
const linkActivityRowMock = vi.fn();
const appendActivityRowMock = vi.fn();

vi.mock("@/modules/crm/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/crm/repository")>();
  return {
    ...actual,
    getActivityById: (...args: unknown[]) => getActivityByIdMock(...args),
    getCustomerById: (...args: unknown[]) => getCustomerByIdMock(...args),
    listActivityLinksByActivity: (...args: unknown[]) => listActivityLinksByActivityMock(...args),
    deleteActivityLinksByActivity: (...args: unknown[]) => deleteActivityLinksByActivityMock(...args),
    linkActivityRow: (...args: unknown[]) => linkActivityRowMock(...args),
    appendActivityRow: (...args: unknown[]) => appendActivityRowMock(...args),
  };
});

import { crmFacade } from "@/modules/crm/facade";

const ACTIVITY_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "33333333-3333-4333-8333-333333333333";

describe("crmFacade.relinkActivity の admin ガード", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionAndClientMock.mockResolvedValue({ supabase: {}, user: { id: USER_ID } });
    getActivityByIdMock.mockResolvedValue({
      ok: true,
      value: { id: ACTIVITY_ID, activity_type: "call", ref_table: "calls", ref_id: null },
    });
    listActivityLinksByActivityMock.mockResolvedValue({ ok: true, value: [] });
    deleteActivityLinksByActivityMock.mockResolvedValue({ ok: true, value: undefined });
    linkActivityRowMock.mockResolvedValue({ ok: true, value: { row: {}, created: true } });
    appendActivityRowMock.mockResolvedValue({ ok: true, value: { row: { id: "audit" }, created: true } });
  });

  it("session モードで非 admin → KMB-E202 (置換処理には進まない)", async () => {
    isAdminMock.mockResolvedValue(false);

    const result = await crmFacade.relinkActivity(ACTIVITY_ID, []);

    expect(result).toEqual({ ok: false, code: "KMB-E202" });
    expect(isAdminMock).toHaveBeenCalledWith(USER_ID);
    expect(getActivityByIdMock).not.toHaveBeenCalled();
    expect(deleteActivityLinksByActivityMock).not.toHaveBeenCalled();
  });

  it("session モードで admin → 置換処理に進む (links=[] で全解除)", async () => {
    isAdminMock.mockResolvedValue(true);

    const result = await crmFacade.relinkActivity(ACTIVITY_ID, []);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(isAdminMock).toHaveBeenCalledWith(USER_ID);
    expect(deleteActivityLinksByActivityMock).toHaveBeenCalledWith(SERVICE_CLIENT, ACTIVITY_ID);
  });

  it("session モードで未ログイン → KMB-E201 (isAdmin は呼ばれない)", async () => {
    getSessionAndClientMock.mockResolvedValue({ supabase: {}, user: null });

    const result = await crmFacade.relinkActivity(ACTIVITY_ID, []);

    expect(result).toEqual({ ok: false, code: "KMB-E201" });
    expect(isAdminMock).not.toHaveBeenCalled();
  });

  it("service モード → admin 判定を行わず置換処理に進む", async () => {
    const result = await crmFacade.relinkActivity(ACTIVITY_ID, [], { mode: "service" });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(isAdminMock).not.toHaveBeenCalled();
    expect(getSessionAndClientMock).not.toHaveBeenCalled();
    expect(deleteActivityLinksByActivityMock).toHaveBeenCalledWith(SERVICE_CLIENT, ACTIVITY_ID);
  });

  it("links 形式不正 (2 対象) は認可確認より先に KMB-E101", async () => {
    const result = await crmFacade.relinkActivity(ACTIVITY_ID, [
      { customer_id: USER_ID, company_id: USER_ID, deal_id: null },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("KMB-E101");
    expect(isAdminMock).not.toHaveBeenCalled();
  });
});
