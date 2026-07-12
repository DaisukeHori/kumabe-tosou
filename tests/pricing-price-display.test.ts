import { describe, expect, it } from "vitest";

import type { PriceGrade, PriceMatrixCell, PriceSizeClass, PriceTable } from "@/modules/pricing/contracts";
import { formatGradeCardPrice } from "@/modules/pricing/price-display";

import {
  PRICE_GRADES_SEED,
  PRICE_MATRIX_SEED,
  PRICE_SIZE_CLASSES_SEED,
} from "../scripts/seed-data/pricing";

/**
 * canonical: docs/design/crm-suite/06-simulator.md §4.5 (formatGradeCardPrice 全文) / §7.2 (SEC.01 差込)。
 * 計画書 issue-60.md「テスト戦略」節: 全分岐 (seed値一致 / null系4種 / min選択 / 桁区切り) を検証する。
 * formatGradeCardPrice は副作用・IO なしの純関数のため、テストごとに PriceTable フィクスチャを
 * 直接組み立てる (facade/DB を経由しない)。
 */

const now = new Date().toISOString();

function grade(overrides: Partial<PriceGrade> & { key: string }): PriceGrade {
  return {
    id: `grade-${overrides.key}`,
    key: overrides.key,
    label: overrides.label ?? overrides.key,
    description: overrides.description ?? "",
    sort_order: overrides.sort_order ?? 0,
    is_active: overrides.is_active ?? true,
    updated_at: overrides.updated_at ?? now,
  };
}

function sizeClass(overrides: Partial<PriceSizeClass> & { key: string }): PriceSizeClass {
  return {
    key: overrides.key,
    label: overrides.label ?? overrides.key,
    max_mm: overrides.max_mm ?? 100,
    quote_only: overrides.quote_only ?? false,
    sort_order: overrides.sort_order ?? 0,
  };
}

function cell(overrides: PriceMatrixCell): PriceMatrixCell {
  return overrides;
}

function table(overrides: Partial<PriceTable>): PriceTable {
  return {
    grades: [],
    size_classes: [],
    matrix: [],
    quantity_tiers: [],
    options: [],
    ...overrides,
  };
}

