import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { PageHeader, Surface } from "@/app/admin/_ui";
import { ActivityTimeline } from "@/app/admin/_ui/activity-timeline";
import { MiniTaskList } from "@/app/admin/_ui/mini-task-list";
import { crmFacade } from "@/modules/crm/facade";
import { createSalesFacade } from "@/modules/sales/facade";
import { createSchedulingFacade } from "@/modules/scheduling/facade";

import { DealDocumentsCard } from "./DealDocumentsCard";
import { DealEscapeToList } from "./DealEscapeToList";
import { DealHeaderActions } from "./DealHeaderActions";
import { DealOverviewCard } from "./DealOverviewCard";
import { DealStageSummary } from "./DealStageSummary";
import { DealWorkSummaryCard } from "./DealWorkSummaryCard";
import { TasksQuickAdd } from "../../tasks/tasks-quick-add";

export const dynamic = "force-dynamic";
// 静的タイトルに固定 (地雷回避: generateMetadata 内で cookie 依存クライアントを使わない —
// documents/[id]/page.tsx:14-17 の裁定を踏襲。動的化 (案件名表示) は React cache() での dedupe
// 方式の新裁定が必要な未解決事項 — Issue #96 設計 §リスク1)。
export const metadata: Metadata = { title: "案件詳細" };

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

  const [tasksResult, timelineResult, documentsResult, workSummaryResult] = await Promise.all([
    crmFacade.listTasksByDeal(id, { cursor: null, limit: 50 }),
    crmFacade.listTimeline({ deal_id: id }, { cursor: null, limit: 50 }),
    createSalesFacade().listDocuments({ doc_type: null, status: null, deal_id: id, q: null }, { cursor: null, limit: 50 }),
    createSchedulingFacade().getDealWorkSummary(id),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <DealEscapeToList />

      <PageHeader
        title={deal.title}
        backHref="/admin/deals"
        description="Esc で一覧へ、Cmd(Ctrl)+S で保存します。"
        actions={<DealHeaderActions deal={deal} />}
      />

      <DealStageSummary deal={deal} />

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="flex flex-col gap-6 lg:col-span-3">
          <DealOverviewCard deal={deal} />

          <Surface className="flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium">やること ({tasksResult.ok ? tasksResult.value.items.length : 0})</h3>
              <Link href="/admin/tasks" className="text-sm underline underline-offset-4">
                すべて見る →
              </Link>
            </div>
            <TasksQuickAdd defaultDealId={id} showDealPicker={false} />
            {!tasksResult.ok && (
              <p className="text-sm text-destructive">
                取得に失敗しました ({tasksResult.code}): {tasksResult.detail}
              </p>
            )}
            {tasksResult.ok && <MiniTaskList tasks={tasksResult.value.items} />}
          </Surface>

          <DealDocumentsCard dealId={id} documentsResult={documentsResult} />

          <DealWorkSummaryCard
            dealId={id}
            dealStage={deal.stage}
            workSummaryResult={workSummaryResult}
            documentsResult={documentsResult}
          />
        </div>

        <div className="flex flex-col gap-4 lg:col-span-2">
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
