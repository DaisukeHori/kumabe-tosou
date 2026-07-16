"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { DEAL_STAGE_REGISTRY, zDealStage, type DealDetail, type DealStage } from "@/modules/crm/contracts";

import { updateDealStageAction } from "../actions";

const BAR_STAGES: DealStage[] = zDealStage.options;

/**
 * 案件詳細ページのステージバー (01-crm.md §8.3): 9 ステージ横並び、クリックで
 * updateDealStageAction。終端 (paid/lost) からは遷移不可 — クリックしても Server Action の
 * Result で判定し toast のみ (9×9 マトリクスの細かいガードは再現せず facade の Result に委ねる、
 * 計画書の推奨どおり)。
 */
export function DealStageBar({ deal }: { deal: DealDetail }) {
  const router = useRouter();
  const [current, setCurrent] = useState(deal);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => setCurrent(deal), [deal]);
  const currentIndex = BAR_STAGES.indexOf(current.stage);
  const isTerminal = DEAL_STAGE_REGISTRY[current.stage].isLost || current.stage === "paid";

  async function handleClick(stage: DealStage) {
    if (stage === current.stage || isTerminal || stage === "lost") return;
    setIsPending(true);
    const result = await updateDealStageAction(current.id, stage, current.updated_at);
    setIsPending(false);
    if (!result.ok) {
      if (result.code === "KMB-E602") {
        toast.error("この状態からは変更できません。失注は「失注にする」から行ってください。");
      } else if (result.code === "KMB-E103") {
        toast.error("他の操作でこの案件が更新されています。再読み込みしてください。");
      } else {
        toast.error(result.detail ?? "ステージ変更に失敗しました。");
      }
      return;
    }
    toast.success(`ステージを「${DEAL_STAGE_REGISTRY[stage].label}」にしました。`);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {BAR_STAGES.filter((s) => s !== "lost").map((stage, idx) => {
          const isCurrent = stage === current.stage;
          const isPast = idx < currentIndex;
          return (
            <button
              key={stage}
              type="button"
              disabled={isPending || isTerminal || isCurrent}
              onClick={() => void handleClick(stage)}
              className={cn(
                "rounded-full border px-3 py-1 text-meta font-medium transition-colors",
                isCurrent && "border-primary bg-primary text-primary-foreground",
                !isCurrent && isPast && "border-border bg-muted text-muted-foreground",
                !isCurrent && !isPast && "border-dashed border-border text-muted-foreground hover:bg-muted/60",
                (isTerminal || isPending) && !isCurrent && "cursor-not-allowed opacity-60",
              )}
            >
              {DEAL_STAGE_REGISTRY[stage].label}
            </button>
          );
        })}
        {current.stage === "lost" && (
          <span className="rounded-full border border-destructive/40 bg-destructive/10 px-3 py-1 text-meta font-medium text-destructive">
            失注
          </span>
        )}
      </div>
      {/* #102: 終端 (paid/lost) は本バー上では遷移不可のまま — 再開はヘッダの専用経路に隔離する */}
      {isTerminal && <p className="text-meta text-admin-text-meta">再開はヘッダの「案件を再開…」から</p>}
    </div>
  );
}
