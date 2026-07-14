import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: GitHub Issue #99 成果物2「UI」。
 * updateCustomerLifecycleAction (src/app/admin/customers/actions.ts) の admin gating / Zod 検証 /
 * facade 呼び出し・revalidatePath を検証する。
 *
 * tests/deals-propose-cancel-blocks.test.ts / tests/calls-actions.test.ts の確立パターンを踏襲。
 * 実 DB には一切触れない。
 */

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));

const requireAdminMock = vi.fn();
vi.mock("@/modules/platform/facade", () => ({
  platformFacade: { requireAdmin: (...args: unknown[]) => requireAdminMock(...args) },
}));

const updateCustomerLifecycleMock = vi.fn();
vi.mock("@/modules/crm/facade", () => ({
  crmFacade: {
    updateCustomerLifecycle: (...args: unknown[]) => updateCustomerLifecycleMock(...args),
  },
}));

import { updateCustomerLifecycleAction } from "@/app/admin/customers/actions";

const ADMIN_OK = { ok: true as const, value: { userId: "admin-1" } };
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue(ADMIN_OK);
});

describe("updateCustomerLifecycleAction — admin gating", () => {
  it("requireAdmin が失敗した場合はそのまま返し facade を呼ばない", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, code: "KMB-E201" });

    const result = await updateCustomerLifecycleAction(CUSTOMER_ID, "customer", "2026-07-11T00:00:00.000Z");

    expect(result).toEqual({ ok: false, code: "KMB-E201" });
    expect(updateCustomerLifecycleMock).not.toHaveBeenCalled();
  });
});

describe("updateCustomerLifecycleAction — Zod 検証", () => {
  it("契約にない lifecycle 値は KMB-E101 を返し facade を呼ばない", async () => {
    const result = await updateCustomerLifecycleAction(
      CUSTOMER_ID,
      // @ts-expect-error 契約違反値を意図的に渡す
      "prospect",
      "2026-07-11T00:00:00.000Z",
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("KMB-E101");
    expect(updateCustomerLifecycleMock).not.toHaveBeenCalled();
  });
});

describe("updateCustomerLifecycleAction — 成功時", () => {
  it("facade.updateCustomerLifecycle を呼び、顧客一覧・詳細ページを revalidate する", async () => {
    updateCustomerLifecycleMock.mockResolvedValue({ ok: true, value: undefined });

    const result = await updateCustomerLifecycleAction(CUSTOMER_ID, "archived", "2026-07-11T00:00:00.000Z");

    expect(result).toEqual({ ok: true, value: undefined });
    expect(updateCustomerLifecycleMock).toHaveBeenCalledWith(CUSTOMER_ID, "archived", "2026-07-11T00:00:00.000Z");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/customers");
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/customers/${CUSTOMER_ID}`);
  });
});

describe("updateCustomerLifecycleAction — facade 失敗時の Result 透過 (握り潰さない)", () => {
  it("KMB-E103 (CAS 不一致) はそのまま返し revalidatePath を呼ばない", async () => {
    updateCustomerLifecycleMock.mockResolvedValue({
      ok: false,
      code: "KMB-E103",
      detail: "他の操作で更新されています。再読み込みしてやり直してください。",
    });

    const result = await updateCustomerLifecycleAction(CUSTOMER_ID, "customer", "2026-07-11T00:00:00.000Z");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("KMB-E103");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
