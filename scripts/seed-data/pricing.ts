import {
  zPriceGradeInput,
  zPriceOptionInput,
  type PriceGradeInput,
  type PriceOptionInput,
} from "@/modules/pricing/contracts";

/**
 * src/components/site/shop-simulator.tsx の PRICE_TABLE / GRADE_OPTIONS / SIZE_OPTIONS から転記。
 *
 * ============================================================================
 * 契約との乖離メモ (重要 — オーケストレーターへ報告済み事項)
 * ============================================================================
 * legacy の PRICE_TABLE は「グレード × サイズ」の 3x3 行列で、各セルが [下限, 上限] の
 * 価格レンジを持ち、さらに個数による自動値引き (10個以上-15%, 30個以上-25%) と
 * 特急倍率 (+50%) を掛け合わせる構造だった。
 * 対して module-contracts.md §4.8 の price_grades/price_options モデルは
 * 「グレードごとに単一の base_price (レンジ不可)」+「multiplier|fixed の任意選択オプション」
 * という単純な形で、(a) サイズ別の非線形な価格差、(b) 個数に応じて自動適用される値引き、
 * (c) 上限値を持つレンジ表示、のいずれも直接表現できない。
 *
 * 本 seed では以下の近似で移行する (正式な計算式は Wave 1 の pricing facade 実装で再設計):
 * - base_price: 各グレードの M サイズ (〜200mm、"主戦場サイズ") の下限値をそのまま採用。
 * - size_s / size_l: 3 グレード平均の M比 (S/M ≈ 0.71, L/M ≈ 1.4) を multiplier option 化。
 *   本来はグレードごとに比率が微妙に異なる (0.706〜0.729 / 1.31〜1.46)が、平均比率での
 *   近似とした (グレード別の option は現行モデルでは表現できないため)。
 * - qty_tier_10 / qty_tier_30: 元は個数に応じて自動適用される値引きだったが、新モデルには
 *   自動適用の概念がないため、選択式 option として seed する。実際の自動選択ロジックは
 *   pricing facade の estimate() 実装時に UI 側で数量から option_keys を導出する形で
 *   再設計する必要がある。
 * - xl (350mm超) は「個別見積もり」のため固定価格を持たず、price_grades/price_options
 *   のどちらにも該当しない。意図的に seed から除外する。
 * ============================================================================
 */
const RAW_GRADES: {
  key: string;
  label: string;
  basePrice: number;
  description: string;
  sortOrder: number;
}[] = [
  {
    key: "base",
    label: "下地仕上げ",
    basePrice: 10000, // legacy: base.m = [10000, 14000] の下限
    description: "PRIMER-READY",
    sortOrder: 0,
  },
  {
    key: "standard",
    label: "スタンダード",
    basePrice: 14000, // legacy: standard.m = [14000, 20000] の下限
    description: "SOLID + 2K CLEAR",
    sortOrder: 1,
  },
  {
    key: "premium",
    label: "プレミアム",
    basePrice: 20000, // legacy: premium.m = [20000, 28000] の下限
    description: "3-COAT PEARL",
    sortOrder: 2,
  },
];

const RAW_OPTIONS: {
  key: string;
  label: string;
  kind: "multiplier" | "fixed";
  value: number;
  sortOrder: number;
}[] = [
  { key: "size_s", label: "〜100mm", kind: "multiplier", value: 0.7, sortOrder: 0 },
  { key: "size_l", label: "〜350mm", kind: "multiplier", value: 1.4, sortOrder: 1 },
  { key: "qty_tier_10", label: "10個以上", kind: "multiplier", value: 0.85, sortOrder: 2 },
  { key: "qty_tier_30", label: "30個以上", kind: "multiplier", value: 0.75, sortOrder: 3 },
  { key: "rush", label: "特急仕上げ", kind: "multiplier", value: 1.5, sortOrder: 4 },
];

export const PRICE_GRADES_SEED: PriceGradeInput[] = RAW_GRADES.map((g) =>
  zPriceGradeInput.parse({
    key: g.key,
    label: g.label,
    base_price: g.basePrice,
    description: g.description,
    sort_order: g.sortOrder,
    is_active: true,
  } satisfies PriceGradeInput),
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
