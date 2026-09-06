import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * pricing の一括保存経路 (repository.replacePricingAll → pricing_replace_all RPC、
 * facade.replaceAllPricing のエラーコード変換)。migration 20260906000010 の
 * `raise exception 'KMB-Exxx: ...'` 規約と 1:1 に対応することを DB 非依存で検証する。
 */

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ rpc: (...args: unknown[]) => rpcMock(...args) }),
}));
vi.mock("@/lib/supabase/public", () => ({
  createSupabasePublicClient: () => ({}),
}));

import { createPricingFacade } from "@/modules/pricing/facade";
import type { PricingReplaceInput } from "@/modules/pricing/contracts";
import { PricingRpcError, replacePricingAll } from "@/modules/pricing/repository";

const GRADE_ID = "11111111-1111-4111-8111-111111111111";

function input(overrides: Partial<PricingReplaceInput> = {}): PricingReplaceInput {
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
    tiers: [],
    options: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("replacePricingAll (repository)", () => {
  it("pricing_replace_all RPC を p_payload 1 引数で 1 回だけ呼ぶ", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    await replacePricingAll(input());

    expect(rpcMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).toHaveBeenCalledWith("pricing_replace_all", { p_payload: input() });
  });

  it("RPC が 'KMB-E103: ...' を返したら PricingRpcError(KMB-E103)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "KMB-E103: グレード (standard) が他の変更と競合しました" } });

    await expect(replacePricingAll(input())).rejects.toMatchObject({ code: "KMB-E103" });
    await expect(replacePricingAll(input())).rejects.toBeInstanceOf(PricingRpcError);
  });

  it("RPC が 'KMB-E101: ...' を返したら PricingRpcError(KMB-E101)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "KMB-E101: オプション (x) の更新対象が見つかりません" } });

    await expect(replacePricingAll(input())).rejects.toMatchObject({ code: "KMB-E101" });
  });

  it("permission denied (非 admin) は PricingRpcError(KMB-E202)", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "permission denied: pricing_replace_all requires admin" },
    });

    await expect(replacePricingAll(input())).rejects.toMatchObject({ code: "KMB-E202" });
  });

  it("その他の DB エラーは通常の Error (握り潰さずメッセージを含める)", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "23503", message: "fk violation" } });

    await expect(replacePricingAll(input())).rejects.toThrow(/fk violation/);
  });
});

describe("createPricingFacade().replaceAllPricing", () => {
  it("成功時は ok:true", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    const result = await createPricingFacade().replaceAllPricing(input());

    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("zod 不正 (行列が存在しないグレードを参照) は RPC を呼ばず KMB-E101", async () => {
    const result = await createPricingFacade().replaceAllPricing(
      input({ matrix: [{ grade_key: "ghost", size_key: "s", price_min: 1, price_max: 2 }] }),
    );

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E101" }));
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("PricingRpcError(KMB-E103) は Result の KMB-E103 に変換される", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "KMB-E103: 競合" } });

    const result = await createPricingFacade().replaceAllPricing(input());

    expect(result).toEqual({ ok: false, code: "KMB-E103", detail: "KMB-E103: 競合" });
  });

  it("想定外の例外は KMB-E901", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "connection reset" } });

    const result = await createPricingFacade().replaceAllPricing(input());

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E901" }));
    expect((result as { detail?: string }).detail).toContain("connection reset");
  });
});
