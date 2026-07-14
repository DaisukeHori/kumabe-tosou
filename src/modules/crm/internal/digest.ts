import { DEAL_STAGE_REGISTRY, type DealStage } from "../contracts";
import type { CrmDigest } from "../contracts";

/**
 * 日次ダイジェスト・ダッシュボード KPI の純計算部 (01-crm.md §7.2・§8.6)。DB 非依存 — 単体テスト対象。
 */

/**
 * 全リスト空なら true (送信スキップ判定 — §7.2 手順 b)。
 * #51 で sales 配線が有効化されたため、sales フィールドも判定対象に含める (地雷回避:
 * 「crm タスクは 0 件だが sales の未消込請求は 5 件ある」朝にダイジェストメールがスキップされる
 * 静かな機能不全を防ぐ — 実装計画書 issue-51.md「crm-digest配線」節)。
 * `sales` は optional にして既存呼び出し (tests/crm-kpi.test.ts が sales を渡さない) との
 * 後方互換を保つ — 未指定時は「sales 分は空」として扱う (isDigestEmpty の判定に影響しない)。
 */
export function isDigestEmpty(
  digest: Pick<CrmDigest, "overdue_tasks" | "today_tasks" | "awaiting_leads"> & { sales?: CrmDigest["sales"] },
): boolean {
  const salesEmpty =
    !digest.sales || (digest.sales.expiring_quotes.length === 0 && digest.sales.unpaid_invoices.length === 0);
  return (
    digest.overdue_tasks.length === 0 &&
    digest.today_tasks.length === 0 &&
    digest.awaiting_leads.length === 0 &&
    salesEmpty
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
