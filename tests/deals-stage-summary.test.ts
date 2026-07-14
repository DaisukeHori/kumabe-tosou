import { describe, expect, it } from "vitest";

import { dealWeightedAmountJpy } from "@/app/admin/deals/[id]/deal-weighted-amount";

/**
 * Issue #96 §B: 案件詳細ページのステージ+KPIストリップが表示する「見込み%+加重金額」の
 * 純計算部。crm/internal/digest.ts の weightedPipelineJpy (Σ floor(amount×probability/100)、
 * stage∈{paid,lost}除外) と同じ式の単一案件版だが、こちらは除外ロジックを持たない
 * (paid=100%で全額、lost=0%で0円になり、除外が無くても意味的に破綻しないため)。
 */
describe("dealWeightedAmountJpy", () => {
  it("inquiry (probability 10%) は floor(amount × 0.10)", () => {
    expect(dealWeightedAmountJpy({ amount_jpy: 100_000, stage: "inquiry" })).toBe(10_000);
  });

  it("ordered (probability 100%) は全額", () => {
    expect(dealWeightedAmountJpy({ amount_jpy: 250_000, stage: "ordered" })).toBe(250_000);
  });

  it("paid (probability 100%) も全額 (パイプライン集計の除外ロジックは単一案件表示には適用しない)", () => {
    expect(dealWeightedAmountJpy({ amount_jpy: 250_000, stage: "paid" })).toBe(250_000);
  });

  it("lost (probability 0%) は 0 円", () => {
    expect(dealWeightedAmountJpy({ amount_jpy: 999_999, stage: "lost" })).toBe(0);
  });

  it("amount_jpy が null なら 0 円扱い", () => {
    expect(dealWeightedAmountJpy({ amount_jpy: null, stage: "ordered" })).toBe(0);
  });

  it("端数は floor する (切り捨て)", () => {
    // estimating: probability 30% → 100 × 0.3 = 30.0 (割り切れる例)。切り捨てが効くケースを明示するため
    // 端数が出る金額を使う: 333 × 30 / 100 = 99.9 → floor で 99
    expect(dealWeightedAmountJpy({ amount_jpy: 333, stage: "estimating" })).toBe(99);
  });
});
