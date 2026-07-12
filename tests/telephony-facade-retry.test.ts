import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * canonical: docs/design/crm-suite/04-telephony.md §7.1 (D8 — retryCallJob(callJobId): Promise<Result<void>>、
 * ctx を取らない admin セッション専用。返し得るエラー: E807(failed以外) / E804(不存在) / E201/E202)。
 * TelephonyFacade.retryCallJob の薄いラッパー部分 (session 解決 → repository 委譲 → 例外捕捉) を
 * repository/session をモックして検証する (敵対レビュー MAJOR 対応 — E804/E807 分岐の回帰防止に加えて
 * E201 未ログイン分岐もあわせて固定する)。
 */

const sessionMock = vi.fn();
vi.mock("@/lib/supabase/session", () => ({
  getSessionAndClient: (...args: unknown[]) => sessionMock(...args),
}));

const retryCallJobRpcMock = vi.fn();
vi.mock("@/modules/telephony/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/telephony/repository")>();
  return {
    ...actual,
    retryCallJobRpc: (...args: unknown[]) => retryCallJobRpcMock(...args),
  };
});

import { telephonyFacade } from "@/modules/telephony/facade";

const fakeClient = {} as SupabaseClient;
const JOB_ID = "44444444-4444-4444-4444-444444444444";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("telephonyFacade.retryCallJob (D8 — ctx なし、session 専用)", () => {
  it("未ログイン (user null) は KMB-E201 を返し、repository.retryCallJobRpc は呼ばれない", async () => {
    sessionMock.mockResolvedValue({ supabase: fakeClient, user: null });
    const result = await telephonyFacade.retryCallJob(JOB_ID);
    expect(result).toEqual({ ok: false, code: "KMB-E201" });
    expect(retryCallJobRpcMock).not.toHaveBeenCalled();
  });

  it("repository が KMB-E807 (failed 以外) を返した場合はそのまま透過する", async () => {
    sessionMock.mockResolvedValue({ supabase: fakeClient, user: { id: "admin-1" } });
    retryCallJobRpcMock.mockResolvedValue({ ok: false, code: "KMB-E807", detail: "failed 以外" });
    const result = await telephonyFacade.retryCallJob(JOB_ID);
    expect(result).toEqual({ ok: false, code: "KMB-E807", detail: "failed 以外" });
    expect(retryCallJobRpcMock).toHaveBeenCalledWith(fakeClient, JOB_ID);
  });

  it("repository が KMB-E804 (不存在) を返した場合はそのまま透過する", async () => {
    sessionMock.mockResolvedValue({ supabase: fakeClient, user: { id: "admin-1" } });
    retryCallJobRpcMock.mockResolvedValue({ ok: false, code: "KMB-E804", detail: "不存在" });
    const result = await telephonyFacade.retryCallJob(JOB_ID);
    expect(result).toEqual({ ok: false, code: "KMB-E804", detail: "不存在" });
  });

  it("repository が KMB-E202 (非admin) を返した場合はそのまま透過する", async () => {
    sessionMock.mockResolvedValue({ supabase: fakeClient, user: { id: "non-admin-1" } });
    retryCallJobRpcMock.mockResolvedValue({ ok: false, code: "KMB-E202", detail: "permission denied" });
    const result = await telephonyFacade.retryCallJob(JOB_ID);
    expect(result).toEqual({ ok: false, code: "KMB-E202", detail: "permission denied" });
  });

  it("成功時は ok:true / value:undefined を返す", async () => {
    sessionMock.mockResolvedValue({ supabase: fakeClient, user: { id: "admin-1" } });
    retryCallJobRpcMock.mockResolvedValue({ ok: true, value: "pending" });
    const result = await telephonyFacade.retryCallJob(JOB_ID);
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("getSessionAndClient が例外を投げた場合は KMB-E901 へ変換する (握り潰さない)", async () => {
    sessionMock.mockRejectedValue(new Error("network down"));
    const result = await telephonyFacade.retryCallJob(JOB_ID);
    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "network down" });
  });
});
