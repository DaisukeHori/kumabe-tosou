import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/crm-suite/01-crm.md §7.1 (lookupPostalAddressAction — zipcloud プロキシ)。
 * fetch を stub し、zipcloud レスポンス整形と失敗時の degrade (E610/E611) を検証する。実 API・実 DB
 * には触れない (tests/customers-actions.test.ts の最小フェイクパターン踏襲)。
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const requireAdminMock = vi.fn();
vi.mock("@/modules/platform/facade", () => ({
  platformFacade: { requireAdmin: (...args: unknown[]) => requireAdminMock(...args) },
}));

vi.mock("@/modules/crm/facade", () => ({ crmFacade: {} }));

import { lookupPostalAddressAction } from "@/app/admin/customers/actions";

const ADMIN_OK = { ok: true as const, value: { userId: "admin-1" } };

function jsonResponse(body: unknown, status = 200) {
  return { status, json: async () => body } as unknown as Response;
}

describe("lookupPostalAddressAction", () => {
  beforeEach(() => {
    requireAdminMock.mockReset().mockResolvedValue(ADMIN_OK);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("正規化不能な郵便番号は KMB-E610 を返し fetch しない", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await lookupPostalAddressAction("123");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E610");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("results[0] の address1+address2+address3 を連結して返す", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ status: 200, results: [{ address1: "熊本県", address2: "熊本市中央区", address3: "水前寺" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await lookupPostalAddressAction("860-0801");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.address).toBe("熊本県熊本市中央区水前寺");
    // 正規化された 7 桁で zipcloud を叩くこと
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0]?.[0] as string)).toContain("zipcode=8600801");
  });

  it("複数件ヒットは先頭を採用する", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: 200,
        results: [
          { address1: "A県", address2: "A市", address3: "A町" },
          { address1: "B県", address2: "B市", address3: "B町" },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await lookupPostalAddressAction("8600801");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.address).toBe("A県A市A町");
  });

  it("results が null (該当なし) は KMB-E611", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 200, results: null, message: "該当なし" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await lookupPostalAddressAction("9999999");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E611");
  });

  it("status ≠ 200 は KMB-E611", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 500));
    vi.stubGlobal("fetch", fetchMock);

    const result = await lookupPostalAddressAction("8600801");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E611");
  });

  it("fetch が throw (ネットワーク障害・timeout) すると KMB-E611", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await lookupPostalAddressAction("8600801");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E611");
  });

  it("requireAdmin 失敗時は fetch せずそのまま返す", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, code: "KMB-E201" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await lookupPostalAddressAction("8600801");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E201");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
