import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: GitHub Issue #99 (顧客一覧・やること一覧へのカンバンビュー追加) 成果物2 /
 * 01-crm.md §5.3・§6.2 (契約外拡張)。
 *
 * crmFacade.listCustomersKanban / crmFacade.updateCustomerLifecycle を検証する。
 * 「エラー握り潰し厳禁」地雷 (全 Issue で繰り返し刺さった最重要地雷) の回帰防止として、
 * DB エラーがそのまま Result として伝播し、空配列や ok:true への無言変換が起きないことを
 * 中心に確認する (受入基準: 「listCustomersKanban / updateCustomerLifecycle が DB エラーを
 * Result で伝播し(握り潰しなし)」)。
 *
 * getSessionAndClient / crm/repository をモックし実 DB には接続しない
 * (tests/crm-timeline-facade-degrade.test.ts と同型パターン踏襲)。
 */

const getSessionAndClientMock = vi.fn();
vi.mock("@/lib/supabase/session", () => ({
  getSessionAndClient: (...args: unknown[]) => getSessionAndClientMock(...args),
}));

const listCustomersByLifecycleMock = vi.fn();
const updateCustomerLifecycleWithCasMock = vi.fn();
const getCompaniesByIdsMock = vi.fn();
const countOpenDealsByCustomerIdsMock = vi.fn();

vi.mock("@/modules/crm/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/crm/repository")>();
  return {
    ...actual,
    listCustomersByLifecycle: (...args: unknown[]) => listCustomersByLifecycleMock(...args),
    updateCustomerLifecycleWithCas: (...args: unknown[]) => updateCustomerLifecycleWithCasMock(...args),
    getCompaniesByIds: (...args: unknown[]) => getCompaniesByIdsMock(...args),
    countOpenDealsByCustomerIds: (...args: unknown[]) => countOpenDealsByCustomerIdsMock(...args),
  };
});

import { crmFacade } from "@/modules/crm/facade";
import type { CustomerRow } from "@/modules/crm/repository";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";

function customerRow(overrides: Partial<CustomerRow>): CustomerRow {
  return {
    id: CUSTOMER_ID,
    kind: "person",
    name: "山田太郎",
    name_kana: null,
    email: null,
    tel_e164: null,
    company_id: null,
    address: null,
    notes: null,
    lifecycle: "lead",
    source: "manual",
    merged_into_customer_id: null,
    created_by: null,
    created_at: "2026-07-11T00:00:00.000Z",
    updated_at: "2026-07-11T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSessionAndClientMock.mockResolvedValue({ supabase: {}, user: { id: "user-1" } });
  getCompaniesByIdsMock.mockResolvedValue({ ok: true, value: [] });
  countOpenDealsByCustomerIdsMock.mockResolvedValue({ ok: true, value: {} });
});

