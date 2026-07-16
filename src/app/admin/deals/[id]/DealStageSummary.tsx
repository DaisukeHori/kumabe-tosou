import { Surface } from "@/app/admin/_ui";
import { cn } from "@/lib/utils";
import { DEAL_STAGE_REGISTRY, type DealDetail } from "@/modules/crm/contracts";

import { dealWeightedAmountJpy } from "./deal-weighted-amount";
import { DealStageBar } from "./DealStageBar";

const jpy = new Intl.NumberFormat("ja-JP");

/** JST の「今日」(YYYY-MM-DD)。deals-kanban.tsx の jstTodayDateOnly と同じ +9h シフト方式
 *  (crm/internal/jst.ts は UI から import 不可 — MODULES 境界)。 */
function jstTodayDateOnly(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * 案件詳細ページのステージ+KPIストリップ (Issue #96 設計 §B)。全幅 Surface 内に
 * (1) 既存 DealStageBar、(2) 統計行 (金額/見込み%+加重金額/見込み完了日)、(3) 失注理由バナー
 * (DealOverviewCard.tsx から移設) を表示する。
 *
 * 【設計の内的矛盾の解消】Issue 本文 §B の (2) 統計行の列挙には「流入元」も含まれているが、
 * 直後の「情報の一意配置」の一文 (顧客・会社・流入元・メモ→基本情報カード) と受入基準
 * (ステージバー・金額・見込み%・見込み完了日・失注理由バナーのみを列挙し流入元は含まない) は
 * 流入元をここに置かないことを要求している。両立しない記述のため、より具体的で拘束力の強い
 * 受入基準+「重複表示を排除」の明文を優先し、流入元は DealOverviewCard 側のみに残す
 * (実装時の判断 — 相違点として報告)。
 */
export function DealStageSummary({ deal }: { deal: DealDetail }) {
  const probability = DEAL_STAGE_REGISTRY[deal.stage].probability;
  const weightedJpy = dealWeightedAmountJpy(deal);
  const isOverdue =
    deal.expected_close_on !== null &&
    deal.expected_close_on < jstTodayDateOnly() &&
    !DEAL_STAGE_REGISTRY[deal.stage].isWon &&
    deal.stage !== "lost";

  return (
    <Surface className="flex flex-col gap-3 p-4">
      <DealStageBar deal={deal} />

      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div>
          <dt className="text-meta text-admin-text-meta">金額</dt>
          <dd className="font-medium">{deal.amount_jpy !== null ? `¥${jpy.format(deal.amount_jpy)}` : "—"}</dd>
        </div>
        <div>
          <dt className="text-meta text-admin-text-meta">見込み</dt>
          <dd className="font-medium">
            {probability}%
            {deal.amount_jpy !== null && (
              <span className="ml-1.5 font-normal text-muted-foreground">(¥{jpy.format(weightedJpy)})</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-meta text-admin-text-meta">見込み完了日</dt>
          <dd className={cn("font-medium", isOverdue && "text-destructive")}>
            {deal.expected_close_on ?? "—"}
            {isOverdue && " (超過)"}
          </dd>
        </div>
      </dl>

      {deal.stage === "lost" && deal.lost_reason && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          失注理由: {deal.lost_reason}
        </p>
      )}
    </Surface>
  );
}
