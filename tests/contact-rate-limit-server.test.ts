import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * rate_limits の原子カウント (src/components/contact/rate-limit.server.ts)。
 * RPC rate_limit_increment (migration 20260906000001) を 1 回だけ呼び、返った count が
 * 上限を超えていれば KMB-E105 を返すこと、RPC 障害時は fail-open で許可することを検証する。
 */

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({ rpc: (...args: unknown[]) => rpcMock(...args) }),
}));

const isServiceRoleConfiguredMock = vi.fn();
vi.mock("@/lib/env", () => ({
  isServiceRoleConfigured: () => isServiceRoleConfiguredMock(),
}));

import { checkAndRecordRateLimit } from "@/components/contact/rate-limit.server";
import { RATE_LIMIT_MAX_PER_HOUR } from "@/components/contact/spam-guard";

const NOW = new Date("2026-09-06T10:23:45.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  isServiceRoleConfiguredMock.mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("checkAndRecordRateLimit (RPC rate_limit_increment)", () => {
  it("RPC を 1 回だけ、時単位に floor した window_start と route で呼ぶ", async () => {
    rpcMock.mockResolvedValue({ data: 1, error: null });

    const res = await checkAndRecordRateLimit("hash-1", NOW, "shop_lead");

    expect(res).toEqual({ ok: true, value: undefined });
    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("rate_limit_increment", {
      p_ip_hash: "hash-1",
      p_route: "shop_lead",
      p_window_start: "2026-09-06T10:00:00.000Z",
      p_limit: RATE_LIMIT_MAX_PER_HOUR,
    });
  });

  it("route 省略時は contact_form で集計する", async () => {
    rpcMock.mockResolvedValue({ data: 1, error: null });
    await checkAndRecordRateLimit("hash-1", NOW);
    expect(rpcMock.mock.calls[0]?.[1]).toMatchObject({ p_route: "contact_form" });
  });

  it("count が上限ちょうど (5 件目) までは許可する", async () => {
    rpcMock.mockResolvedValue({ data: RATE_LIMIT_MAX_PER_HOUR, error: null });
    const res = await checkAndRecordRateLimit("hash-1", NOW);
    expect(res.ok).toBe(true);
  });

  it("count が上限を超えたら KMB-E105 で拒否する", async () => {
    rpcMock.mockResolvedValue({ data: RATE_LIMIT_MAX_PER_HOUR + 1, error: null });
    const res = await checkAndRecordRateLimit("hash-1", NOW);
    expect(res).toEqual({ ok: false, code: "KMB-E105", detail: "rate_limit_exceeded" });
  });

  it("RPC がエラーを返したら fail-open で許可する", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    const res = await checkAndRecordRateLimit("hash-1", NOW);
    expect(res).toEqual({ ok: true, value: undefined });
  });

  it("戻り値が数値でなければ fail-open で許可する", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const res = await checkAndRecordRateLimit("hash-1", NOW);
    expect(res).toEqual({ ok: true, value: undefined });
  });

  it("SUPABASE_SERVICE_ROLE_KEY 未設定ならチェックをスキップして許可する", async () => {
    isServiceRoleConfiguredMock.mockReturnValue(false);
    const res = await checkAndRecordRateLimit("hash-1", NOW);
    expect(res).toEqual({ ok: true, value: undefined });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