describe("crmFacade.listCustomersKanban", () => {
  it("lead/customer/archived の3列を、archived だけ limit 20・他は limit 100 で取得する", async () => {
    listCustomersByLifecycleMock.mockResolvedValue({ ok: true, value: { rows: [], total: 0 } });

    const result = await crmFacade.listCustomersKanban();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.map((c) => c.lifecycle)).toEqual(["lead", "customer", "archived"]);
    expect(listCustomersByLifecycleMock).toHaveBeenCalledTimes(3);
    expect(listCustomersByLifecycleMock).toHaveBeenCalledWith(expect.anything(), "lead", 100);
    expect(listCustomersByLifecycleMock).toHaveBeenCalledWith(expect.anything(), "customer", 100);
    expect(listCustomersByLifecycleMock).toHaveBeenCalledWith(expect.anything(), "archived", 20);
  });

  it("各列の total_count / customers を repository の集計結果からそのまま組み立てる", async () => {
    listCustomersByLifecycleMock.mockImplementation((_client: unknown, lifecycle: string) => {
      if (lifecycle === "lead") {
        return Promise.resolve({
          ok: true,
          value: { rows: [customerRow({ id: "c-1", lifecycle: "lead" })], total: 42 },
        });
      }
      return Promise.resolve({ ok: true, value: { rows: [], total: 0 } });
    });

    const result = await crmFacade.listCustomersKanban();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    const leadColumn = result.value.find((c) => c.lifecycle === "lead");
    expect(leadColumn?.total_count).toBe(42);
    expect(leadColumn?.customers).toHaveLength(1);
    expect(leadColumn?.customers[0].id).toBe("c-1");
  });

  it("未認証 (session なし) は KMB-E201 を返し repository を呼ばない", async () => {
    getSessionAndClientMock.mockResolvedValue({ supabase: {}, user: null });

    const result = await crmFacade.listCustomersKanban();

    expect(result).toEqual({ ok: false, code: "KMB-E201" });
    expect(listCustomersByLifecycleMock).not.toHaveBeenCalled();
  });

  it("1列でも DB エラーになったら即座に Result エラーを返す (空配列や ok:true への握り潰し禁止)", async () => {
    listCustomersByLifecycleMock.mockImplementation((_client: unknown, lifecycle: string) => {
      if (lifecycle === "customer") {
        return Promise.resolve({ ok: false, code: "KMB-E901", detail: "db down" });
      }
      return Promise.resolve({ ok: true, value: { rows: [], total: 0 } });
    });

    const result = await crmFacade.listCustomersKanban();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("KMB-E901");
    expect(result.detail).toBe("db down");
    // lead は成功して呼ばれるが、customer で失敗したら archived は呼ばれずに即 return する
    expect(listCustomersByLifecycleMock).toHaveBeenCalledTimes(2);
  });

  it("enrichCustomerListItems 側 (会社名解決) の DB エラーも Result として伝播する", async () => {
    listCustomersByLifecycleMock.mockResolvedValue({
      ok: true,
      value: { rows: [customerRow({ company_id: "company-1" })], total: 1 },
    });
    getCompaniesByIdsMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "join failed" });

    const result = await crmFacade.listCustomersKanban();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("KMB-E901");
  });
});

describe("crmFacade.updateCustomerLifecycle", () => {
  it("不正な lifecycle 値は KMB-E101 を返し repository を呼ばない", async () => {
    const result = await crmFacade.updateCustomerLifecycle(
      CUSTOMER_ID,
      // @ts-expect-error 契約違反値を意図的に渡す
      "not-a-lifecycle",
      "2026-07-11T00:00:00.000Z",
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("KMB-E101");
    expect(updateCustomerLifecycleWithCasMock).not.toHaveBeenCalled();
  });

  it("未認証は KMB-E201 を返す", async () => {
    getSessionAndClientMock.mockResolvedValue({ supabase: {}, user: null });

    const result = await crmFacade.updateCustomerLifecycle(CUSTOMER_ID, "customer", "2026-07-11T00:00:00.000Z");

    expect(result).toEqual({ ok: false, code: "KMB-E201" });
    expect(updateCustomerLifecycleWithCasMock).not.toHaveBeenCalled();
  });

  it("成功時は repository.updateCustomerLifecycleWithCas を lifecycle 1カラムの更新として呼ぶ", async () => {
    updateCustomerLifecycleWithCasMock.mockResolvedValue({ ok: true, value: customerRow({ lifecycle: "customer" }) });

    const result = await crmFacade.updateCustomerLifecycle(CUSTOMER_ID, "customer", "2026-07-11T00:00:00.000Z");

    expect(result).toEqual({ ok: true, value: undefined });
    expect(updateCustomerLifecycleWithCasMock).toHaveBeenCalledWith(
      expect.anything(),
      CUSTOMER_ID,
      "customer",
      "2026-07-11T00:00:00.000Z",
    );
  });

  it("CAS 不一致 (KMB-E103) はそのまま伝播する (握り潰し禁止 — DnD の楽観更新ロールバック判定に必須)", async () => {
    updateCustomerLifecycleWithCasMock.mockResolvedValue({
      ok: false,
      code: "KMB-E103",
      detail: "他の操作で更新されています。再読み込みしてやり直してください。",
    });

    const result = await crmFacade.updateCustomerLifecycle(CUSTOMER_ID, "archived", "2026-07-11T00:00:00.000Z");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("KMB-E103");
  });
});
