import type { EstimateInput, EstimateResult, PriceTable } from "./contracts";

/**
 * 見積り計算の純関数本体 (副作用・IO 一切なし)。
 * shop シミュレータ (クライアントコンポーネント) と admin 価格画面のプレビュー (§5.2) が
 * 直接 import して共用する — どちらも PriceTable を props/state として既に保持しているため、
 * facade 経由 (Supabase 呼び出し) を挟まずに同じ計算結果を得られる。
 *
 * legacy (src/components/site/shop-simulator.tsx 旧実装) の計算式:
 *   discountRate = qty>=30 ? 0.25 : qty>=10 ? 0.15 : 0
 *   factor = (1 - discountRate) * (rush ? 1.5 : 1)
 *   perMin = range[0] * factor; perMax = range[1] * factor
 *   total = Math.round(perMin * qty) 〜 Math.round(perMax * qty)
 * と完全に同じ演算順序 (減算 → 乗算 → 数量倍 → 最後に丸め) で再実装している
 * (浮動小数点演算の順序を変えると legacy と1円単位でズレうるため、順序を厳密に踏襲)。
 */
export function computeEstimate(table: PriceTable, input: EstimateInput): EstimateResult {
  const grade = table.grades.find((g) => g.key === input.grade_key);
  const size = table.size_classes.find((s) => s.key === input.size_key);

  if (!grade || !size) {
    return { quote_only: true, total_min: 0, total_max: 0, applied_tier: null, breakdown: [] };
  }

  if (size.quote_only) {
    return {
      quote_only: true,
      total_min: 0,
      total_max: 0,
      applied_tier: null,
      breakdown: [{ label: size.label, factor: "個別見積もり" }],
    };
  }

  const cell = table.matrix.find(
    (c) => c.grade_key === input.grade_key && c.size_key === input.size_key,
  );
  if (!cell) {
    // グレード×サイズの価格が未設定 (データ不整合)。安全側に倒し個別見積もり扱いとする。
    return { quote_only: true, total_min: 0, total_max: 0, applied_tier: null, breakdown: [] };
  }

  // 数量値引き: min_qty <= quantity の最大 tier を 1 つだけ自動適用 (選択式ではない)。
  const tier =
    [...table.quantity_tiers]
      .filter((t) => t.min_qty <= input.quantity)
      .sort((a, b) => b.min_qty - a.min_qty)[0] ?? null;
  const discountRate = tier?.discount_rate ?? 0;

  const breakdown: EstimateResult["breakdown"] = [
    { label: grade.label, factor: size.label },
  ];

  // legacy と同じ演算順序: (1 - discountRate) を先に計算してから、選択オプションの
  // multiplier を順に掛け合わせる (express 選択時の factor = (1-discountRate)*1.5 と同じ)。
  let multiplier = 1 - discountRate;
  let fixedTotal = 0;

  if (tier) {
    breakdown.push({ label: tier.label, factor: `×${(1 - discountRate).toFixed(2)}` });
  }

  for (const key of input.option_keys) {
    const option = table.options.find((o) => o.key === key && o.is_active);
    if (!option) continue; // 未知/非アクティブな option_key は無視する
    if (option.kind === "multiplier") {
      multiplier *= option.value;
      breakdown.push({ label: option.label, factor: `×${option.value}` });
    } else {
      fixedTotal += option.value;
      breakdown.push({ label: option.label, factor: `+¥${option.value.toLocaleString("ja-JP")}` });
    }
  }

  const perMin = cell.price_min * multiplier + fixedTotal;
  const perMax = cell.price_max * multiplier + fixedTotal;

  return {
    quote_only: false,
    total_min: Math.round(perMin * input.quantity),
    total_max: Math.round(perMax * input.quantity),
    applied_tier: tier?.label ?? null,
    breakdown,
  };
}
