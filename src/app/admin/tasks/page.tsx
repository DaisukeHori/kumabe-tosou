import Link from "next/link";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/app/admin/_ui";
import { crmFacade } from "@/modules/crm/facade";
import type { TaskListItem, TaskStatus } from "@/modules/crm/contracts";

import { TasksList } from "./tasks-list";
import { TasksQuickAdd } from "./tasks-quick-add";

export const metadata: Metadata = { title: "やること" };
export const dynamic = "force-dynamic";

const STATUS_FILTERS: { value: TaskStatus | "all"; label: string }[] = [
  { value: "open", label: "未完了" },
  { value: "done", label: "完了" },
  { value: "cancelled", label: "取消" },
  { value: "all", label: "すべて" },
];

/**
 * JST 日付境界ヘルパ (internal/jst.ts と同じ +9h シフト方式の再実装 — crm/internal は UI から
 * import 不可のため §8.4 のグルーピング (期日超過/今日/今週/それ以降/期日なし) 専用に複製する)。
 */
function jstTodayDateOnly(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function jstWeekRange(): { from: string; to: string } {
  const shifted = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const dow = shifted.getUTCDay();
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(shifted);
  monday.setUTCDate(monday.getUTCDate() + diffToMonday);
  monday.setUTCHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}

type Group = { key: string; label: string; tasks: TaskListItem[] };

function groupOpenTasks(items: TaskListItem[]): Group[] {
  const today = jstTodayDateOnly();
  const week = jstWeekRange();
  const overdue: TaskListItem[] = [];
  const todayGroup: TaskListItem[] = [];
  const weekGroup: TaskListItem[] = [];
  const later: TaskListItem[] = [];
  const noDue: TaskListItem[] = [];

  for (const t of items) {
    if (t.due_on === null) {
      noDue.push(t);
    } else if (t.overdue) {
      overdue.push(t);
    } else if (t.due_on === today) {
      todayGroup.push(t);
    } else if (t.due_on >= week.from && t.due_on <= week.to) {
      weekGroup.push(t);
    } else {
      later.push(t);
    }
  }

  return [
    { key: "overdue", label: "期日超過", tasks: overdue },
    { key: "today", label: "今日", tasks: todayGroup },
    { key: "week", label: "今週", tasks: weekGroup },
    { key: "later", label: "それ以降", tasks: later },
    { key: "no_due", label: "期日なし", tasks: noDue },
  ].filter((g) => g.tasks.length > 0);
}

export default async function AdminTasksPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; cursor?: string }>;
}) {
  const { status: statusParam, cursor } = await searchParams;
  const status: TaskStatus | "all" = (["open", "done", "cancelled", "all"] as string[]).includes(statusParam ?? "")
    ? (statusParam as TaskStatus | "all")
    : "open";

  const result = await crmFacade.listTasks({ status, scope: "all" }, { cursor: cursor ?? null, limit: 50 });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="やること"
        description="Space で完了トグル、↑↓ で移動、Enter で詳細です。"
      />

      <TasksQuickAdd />

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <Link key={f.value} href={f.value === "open" ? "/admin/tasks" : `/admin/tasks?status=${f.value}`}>
            <Badge variant={status === f.value ? "default" : "outline"} className="cursor-pointer px-3 py-1">
              {f.label}
            </Badge>
          </Link>
        ))}
      </div>

      {!result.ok && (
        <p className="text-sm text-destructive">
          一覧の取得に失敗しました ({result.code}): {result.detail}
        </p>
      )}

      {result.ok && status === "open" && (
        <div className="flex flex-col gap-6">
          {groupOpenTasks(result.value.items).map((group) => (
            <div key={group.key} className="flex flex-col gap-2">
              <h3
                className={`text-sm font-medium ${group.key === "overdue" ? "text-destructive" : "text-foreground"}`}
              >
                {group.label} ({group.tasks.length})
              </h3>
              <TasksList tasks={group.tasks} />
            </div>
          ))}
          {result.value.items.length === 0 && <p className="text-sm text-muted-foreground">未完了のやることはありません。</p>}
        </div>
      )}

      {result.ok && status !== "open" && <TasksList tasks={result.value.items} />}

      {result.ok && result.value.next_cursor && (
        <Link
          href={`/admin/tasks?status=${status}&cursor=${encodeURIComponent(result.value.next_cursor)}`}
          className="text-sm underline underline-offset-4"
        >
          次の50件へ →
        </Link>
      )}
    </div>
  );
}
