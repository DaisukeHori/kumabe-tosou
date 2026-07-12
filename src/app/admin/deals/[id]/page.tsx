import { notFound } from "next/navigation";

import { Surface } from "@/app/admin/_ui";
import { ActivityTimeline } from "@/app/admin/_ui/activity-timeline";
import { MiniTaskList } from "@/app/admin/_ui/mini-task-list";
import { crmFacade } from "@/modules/crm/facade";

import { DealHeaderActions } from "./DealHeaderActions";
import { DealOverviewCard } from "./DealOverviewCard";
import { DealStageBar } from "./DealStageBar";
import { TasksQuickAdd } from "../../tasks/tasks-quick-add";

export const dynamic = "force-dynamic";

export default async function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const dealResult = await crmFacade.getDeal(id);
  if (!dealResult.ok) {
    if (dealResult.code === "KMB-E603") notFound();
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">
          取得に失敗しました ({dealResult.code}): {dealResult.detail}
        </p>
      </div>
    );
  }
  const deal = dealResult.value;

  const [tasksResult, timelineResult] = await Promise.all([
    crmFacade.listTasksByDeal(id, { cursor: null, limit: 50 }),
    crmFacade.listTimeline({ deal_id: id }, { cursor: null, limit: 50 }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DealStageBar deal={deal} />
        <DealHeaderActions deal={deal} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <DealOverviewCard deal={deal} />

          <Surface className="flex flex-col gap-3 p-4">
            <h3 className="text-sm font-medium">やること</h3>
            <TasksQuickAdd defaultDealId={id} showDealPicker={false} />
            {!tasksResult.ok && (
              <p className="text-sm text-destructive">
                取得に失敗しました ({tasksResult.code}): {tasksResult.detail}
              </p>
            )}
            {tasksResult.ok && <MiniTaskList tasks={tasksResult.value.items} />}
          </Surface>

          <Surface className="flex flex-col gap-2 p-4">
            <h3 className="text-sm font-medium">帳票</h3>
            <p className="text-sm text-muted-foreground">帳票機能は準備中です。</p>
          </Surface>

          <Surface className="flex flex-col gap-2 p-4">
            <h3 className="text-sm font-medium">作業ブロック</h3>
            <p className="text-sm text-muted-foreground">作業ブロック機能は準備中です。</p>
          </Surface>
        </div>

        <div className="flex flex-col gap-4">
          <h3 className="text-sm font-medium">タイムライン</h3>
          {!timelineResult.ok && (
            <p className="text-sm text-destructive">
              取得に失敗しました ({timelineResult.code}): {timelineResult.detail}
            </p>
          )}
          {timelineResult.ok && (
            <ActivityTimeline
              target={{ deal_id: id }}
              initialItems={timelineResult.value.items}
              initialNextCursor={timelineResult.value.next_cursor}
            />
          )}
        </div>
      </div>
    </div>
  );
}
