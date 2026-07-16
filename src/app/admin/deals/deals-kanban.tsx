"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { KanbanBoard, KanbanCard, KanbanCollapsedColumn, KanbanColumn, Surface, useKanbanKeyboard } from "@/app/admin/_ui";
import { DEAL_STAGE_REGISTRY, zDealStage, type DealKanbanColumn, type DealListItem, type DealStage } from "@/modules/crm/contracts";
import { cn } from "@/lib/utils";

import { getOpenBlockCountForDealAction } from "@/app/admin/calendar/actions";

import { markDealLostAction, updateDealStageAction } from "./actions";
import { CancelBlocksDialog } from "./cancel-blocks-dialog";
import { LostReasonDialog } from "./lost-reason-dialog";

const jpy = new Intl.NumberFormat("ja-JP");

/** JST の「今日」(YYYY-MM-DD)。date-picker.tsx / activity-timeline.tsx と同じ +9h シフト方式
 *  (crm/internal/jst.ts は UI から import 不可 — MODULES 境界)。expected_close_on の
 *  超過表示 (赤字) の比較に使う — `new Date(dateOnly) < new Date()` は UTC 変換で
 *  JST 日付がずれる地雷のため使わない。 */
function jstTodayDateOnly(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
// 非終端 7 ステージ (01-crm.md §8.3: 「列 = 非終端 7 ステージ (inquiry〜invoiced)」)。
// DEAL_STAGE_REGISTRY.isWon は「受注済み系」の意味 (ordered〜paid の 5 段) であり
// 「終端」ではない (won の中でも paid のみが終端) — カンバンの折りたたみ列判定には
// isWon ではなく stage 名の直接除外を使う。
const NON_TERMINAL_STAGES = zDealStage.options.filter((s) => s !== "paid" && s !== "lost");
const STAGE_ORDER = zDealStage.options;

function recomputeColumn(column: DealKanbanColumn, deals: DealListItem[]): DealKanbanColumn {
  return { ...column, deals, total_jpy: deals.reduce((sum, d) => sum + (d.amount_jpy ?? 0), 0) };
}

function moveDeal(
  columns: DealKanbanColumn[],
  dealId: string,
  fromStage: DealStage,
  toStage: DealStage,
): DealKanbanColumn[] {
  const fromCol = columns.find((c) => c.stage === fromStage);
  const deal = fromCol?.deals.find((d) => d.id === dealId);
  if (!deal) return columns;
  return columns.map((c) => {
    if (c.stage === fromStage) return recomputeColumn(c, c.deals.filter((d) => d.id !== dealId));
    if (c.stage === toStage) return recomputeColumn(c, [{ ...deal, stage: toStage }, ...c.deals]);
    return c;
  });
}

export function DealsKanban({
  initialColumns,
  weightedPipelineJpy,
}: {
  initialColumns: DealKanbanColumn[];
  weightedPipelineJpy: number;
}) {
  const router = useRouter();
  const [columns, setColumns] = useState(initialColumns);
  const [lostDialogDeal, setLostDialogDeal] = useState<DealListItem | null>(null);
  const [expandedPaid, setExpandedPaid] = useState(false);
  const [expandedLost, setExpandedLost] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [cancelBlocksTarget, setCancelBlocksTarget] = useState<{ dealId: string; count: number } | null>(null);

  useEffect(() => setColumns(initialColumns), [initialColumns]);

  const mainColumns = NON_TERMINAL_STAGES.map((stage) => columns.find((c) => c.stage === stage)).filter(
    (c): c is DealKanbanColumn => c !== undefined,
  );
  const paidColumn = columns.find((c) => c.stage === "paid");
  const lostColumn = columns.find((c) => c.stage === "lost");

  async function applyStageChange(deal: DealListItem, fromStage: DealStage, toStage: DealStage) {
    const previousColumns = columns;
    setColumns((prev) => moveDeal(prev, deal.id, fromStage, toStage));
    const result = await updateDealStageAction(deal.id, toStage, deal.updated_at);
    if (!result.ok) {
      setColumns(previousColumns);
      if (result.code === "KMB-E103") {
        toast.error("他の操作でこの案件が更新されています。再読み込みしてください。");
      } else {
        toast.error(result.detail ?? "ステージ変更に失敗しました。");
      }
      return;
    }
    router.refresh();
  }

  async function handleMarkLost(reason: string) {
    if (!lostDialogDeal) return;
    const deal = lostDialogDeal;
    const previousColumns = columns;
    setColumns((prev) => moveDeal(prev, deal.id, deal.stage, "lost"));
    const result = await markDealLostAction(deal.id, { reason }, deal.updated_at);
    if (!result.ok) {
      setColumns(previousColumns);
      toast.error(result.detail ?? "失注にできませんでした。");
    } else {
      toast.success("失注にしました。");
      router.refresh();
      // 失注確定成功後、未着手ブロックの一括キャンセル提案 (実装計画書 issue-61.md 成果物6)。
      // カウント取得自体が失敗しても失注操作の完了体験は壊さない (Dialog を出さず黙って終了)。
      const openCount = await getOpenBlockCountForDealAction(deal.id);
      if (openCount.ok && openCount.value.count > 0) {
        setCancelBlocksTarget({ dealId: deal.id, count: openCount.value.count });
      }
    }
    setLostDialogDeal(null);
  }

  function handleMoveStage(dealId: string, currentStage: DealStage, direction: 1 | -1) {
    const currentColumn = columns.find((c) => c.stage === currentStage);
    const deal = currentColumn?.deals.find((d) => d.id === dealId);
    if (!deal) return;
    const idx = STAGE_ORDER.indexOf(currentStage);
    const targetStage = STAGE_ORDER[idx + direction];
    if (!targetStage) return;
    if (targetStage === "lost") {
      // 構造上 direction=+1 では非終端 7 列内から 'lost' に到達しない (キーボード操作は
      // Shift+→/← で「隣のステージ」に限定しているため) が、二重防御として明示ガードする。
      return;
    }
    void applyStageChange(deal, currentStage, targetStage);
  }

  const { focus, setFocus, handleKeyDown } = useKanbanKeyboard<DealStage>({
    columns: mainColumns.map((c) => ({ key: c.stage, items: c.deals })),
    onOpenDetail: (dealId) => router.push(`/admin/deals/${dealId}`),
    onMoveItem: handleMoveStage,
  });

  function handleDrop(toStage: DealStage) {
    if (!draggingId) return;
    const fromColumn = columns.find((c) => c.deals.some((d) => d.id === draggingId));
    const deal = fromColumn?.deals.find((d) => d.id === draggingId);
    setDraggingId(null);
    if (!deal || !fromColumn || fromColumn.stage === toStage) return;
    if (toStage === "lost") {
      setLostDialogDeal(deal);
      return;
    }
    void applyStageChange(deal, fromColumn.stage, toStage);
  }

  return (
    <div className="flex flex-col gap-4">
      <Surface className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
        <span className="text-label text-muted-foreground">
          見込み合計 (加重)
          <span className="ml-2 text-meta text-admin-text-faint">= 各案件の金額 × 確度の合計</span>
        </span>
        <span className="text-xl font-bold">¥{jpy.format(weightedPipelineJpy)}</span>
      </Surface>

      <KanbanBoard ariaLabel="案件カンバン" onKeyDown={handleKeyDown}>
        {mainColumns.map((column, colIndex) => (
          <KanbanColumn
            key={column.stage}
            ariaLabel={DEAL_STAGE_REGISTRY[column.stage].label}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(column.stage)}
            header={DEAL_STAGE_REGISTRY[column.stage].label}
            meta={`${column.deals.length}件 / ¥${jpy.format(column.total_jpy)}`}
          >
            {column.deals.map((deal, rowIndex) => {
              const isFocused = focus?.col === colIndex && focus.row === rowIndex;
              return (
                <KanbanCard
                  key={deal.id}
                  isFocused={isFocused}
                  onDragStart={() => setDraggingId(deal.id)}
                  onDragEnd={() => setDraggingId(null)}
                  onClick={() => {
                    setFocus({ col: colIndex, row: rowIndex });
                    router.push(`/admin/deals/${deal.id}`);
                  }}
                >
                  <p className="truncate text-label font-bold">{deal.title}</p>
                  <p className="mt-0.5 truncate text-meta text-admin-text-meta">{deal.customer_name}</p>
                  <div className="mt-1.5 flex items-center justify-between text-meta">
                    <span className="text-foreground">
                      {deal.amount_jpy !== null ? `¥${jpy.format(deal.amount_jpy)}` : "—"}
                    </span>
                    {deal.expected_close_on && (
                      <span
                        className={cn(
                          deal.expected_close_on < jstTodayDateOnly()
                            ? "font-bold text-destructive"
                            : "text-admin-text-meta",
                        )}
                      >
                        {deal.expected_close_on}
                      </span>
                    )}
                  </div>
                </KanbanCard>
              );
            })}
          </KanbanColumn>
        ))}
      </KanbanBoard>

      <div className="flex flex-wrap gap-3">
        {[
          { stage: "paid" as const, column: paidColumn, expanded: expandedPaid, setExpanded: setExpandedPaid },
          { stage: "lost" as const, column: lostColumn, expanded: expandedLost, setExpanded: setExpandedLost },
        ].map(({ stage, column, expanded, setExpanded }) => (
          <KanbanCollapsedColumn
            key={stage}
            label={DEAL_STAGE_REGISTRY[stage].label}
            count={column?.deals.length ?? 0}
            expanded={expanded}
            onToggleExpanded={() => setExpanded((v) => !v)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(stage)}
          >
            {(column?.deals ?? []).map((deal) => (
              <Surface
                key={deal.id}
                className="cursor-pointer p-2.5"
                onClick={() => router.push(`/admin/deals/${deal.id}`)}
              >
                <p className="truncate text-label font-bold">{deal.title}</p>
                <p className="mt-0.5 truncate text-meta text-admin-text-meta">{deal.customer_name}</p>
              </Surface>
            ))}
          </KanbanCollapsedColumn>
        ))}
      </div>

      {lostDialogDeal && (
        <LostReasonDialog
          open={!!lostDialogDeal}
          onOpenChange={(open) => !open && setLostDialogDeal(null)}
          dealTitle={lostDialogDeal.title}
          onConfirm={handleMarkLost}
        />
      )}
      {cancelBlocksTarget && (
        <CancelBlocksDialog
          open={cancelBlocksTarget !== null}
          onOpenChange={(open) => !open && setCancelBlocksTarget(null)}
          dealId={cancelBlocksTarget.dealId}
          count={cancelBlocksTarget.count}
          onCancelled={() => {
            setCancelBlocksTarget(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
