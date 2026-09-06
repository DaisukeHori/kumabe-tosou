import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /admin/prices の savePricingAction (src/app/admin/prices/actions.ts)。
 * tests/settings-actions.test.ts と同じく next/cache・platformFacade・pricing facade を最小フェイクに
 * 差し替え、Action のロジック (zod 検証 → facade.replaceAllPricing 1 回呼び出し → 成否に関わらず
 * revalidate) のみ検証する。実 DB には触れない。
 *
 * 回帰: 旧実装は 5 テーブルを別々の facade メソッドで順に書き (非原子)、途中失敗時に
 * revalidateTag('prices') が呼ばれず /shop に旧表が焼き付いた。
 */

const revalidatePath = vi.fn();
const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
  revalidateTag: (...args: unknown[]) => revalidateTag(...args),
}));

const requireAdminMock = vi.fn();
vi.mock("@/modules/platform/facade", () => ({
  platformFacade: { requireAdmin: (...args: unknown[]) => requireAdminMock(...args) },
}));

const replaceAllPricingMock = vi.fn();
const getFullPriceTableMock = vi.fn();
vi.mock("@/modules/pricing/facade", () => ({
  createPricingFacade: () => ({
    replaceAllPricing: (...args: unknown[]) => replaceAllPricingMock(...args),
    getFullPriceTable: (...args: unknown[]) => getFullPriceTableMock(...args),
  }),
}));

import { savePricingAction, type PricingDraftPayload } from "@/app/admin/prices/actions";

const GRADE_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_OK = { ok: true as const, value: { userId: "admin-1" } };

function payload(overrides: Partial<PricingDraftPayload> = {}): PricingDraftPayload {
  return {
    grades: [
      {
        id: GRADE_ID,
        expected_updated_at: "2026-07-01T00:00:00.000000+00:00",
        key: "standard",
        label: "スタンダード",
        description: "",
        sort_order: 0,
        is_active: true,
      },
    ],
    sizes: [{ key: "s", label: "〜120mm", max_mm: 120, quote_only: false, sort_order: 0 }],
    matrix: [{ grade_key: "standard", size_key: "s", price_min: 1000, price_max: 2000 }],
    tiers: [{ min_qty: 10, discount_rate: 0.15, label: "10個以上 -15%" }],
    options: [{ id: null, key: "express", label: "特急", kind: "multiplier", value: 1.5, sort_order: 0, is_active: true }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue(ADMIN_OK);
});

describe("savePricingAction", () => {
  it("requireAdmin 失敗時は facade を呼ばずそのまま返す (revalidate もしない)", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, code: "KMB-E201" });

    const result = await savePricingAction(payload());

    expect(result).toEqual({ ok: false, code: "KMB-E201" });
    expect(replaceAllPricingMock).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("成功時: 5 テーブル分を 1 回の replaceAllPricing に渡し、prices タグと /shop・/admin/prices を失効させる", async () => {
    replaceAllPricingMock.mockResolvedValue({ ok: true, value: undefined });

    const result = await savePricingAction(payload());

    expect(result).toEqual({ ok: true, value: undefined });
    expect(replaceAllPricingMock).toHaveBeenCalledTimes(1);
    expect(replaceAllPricingMock).toHaveBeenCalledWith({
      grades: [
        {
          id: GRADE_ID,
          expected_updated_at: "2026-07-01T00:00:00.000000+00:00",
          key: "standard",
          label: "スタンダード",
          description: "",
          sort_order: 0,
          is_active: true,
        },
      ],
      sizes: [{ key: "s", label: "〜120mm", max_mm: 120, quote_only: false, sort_order: 0 }],
      matrix: [{ grade_key: "standard", size_key: "s", price_min: 1000, price_max: 2000 }],
      tiers: [{ min_qty: 10, discount_rate: 0.15, label: "10個以上 -15%" }],
      options: [
        { id: null, key: "express", label: "特急", kind: "multiplier", value: 1.5, sort_order: 0, is_active: true },
      ],
    });
    expect(revalidateTag).toHaveBeenCalledWith("prices");
    expect(revalidatePath).toHaveBeenCalledWith("/shop");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/prices");
  });

  it("facade が失敗 (E103) しても revalidateTag('prices') / revalidatePath('/shop') を呼ぶ (旧表の焼き付き防止)", async () => {
    replaceAllPricingMock.mockResolvedValue({ ok: false, code: "KMB-E103", detail: "競合" });

    const result = await savePricingAction(payload());

    expect(result).toEqual({ ok: false, code: "KMB-E103", detail: "競合" });
    expect(revalidateTag).toHaveBeenCalledWith("prices");
    expect(revalidatePath).toHaveBeenCalledWith("/shop");
  });

  it("facade が例外を投げても revalidate は実行され、例外はそのまま伝播する", async () => {
    replaceAllPricingMock.mockRejectedValue(new Error("boom"));

    await expect(savePricingAction(payload())).rejects.toThrow("boom");
    expect(revalidateTag).toHaveBeenCalledWith("prices");
    expect(revalidatePath).toHaveBeenCalledWith("/shop");
  });

  it("zod 不正 (グレード key の形式違反) は KMB-E101 で、facade を呼ばない", async () => {
    const result = await savePricingAction(
      payload({ grades: [{ ...payload().grades[0]!, key: "Bad Key" }], matrix: [] }),
    );

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E101" }));
    expect((result as { detail?: string }).detail).toContain("グレード #1");
    expect(replaceAllPricingMock).not.toHaveBeenCalled();
  });

  it("存在しないサイズ帯を参照する行列セルは KMB-E101 (FK 違反の事前検知) で facade を呼ばない", async () => {
    const result = await savePricingAction(
      payload({ matrix: [{ grade_key: "standard", size_key: "xl", price_min: 1, price_max: 2 }] }),
    );

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E101" }));
    expect((result as { detail?: string }).detail).toContain("価格行列");
    expect(replaceAllPricingMock).not.toHaveBeenCalled();
  });
});
