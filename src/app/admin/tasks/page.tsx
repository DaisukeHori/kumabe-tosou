import Link from "next/link";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/app/admin/_ui";
import { crmFacade } from "@/modules/crm/facade";
import type { TaskStatus } from "@/modules/crm/contracts";

import { groupOpenTasks } from "./task-groups";
import { TasksKanban } from "./tasks-kanban";
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

export default async function AdminTasksPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; cursor?: string; view?: string }>;
}) {
  const { status: statusParam, cursor, view } = await searchParams;
  const status: TaskStatus | "all" = (["open", "done", "cancelled", "all"] as string[]).includes(statusParam ?? "")
    ? (statusParam as TaskStatus | "all")
    : "open";
  // やることカンバン (#99)。open タスクのトリアージ専用 — done/cancelled/all フィルタ時は
  // カンバンに切り替えられない (受入基準)。
  const isKanbanView = view === "kanban" && status === "open";

  if (isKanbanView) {
    // zPagination max=100。100 件を超える open タスクは一部が盤面に出ない — 上部の注記で緩和する
    // (実装計画書 issue-99.md リスク5: 必要になれば zTaskListFilter.scope 別フェッチへ拡張できる)。
    const result = await crmFacade.listTasks({ status: "open", scope: "all" }, { cursor: null, limit: 100 });

    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="やること"
          description="←→ で列移動、↑↓ でカード移動、Shift+←/→ で期日移動、Enter で編集です。"
          actions={
            <Link href="/admin/tasks">
              <Badge variant="outline" className="cursor-pointer px-3 py-1">
                リスト表示
              </Badge>
            </Link>
          }
        />

        <TasksQuickAdd />

        {!result.ok && (
          <p className="text-sm text-destructive">
            一覧の取得に失敗しました ({result.code}): {result.detail}
          </p>
        )}
        {result.ok && (
          <>
            <TasksKanban initialTasks={result.value.items} />
            {result.value.next_cursor && (
              <p className="text-xs text-muted-foreground">100件を超えています — 一覧表示で確認してください。</p>
            )}
          </>
        )}
      </div>
    );
  }

  const result = await crmFacade.listTasks({ status, scope: "all" }, { cursor: cursor ?? null, limit: 50 });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="やること"
        description="Space で完了トグル、↑↓ で移動、Enter で詳細です。"
        actions={
          status === "open" ? (
            <Link href="/admin/tasks?view=kanban">
              <Badge variant="default" className="cursor-pointer px-3 py-1">
                カンバン表示
              </Badge>
            </Link>
          ) : undefined
        }
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
