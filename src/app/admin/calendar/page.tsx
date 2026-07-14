import type { Metadata } from "next";

import { PageHeader } from "@/app/admin/_ui";
import { createSchedulingFacade } from "@/modules/scheduling/facade";

import { CalendarBoard } from "./calendar-board";
import { CalendarSecondaryTabs } from "./_ui/secondary-tabs";
import { addDaysJst, mondayOfWeekJst, todayJstDateOnly, weekRangeIso } from "./_ui/jst-time";

export const metadata: Metadata = { title: "カレンダー" };
export const dynamic = "force-dynamic";

/**
 * /admin/calendar (03-scheduling.md §10.2 中核画面)。
 * Server Component が getCalendarRange + getBacklogBlocks + getWeeklyCapacity + listWorkTypes を
 * 並列取得 → Client CalendarBoard へ props 渡し (admin-ui-auth §4/§5 準拠)。
 * getExternalBusy/listSyncIssues は calendar_connections/calendar_event_links (migration 0030) が
 * 前提の #54 スコープであり、この Issue (#53) の SchedulingFacadeCore には存在しないため呼ばない
 * (openIssues に記載 — 存在しない facade メソッドを呼ばないのが安全側の判断)。
 *
 * initial range は今週+来週の 2 週分 (実装計画書の指示どおり)。
 */
export default async function AdminCalendarPage() {
  const schedulingFacade = createSchedulingFacade();
  const weekStart = mondayOfWeekJst(todayJstDateOnly());
  const { fromIso } = weekRangeIso(weekStart);
  const { toIso } = weekRangeIso(addDaysJst(weekStart, 7));

  const [rangeResult, backlogResult, capacityResult, workTypesResult] = await Promise.all([
    schedulingFacade.getCalendarRange({ from: fromIso, to: toIso }),
    schedulingFacade.getBacklogBlocks({ cursor: null, limit: 50 }),
    schedulingFacade.getWeeklyCapacity(weekStart),
    schedulingFacade.listWorkTypes(false),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="カレンダー"
        description="↑↓: トレイの行移動 / ←→: 選択札の日移動 / Shift+↑↓: 30分移動 / Enter: 詳細 / Esc: 閉じる / Cmd(Ctrl)+S: 保存 / T: 今日 / W・M: 週/月切替"
      />
      <CalendarSecondaryTabs />
      {!rangeResult.ok && (
        <p className="text-sm text-destructive">カレンダーの取得に失敗しました ({rangeResult.code})。再読み込みしてください。</p>
      )}
      <CalendarBoard
        initialWeekStart={weekStart}
        initialBlocks={rangeResult.ok ? rangeResult.value : []}
        initialBacklog={backlogResult.ok ? backlogResult.value : { items: [], next_cursor: null }}
        initialCapacity={capacityResult.ok ? capacityResult.value : null}
        workTypes={workTypesResult.ok ? workTypesResult.value : []}
      />
    </div>
  );
}
