import { DEAL_STAGE_REGISTRY, type DealStage } from "../contracts";
import type { CrmDigest } from "../contracts";

/**
 * 日次ダイジェスト・ダッシュボード KPI の純計算部 (01-crm.md §7.2・§8.6)。DB 非依存 — 単体テスト対象。
 */

/** 全リスト空なら true (送信スキップ判定 — §7.2 手順 b。sales フィールドは判定対象に含めない: v1 は null 固定のため) */
export function isDigestEmpty(
  digest: Pick<CrmDigest, "overdue_tasks" | "today_tasks" | "awaiting_leads">,
): boolean {
  return (
    digest.overdue_tasks.length === 0 &&
    digest.today_tasks.length === 0 &&
    digest.awaiting_leads.length === 0
  );
}

/**
 * 加重パイプライン合計 (§8.6): Σ floor(amount_jpy × probability / 100)、stage ∉ {paid, lost}。
 * amount_jpy が NULL の行は 0 円扱い。probability/label は DEAL_STAGE_REGISTRY が唯一の正
 * (クライアント集計禁止規約 — SQL 集計後の掛け算のみコード側)。
 */
export function weightedPipelineJpy(
  deals: ReadonlyArray<{ amount_jpy: number | null; stage: DealStage }>,
): number {
  let total = 0;
  for (const deal of deals) {
    if (deal.stage === "paid" || deal.stage === "lost") continue;
    const amount = deal.amount_jpy ?? 0;
    const probability = DEAL_STAGE_REGISTRY[deal.stage].probability;
    total += Math.floor((amount * probability) / 100);
  }
  return total;
}