/** scripts/seed-data/pricing.ts (legacy PRICE_TABLE 転記済み) から実データ PriceTable を組む */
function buildSeedPriceTable(): PriceTable {
  return {
    grades: PRICE_GRADES_SEED.map((g, i) => ({
      id: `seed-grade-${i}`,
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
    quantity_tiers: [],
    options: [],
  };
}

describe("formatGradeCardPrice — seed 値一致 (SEC.01 カードの表示値)", () => {
  const seedTable = buildSeedPriceTable();

  it("base → ¥7,000〜 (s セルの price_min が最小)", () => {
    expect(formatGradeCardPrice(seedTable, "base")).toBe("¥7,000〜");
  });

  it("standard → ¥10,000〜", () => {
    expect(formatGradeCardPrice(seedTable, "standard")).toBe("¥10,000〜");
  });

  it("premium → ¥15,000〜", () => {
    expect(formatGradeCardPrice(seedTable, "premium")).toBe("¥15,000〜");
  });
});

describe("formatGradeCardPrice — null 系分岐", () => {
  it("table が null なら null", () => {
    expect(formatGradeCardPrice(null, "base")).toBeNull();
  });

  it("グレードが存在しなければ null", () => {
    const t = table({
      grades: [grade({ key: "base" })],
      size_classes: [sizeClass({ key: "s" })],
      matrix: [cell({ grade_key: "base", size_key: "s", price_min: 7000, price_max: 10000 })],
    });
    expect(formatGradeCardPrice(t, "nonexistent")).toBeNull();
  });

  it("グレードが is_active=false なら null (非アクティブは対象外)", () => {
    const t = table({
      grades: [grade({ key: "base", is_active: false })],
      size_classes: [sizeClass({ key: "s" })],
      matrix: [cell({ grade_key: "base", size_key: "s", price_min: 7000, price_max: 10000 })],
    });
    expect(formatGradeCardPrice(t, "base")).toBeNull();
  });

  it("対象グレードの matrix セルが 0 件なら null (行列未設定)", () => {
    const t = table({
      grades: [grade({ key: "base" })],
      size_classes: [sizeClass({ key: "s" })],
      matrix: [], // base に対応するセルなし
    });
    expect(formatGradeCardPrice(t, "base")).toBeNull();
  });

  it("全サイズ帯が quote_only=true なら null (sellable セルなし)", () => {
    const t = table({
      grades: [grade({ key: "base" })],
      size_classes: [sizeClass({ key: "xl", quote_only: true })],
      // xl は quote_only のため sellableSizeKeys に含まれず、セルがあっても対象外になる
      matrix: [cell({ grade_key: "base", size_key: "xl", price_min: 7000, price_max: 10000 })],
    });
    expect(formatGradeCardPrice(t, "base")).toBeNull();
  });
});

describe("formatGradeCardPrice — 複数セルからの min 選択", () => {
  it("同一グレードの複数 sellable セルのうち price_min が最小のものを採用する", () => {
    const t = table({
      grades: [grade({ key: "standard" })],
      size_classes: [
        sizeClass({ key: "s", quote_only: false }),
        sizeClass({ key: "m", quote_only: false }),
        sizeClass({ key: "l", quote_only: false }),
      ],
      matrix: [
        cell({ grade_key: "standard", size_key: "s", price_min: 10000, price_max: 14000 }),
        cell({ grade_key: "standard", size_key: "m", price_min: 8000, price_max: 20000 }), // 最小
        cell({ grade_key: "standard", size_key: "l", price_min: 20000, price_max: 28000 }),
      ],
    });
    expect(formatGradeCardPrice(t, "standard")).toBe("¥8,000〜");
  });

  it("quote_only なサイズ帯のセルは min 選択の対象から除外される", () => {
    const t = table({
      grades: [grade({ key: "standard" })],
      size_classes: [
        sizeClass({ key: "s", quote_only: false }),
        sizeClass({ key: "xl", quote_only: true }),
      ],
      matrix: [
        // xl のセルは異常に安い値だが quote_only のため無視され、s の 10000 が採用される
        cell({ grade_key: "standard", size_key: "xl", price_min: 100, price_max: 200 }),
        cell({ grade_key: "standard", size_key: "s", price_min: 10000, price_max: 14000 }),
      ],
    });
    expect(formatGradeCardPrice(t, "standard")).toBe("¥10,000〜");
  });

  it("他グレードのセルは混ざらない (grade_key でフィルタされる)", () => {
    const t = table({
      grades: [grade({ key: "base" }), grade({ key: "premium" })],
      size_classes: [sizeClass({ key: "s", quote_only: false })],
      matrix: [
        cell({ grade_key: "premium", size_key: "s", price_min: 100, price_max: 200 }),
        cell({ grade_key: "base", size_key: "s", price_min: 7000, price_max: 10000 }),
      ],
    });
    expect(formatGradeCardPrice(t, "base")).toBe("¥7,000〜");
  });
});

describe("formatGradeCardPrice — 桁区切り表記", () => {
  it("4桁以上はカンマ区切り (toLocaleString('ja-JP'))", () => {
    const t = table({
      grades: [grade({ key: "premium" })],
      size_classes: [sizeClass({ key: "l", quote_only: false })],
      matrix: [cell({ grade_key: "premium", size_key: "l", price_min: 1234567, price_max: 2000000 })],
    });
    expect(formatGradeCardPrice(t, "premium")).toBe("¥1,234,567〜");
  });

  it("3桁以下はカンマなし", () => {
    const t = table({
      grades: [grade({ key: "base" })],
      size_classes: [sizeClass({ key: "s", quote_only: false })],
      matrix: [cell({ grade_key: "base", size_key: "s", price_min: 500, price_max: 900 })],
    });
    expect(formatGradeCardPrice(t, "base")).toBe("¥500〜");
  });
});
