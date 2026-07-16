"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { KanbanBoard, KanbanCard, KanbanColumn, useKanbanKeyboard } from "@/app/admin/_ui";
import { cn } from "@/lib/utils";
import type { TaskListItem } from "@/modules/crm/contracts";

import { updateTaskAction } from "./actions";
import { TaskEditSheet } from "./TaskEditSheet";
import { ORIGIN_LABEL } from "./tasks-list";
import { bucketOpenTasks, dueDateForBucket, TASK_DUE_BUCKET_LABEL, TASK_DUE_BUCKET_ORDER, type TaskDueBucket } from "./task-groups";
import { useTaskComplete } from "./use-task-complete";

/**
 * やることカンバン (/admin/tasks?view=kanban、status=open 専用、#99)。期日5列 (期日超過/今日/今週/
 * それ以降/期日なし)、空列も表示 (ドロップ先として必要 — リストの「空グループ非表示」とは意図的に
 * 異なる)。「期日超過」列は onDragOver/onDrop を渡さない (KanbanColumn 側で省略するとネイティブ DnD の
 * ドロップを preventDefault しない = ブラウザ既定で拒否される) ことでドロップ不可を構造的に保証し、
 * applyDueChange 内でも「二重防御」として明示ガードする (deals-kanban.tsx の lost ガードと同じ判断基準)。
 */
export function TasksKanban({ initialTasks }: { initialTasks: TaskListItem[] }) {
  const router = useRouter();
  const { completeTask } = useTaskComplete();
  const [tasks, setTasks] = useState(initialTasks);
  const [editingTask, setEditingTask] = useState<TaskListItem | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => setTasks(initialTasks), [initialTasks]);

  const buckets = bucketOpenTasks(tasks);
  const columns = TASK_DUE_BUCKET_ORDER.map((key) => ({ key, label: TASK_DUE_BUCKET_LABEL[key], tasks: buckets[key] }));

  async function applyDueChange(task: TaskListItem, targetBucket: TaskDueBucket) {
    if (targetBucket === "overdue") return; // 二重防御 (DnD/キーボードとも構造上ここには来ない経路)
    const newDue = dueDateForBucket(targetBucket);
    if (task.due_on === newDue) return;
    const previousTasks = tasks;
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, due_on: newDue } : t)));
    const result = await updateTaskAction(
      task.id,
      {
        title: task.title,
        body: task.body,
        due_on: newDue,
        deal_id: task.deal?.id ?? null,
        customer_id: task.customer?.id ?? null,
      },
      task.updated_at,
    );
    if (!result.ok) {
      setTasks(previousTasks);
      if (result.code === "KMB-E103") {
        toast.error("他の操作でこのやることが更新されています。再読み込みしてください。");
      } else {
        toast.error(result.detail ?? "期日の変更に失敗しました。");
      }
      return;
    }
    toast.success(newDue ? `期日を ${newDue} に変更しました。` : "期日を未設定にしました。");
    router.refresh();
  }

  function handleMoveDue(taskId: string, currentBucket: TaskDueBucket, direction: 1 | -1) {
    const idx = TASK_DUE_BUCKET_ORDER.indexOf(currentBucket);
    const targetBucket = TASK_DUE_BUCKET_ORDER[idx + direction];
    if (!targetBucket) return;
    const task = buckets[currentBucket].find((t) => t.id === taskId);
    if (!task) return;
    void applyDueChange(task, targetBucket);
  }

  const { focus, setFocus, handleKeyDown } = useKanbanKeyboard<TaskDueBucket>({
    columns: columns.map((c) => ({ key: c.key, items: c.tasks })),
    onOpenDetail: (taskId) => {
      const task = tasks.find((t) => t.id === taskId);
      if (task) setEditingTask(task);
    },
    onMoveItem: handleMoveDue,
  });

  function handleDrop(targetBucket: TaskDueBucket) {
    if (!draggingId) return;
    const task = tasks.find((t) => t.id === draggingId);
    setDraggingId(null);
    if (!task) return;
    void applyDueChange(task, targetBucket);
  }

  async function handleComplete(task: TaskListItem) {
    const previousTasks = tasks;
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    await completeTask(task, () => setTasks(previousTasks));
  }

  return (
    <>
      <KanbanBoard ariaLabel="やることカンバン" onKeyDown={handleKeyDown}>
        {columns.map((column, colIndex) => (
          <KanbanColumn
            key={column.key}
            ariaLabel={column.label}
            onDragOver={column.key === "overdue" ? undefined : (e) => e.preventDefault()}
            onDrop={column.key === "overdue" ? undefined : () => handleDrop(column.key)}
            header={<span className={cn(column.key === "overdue" && "text-destructive")}>{column.label}</span>}
            meta={`${column.tasks.length}件`}
          >
            {column.tasks.map((task, rowIndex) => {
              const isFocused = focus?.col === colIndex && focus.row === rowIndex;
              return (
                <KanbanCard
                  key={task.id}
                  isFocused={isFocused}
                  onDragStart={() => setDraggingId(task.id)}
                  onDragEnd={() => setDraggingId(null)}
                  onClick={() => {
                    setFocus({ col: colIndex, row: rowIndex });
                    setEditingTask(task);
                  }}
                >
                  <div className="flex items-start gap-2">
                    {/* Checkbox クリックがカードの onClick (編集 Sheet を開く) に伝播しないよう
                        stopPropagation する — deals/customers のカードには無いパターンだが、
                        タスクカードはクリック可能な子要素 (Checkbox/Link) を持つ点が異なるため必要。 */}
                    <div onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={false}
                        onCheckedChange={() => void handleComplete(task)}
                        aria-label={`「${task.title}」を完了にする`}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{task.title}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-admin-text-meta">
                        {task.due_on &&
                          (task.overdue ? (
                            <Badge variant="urgent">期日: {task.due_on}</Badge>
                          ) : (
                            <span>期日: {task.due_on}</span>
                          ))}
                        <Badge variant="outline">{ORIGIN_LABEL[task.origin]}</Badge>
                      </div>
                      {(task.deal || task.customer) && (
                        <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px]" onClick={(e) => e.stopPropagation()}>
                          {task.deal && (
                            <Link href={`/admin/deals/${task.deal.id}`} className="underline underline-offset-4">
                              {task.deal.title}
                            </Link>
                          )}
                          {task.customer && (
                            <Link href={`/admin/customers/${task.customer.id}`} className="underline underline-offset-4">
                              {task.customer.name}
                            </Link>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </KanbanCard>
              );
            })}
          </KanbanColumn>
        ))}
      </KanbanBoard>

      {editingTask && (
        <TaskEditSheet task={editingTask} open={!!editingTask} onOpenChange={(open) => !open && setEditingTask(null)} />
      )}
    </>
  );
}
