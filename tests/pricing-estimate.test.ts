import { describe, expect, it } from "vitest";

import type { PriceTable } from "@/modules/pricing/contracts";
import { computeEstimate } from "@/modules/pricing/estimate";

import {
  PRICE_GRADES_SEED,
  PRICE_MATRIX_SEED,
  PRICE_OPTIONS_SEED,
  PRICE_QUANTITY_TIERS_SEED,
  PRICE_SIZE_CLASSES_SEED,
} from "../scripts/seed-data/pricing";

/**
 * ゴールデンテスト: legacy (旧 src/components/site/shop-simulator.tsx の
 * ハードコード PRICE_TABLE + useMemo 計算式) の計算結果と、
 * v2 行列モデルの computeEstimate() が完全一致することを検証する。
 *
 * 一致確認方法: legacy の計算式をテスト内に独立した「オラクル」関数として再実装し
 * (legacyOracle)、scripts/seed-data/pricing.ts の正確な行列値 (legacy PRICE_TABLE からの
 * 転記、本番 DB にも投入済み) で構築した PriceTable を使って computeEstimate() の出力と
 * 突き合わせる。演算順序 (減算 → 乗算 → 数量倍 → 最後に Math.round) も legacy と同一に
 * してあるため、浮動小数点誤差込みで 1 円単位の完全一致を期待できる。
 */

function buildPriceTable(): PriceTable {
  const now = new Date().toISOString();
  return {
    grades: PRICE_GRADES_SEED.map((g, i) => ({
      id: `test-grade-${i}`,
      key: g.key,
      label: g.label,
      description: g.description,
      sort_order: g.sort_order,
      is_active: g.is_active,
      updated_at: now,
    })),
    size_classes: PRICE_SIZE_CLASSES_SEED.map((s) => ({
      key: s.key,
      label: s.label,
      max_mm: s.max_mm,
      quote_only: s.quote_only,
      sort_order: s.sort_order,
    })),
    matrix: PRICE_MATRIX_SEED.map((c) => ({
      grade_key: c.grade_key,
      size_key: c.size_key,
      price_min: c.price_min,
      price_max: c.price_max,
    })),
    quantity_tiers: PRICE_QUANTITY_TIERS_SEED.map((t) => ({
      min_qty: t.min_qty,
      discount_rate: t.discount_rate,
      label: t.label,
    })),
    options: PRICE_OPTIONS_SEED.map((o, i) => ({
      id: `test-option-${i}`,
      key: o.key,
      label: o.label,
      kind: o.kind,
      value: o.value,
      sort_order: o.sort_order,
      is_active: o.is_active,
      updated_at: now,
    })),
  };
}

const TABLE = buildPriceTable();

/** legacy (旧実装) の PRICE_TABLE をそのまま再掲した「正解」オラクル */
const LEGACY_PRICE_TABLE: Record<"base" | "standard" | "premium", Record<"s" | "m" | "l", [number, number]>> = {
  base: { s: [7000, 10000], m: [10000, 14000], l: [15000, 20000] },
  standard: { s: [10000, 14000], m: [14000, 20000], l: [20000, 28000] },
  premium: { s: [15000, 20000], m: [20000, 28000], l: [28000, 35000] },
};

function legacyOracle(
  grade: "base" | "standard" | "premium",
  size: "s" | "m" | "l" | "xl",
  qty: number,
  rush: boolean,
): { quoteOnly: true } | { quoteOnly: false; totalMin: number; totalMax: number } {
  if (size === "xl") {
    return { quoteOnly: true };
  }
  const discountRate = qty >= 30 ? 0.25 : qty >= 10 ? 0.15 : 0;
  const range = LEGACY_PRICE_TABLE[grade][size];
  const factor = (1 - discountRate) * (rush ? 1.5 : 1);
  const perMin = range[0] * factor;
  const perMax = range[1] * factor;
  return {
    quoteOnly: false,
    totalMin: Math.round(perMin * qty),
    totalMax: Math.round(perMax * qty),
  };
}

type Case = {
  name: string;
  grade: "base" | "standard" | "premium";
  size: "s" | "m" | "l" | "xl";
  qty: number;
  rush: boolean;
};

