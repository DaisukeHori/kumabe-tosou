import { DEAL_STAGE_REGISTRY, type DealStage } from "@/modules/crm/contracts";

/**
 * 見込み加重金額 (単一案件表示用): floor(amount_jpy × probability / 100)。
 * `crm/internal/digest.ts` の `weightedPipelineJpy` と同じ式だが、そちらは複数案件の SUM 集計
 * (かつ stage∈{paid,lost} を「パイプライン合計」から除外する意味論) 専用であり、internal/** は
 * 他モジュールから import できない (module-contracts.md §2) ため単一案件表示用にここで小さく
 * 再実装する。stage=paid は probability=100 で全額、stage=lost は probability=0 で 0円になり、
 * 除外ロジックが無くても意味的に破綻しない (単一案件の「その案件自身の加重額」を表すだけなので)。
 *
 * 純関数として `DealStageSummary.tsx` (コンポーネント本体、"use client" の DealStageBar 経由で
 * deals/actions.ts まで import チェーンが伸びる) から切り出し、単体テストで軽量に検証できるように
 * している (Issue #96)。
 */
export function dealWeightedAmountJpy(deal: { amount_jpy: number | null; stage: DealStage }): number {
  const probability = DEAL_STAGE_REGISTRY[deal.stage].probability;
  return Math.floor(((deal.amount_jpy ?? 0) * probability) / 100);
}
