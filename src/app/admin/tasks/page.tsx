import Link from "next/link";
import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { PageHeader, PillToggle, type PillItem } from "@/app/admin/_ui";
import { cn } from "@/lib/utils";
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
            <Button variant="outline" size="sm" render={<Link href="/admin/tasks" />}>
              リスト表示
            </Button>
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
              <p className="text-meta text-admin-text-meta">100件を超えています — 一覧表示で確認してください。</p>
            )}
          </>
        )}
      </div>
    );
  }

  const result = await crmFacade.listTasks({ status, scope: "all" }, { cursor: cursor ?? null, limit: 50 });

  const filterItems: PillItem[] = STATUS_FILTERS.map((f) => ({
    key: f.value,
    label: f.label,
    href: f.value === "open" ? "/admin/tasks" : `/admin/tasks?status=${f.value}`,
    active: status === f.value,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="やること"
        description="やることをメモして、チェックで完了にできます。案件・顧客に紐づけると、その詳細画面にも表示されます。"
        actions={
          status === "open" ? (
            <Button variant="outline" size="sm" render={<Link href="/admin/tasks?view=kanban" />}>
              カンバン表示
            </Button>
          ) : undefined
        }
      />

      <TasksQuickAdd />

      <PillToggle items={filterItems} ariaLabel="ステータスで絞り込み" />

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
                className={cn(
                  "text-table font-bold",
                  group.key === "overdue" ? "text-destructive" : "text-admin-text-label",
                )}
              >
                {group.label} ({group.tasks.length})
              </h3>
              <TasksList tasks={group.tasks} />
            </div>
          ))}
          {result.value.items.length === 0 && (
            <p className="text-sm text-muted-foreground">未完了のやることはありません。</p>
          )}
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