const CASES: Case[] = [
  // 全グレード × 全サイズ (s/m/l)、qty=1・オプションなし
  { name: "base/s qty=1", grade: "base", size: "s", qty: 1, rush: false },
  { name: "base/m qty=1", grade: "base", size: "m", qty: 1, rush: false },
  { name: "base/l qty=1", grade: "base", size: "l", qty: 1, rush: false },
  { name: "standard/s qty=1", grade: "standard", size: "s", qty: 1, rush: false },
  { name: "standard/m qty=1", grade: "standard", size: "m", qty: 1, rush: false },
  { name: "standard/l qty=1", grade: "standard", size: "l", qty: 1, rush: false },
  { name: "premium/s qty=1", grade: "premium", size: "s", qty: 1, rush: false },
  { name: "premium/m qty=1", grade: "premium", size: "m", qty: 1, rush: false },
  { name: "premium/l qty=1", grade: "premium", size: "l", qty: 1, rush: false },
  // 数量境界 9/10/29/30 (standard/m 固定)
  { name: "standard/m qty=9 (境界: 割引なし側)", grade: "standard", size: "m", qty: 9, rush: false },
  { name: "standard/m qty=10 (境界: -15%開始)", grade: "standard", size: "m", qty: 10, rush: false },
  { name: "standard/m qty=29 (境界: -15%継続)", grade: "standard", size: "m", qty: 29, rush: false },
  { name: "standard/m qty=30 (境界: -25%開始)", grade: "standard", size: "m", qty: 30, rush: false },
  // 特急 (express) 併用
  { name: "standard/m qty=10 + express", grade: "standard", size: "m", qty: 10, rush: true },
  { name: "premium/l qty=1 + express", grade: "premium", size: "l", qty: 1, rush: true },
  { name: "base/s qty=30 + express", grade: "base", size: "s", qty: 30, rush: true },
  // xl (個別見積もり)
  { name: "base/xl qty=1", grade: "base", size: "xl", qty: 1, rush: false },
  { name: "standard/xl qty=5", grade: "standard", size: "xl", qty: 5, rush: false },
  { name: "premium/xl qty=50 + express", grade: "premium", size: "xl", qty: 50, rush: true },
];

describe(`pricing/estimate computeEstimate() ↔ legacy 完全一致 (${CASES.length} ケース)`, () => {
  for (const c of CASES) {
    it(c.name, () => {
      const oracle = legacyOracle(c.grade, c.size, c.qty, c.rush);
      const actual = computeEstimate(TABLE, {
        grade_key: c.grade,
        size_key: c.size,
        quantity: c.qty,
        option_keys: c.rush ? ["express"] : [],
      });

      if (oracle.quoteOnly) {
        expect(actual.quote_only).toBe(true);
        expect(actual.total_min).toBe(0);
        expect(actual.total_max).toBe(0);
        expect(actual.applied_tier).toBeNull();
      } else {
        expect(actual.quote_only).toBe(false);
        expect(actual.total_min).toBe(oracle.totalMin);
        expect(actual.total_max).toBe(oracle.totalMax);
      }
    });
  }

  it("数量値引きの自動適用ラベル: qty=9 は適用なし", () => {
    const r = computeEstimate(TABLE, {
      grade_key: "standard",
      size_key: "m",
      quantity: 9,
      option_keys: [],
    });
    expect(r.applied_tier).toBeNull();
  });

  it("数量値引きの自動適用ラベル: qty=10 は '10個以上 -15%'", () => {
    const r = computeEstimate(TABLE, {
      grade_key: "standard",
      size_key: "m",
      quantity: 10,
      option_keys: [],
    });
    expect(r.applied_tier).toBe("10個以上 -15%");
  });

  it("数量値引きの自動適用ラベル: qty=30 は '30個以上 -25%' (10個以上ではなく最大の tier が1つだけ適用)", () => {
    const r = computeEstimate(TABLE, {
      grade_key: "standard",
      size_key: "m",
      quantity: 30,
      option_keys: [],
    });
    expect(r.applied_tier).toBe("30個以上 -25%");
  });

  it("未知の option_key は無視される (エラーにならない)", () => {
    const r = computeEstimate(TABLE, {
      grade_key: "standard",
      size_key: "m",
      quantity: 1,
      option_keys: ["nonexistent"],
    });
    expect(r.quote_only).toBe(false);
    expect(r.total_min).toBe(14000);
    expect(r.total_max).toBe(20000);
  });

  it("存在しない grade_key/size_key は個別見積もり扱いにフォールバックする (データ不整合時の安全側デフォルト)", () => {
    const r = computeEstimate(TABLE, {
      grade_key: "nonexistent",
      size_key: "m",
      quantity: 1,
      option_keys: [],
    });
    expect(r.quote_only).toBe(true);
    expect(r.total_min).toBe(0);
    expect(r.total_max).toBe(0);
  });
});
