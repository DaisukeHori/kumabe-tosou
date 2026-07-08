import {
  zPriceGradeInput,
  zPriceMatrixCellInput,
  zPriceOptionInput,
  zPriceSizeClassInput,
  zQuantityTierInput,
  type PriceGradeInput,
  type PriceMatrixCellInput,
  type PriceOptionInput,
  type PriceSizeClassInput,
  type QuantityTierInput,
} from "@/modules/pricing/contracts";

/**
 * src/components/site/shop-simulator.tsx の PRICE_TABLE / GRADE_OPTIONS / SIZE_OPTIONS /
 * discountRate / rush(+50%) から一字一句転記 (v2 行列モデル、migration 20260708000007 と 1:1)。
 *
 * ============================================================================
 * 訂正メモ (2026-07-08 — オーケストレーターへ報告済み)
 * ============================================================================
 * Wave 0 時点の本ファイルは「単一 base_price モデル」向けの近似値
 * (各グレードの M サイズ下限のみを base_price に採用し、S/L は 3 グレード平均の
 * 比率で multiplier option 化) だった。しかし同日中の migration 0007 で
 * price_grades.base_price 列は廃止され、price_size_classes / price_matrix /
 * price_quantity_tiers による行列モデルに置き換わっている (module-contracts.md §4.8
 * v2 改訂と1:1)。本ファイルと scripts/seed-from-legacy.ts はそれに追従していなかった
 * ため、seed 実行時に「price_grades.base_price 列が存在しない」で INSERT が失敗した。
 * 本改訂では近似をやめ、legacy の実データ (shop-simulator.tsx PRICE_TABLE、
 * discountRate、rush 倍率) を行列モデルへそのまま 1:1 転記する。
 * - price_matrix: グレード×サイズ(s/m/l) の [price_min, price_max] を PRICE_TABLE から転記。
 *   xl (350mm超) は quote_only のため matrix を持たない (意図的に対象外)。
 * - price_quantity_tiers: discountRate = qty>=30?0.25:qty>=10?0.15:0 を転記。
 * - price_options: rush チェック時の ×1.5 (+50%) を 'express' として 1 件のみ転記
 *   (size 系オプションは price_matrix に統合されたため廃止)。
 * ============================================================================
 */
const RAW_GRADES: {
  key: string;
  label: string;
  description: string;
  sortOrder: number;
}[] = [
  { key: "base", label: "下地仕上げ", description: "PRIMER-READY", sortOrder: 0 },
  { key: "standard", label: "スタンダード", description: "SOLID + 2K CLEAR", sortOrder: 1 },
  { key: "premium", label: "プレミアム", description: "3-COAT PEARL", sortOrder: 2 },
];

const RAW_SIZE_CLASSES: {
  key: string;
  label: string;
  maxMm: number | null;
  quoteOnly: boolean;
  sortOrder: number;
}[] = [
  { key: "s", label: "〜100mm", maxMm: 100, quoteOnly: false, sortOrder: 0 },
  { key: "m", label: "〜200mm", maxMm: 200, quoteOnly: false, sortOrder: 1 },
  { key: "l", label: "〜350mm", maxMm: 350, quoteOnly: false, sortOrder: 2 },
  { key: "xl", label: "それ以上（個別見積もり）", maxMm: null, quoteOnly: true, sortOrder: 3 },
];

// legacy PRICE_TABLE: grade -> size(s/m/l) -> [price_min, price_max]。xl は個別見積もりのため対象外 (9 セル)。
const RAW_MATRIX: { gradeKey: string; sizeKey: string; priceMin: number; priceMax: number }[] = [
  { gradeKey: "base", sizeKey: "s", priceMin: 7000, priceMax: 10000 },
  { gradeKey: "base", sizeKey: "m", priceMin: 10000, priceMax: 14000 },
  { gradeKey: "base", sizeKey: "l", priceMin: 15000, priceMax: 20000 },
  { gradeKey: "standard", sizeKey: "s", priceMin: 10000, priceMax: 14000 },
  { gradeKey: "standard", sizeKey: "m", priceMin: 14000, priceMax: 20000 },
  { gradeKey: "standard", sizeKey: "l", priceMin: 20000, priceMax: 28000 },
  { gradeKey: "premium", sizeKey: "s", priceMin: 15000, priceMax: 20000 },
  { gradeKey: "premium", sizeKey: "m", priceMin: 20000, priceMax: 28000 },
  { gradeKey: "premium", sizeKey: "l", priceMin: 28000, priceMax: 35000 },
];

// legacy: qty>=30 は -25%、qty>=10 は -15% (discountRate = qty>=30?0.25:qty>=10?0.15:0)
const RAW_QUANTITY_TIERS: { minQty: number; discountRate: number; label: string }[] = [
  { minQty: 10, discountRate: 0.15, label: "10個以上 -15%" },
  { minQty: 30, discountRate: 0.25, label: "30個以上 -25%" },
];

// legacy: rush チェックで ×1.5 (+50%)
const RAW_OPTIONS: {
  key: string;
  label: string;
  kind: "multiplier" | "fixed";
  value: number;
  sortOrder: number;
}[] = [{ key: "express", label: "特急仕上げ", kind: "multiplier", value: 1.5, sortOrder: 0 }];

export const PRICE_GRADES_SEED: PriceGradeInput[] = RAW_GRADES.map((g) =>
  zPriceGradeInput.parse({
    key: g.key,
    label: g.label,
    description: g.description,
    sort_order: g.sortOrder,
    is_active: true,
  } satisfies PriceGradeInput),
);

export const PRICE_SIZE_CLASSES_SEED: PriceSizeClassInput[] = RAW_SIZE_CLASSES.map((s) =>
  zPriceSizeClassInput.parse({
    key: s.key,
    label: s.label,
    max_mm: s.maxMm,
    quote_only: s.quoteOnly,
    sort_order: s.sortOrder,
  } satisfies PriceSizeClassInput),
);

export const PRICE_MATRIX_SEED: PriceMatrixCellInput[] = RAW_MATRIX.map((m) =>
  zPriceMatrixCellInput.parse({
    grade_key: m.gradeKey,
    size_key: m.sizeKey,
    price_min: m.priceMin,
    price_max: m.priceMax,
  } satisfies PriceMatrixCellInput),
);

export const PRICE_QUANTITY_TIERS_SEED: QuantityTierInput[] = RAW_QUANTITY_TIERS.map((t) =>
  zQuantityTierInput.parse({
    min_qty: t.minQty,
    discount_rate: t.discountRate,
    label: t.label,
  } satisfies QuantityTierInput),
);

export const PRICE_OPTIONS_SEED: PriceOptionInput[] = RAW_OPTIONS.map((o) =>
  zPriceOptionInput.parse({
    key: o.key,
    label: o.label,
    kind: o.kind,
    value: o.value,
    sort_order: o.sortOrder,
    is_active: true,
  } satisfies PriceOptionInput),
);
