"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import { completeTaskAction, undoCompleteTaskAction } from "@/app/admin/tasks/actions";
import type { TaskListItem } from "@/modules/crm/contracts";
import { cn } from "@/lib/utils";

/**
 * 顧客/案件詳細ページの「open タスク」ミニリスト (01-crm.md §8.2/§8.3)。
 * Checkbox で完了 → toast「元に戻す」で undoCompleteTaskAction。
 */
export function MiniTaskList({
  tasks: initialTasks,
  emptyText = "open のタスクはありません。",
}: {
  tasks: TaskListItem[];
  emptyText?: string;
}) {
  const [tasks, setTasks] = useState(initialTasks);

  async function handleComplete(task: TaskListItem) {
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    const result = await completeTaskAction(task.id, task.updated_at);
    if (!result.ok) {
      toast.error(result.detail ?? "完了にできませんでした。");
      setTasks((prev) => [task, ...prev]);
      return;
    }
    toast.success(`「${task.title}」を完了にしました。`, {
      action: {
        label: "元に戻す",
        onClick: () => {
          void undoCompleteTaskAction(task.id).then((undoResult) => {
            if (!undoResult.ok) {
              toast.error(undoResult.detail ?? "元に戻せませんでした。");
              return;
            }
            setTasks((prev) => (prev.some((t) => t.id === task.id) ? prev : [task, ...prev]));
          });
        },
      },
    });
  }

  if (tasks.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
      {tasks.map((task) => (
        <li key={task.id} className="flex items-center gap-2.5 px-3 py-2 text-sm">
          <Checkbox checked={false} onCheckedChange={() => void handleComplete(task)} aria-label={`「${task.title}」を完了にする`} />
          <div className="min-w-0 flex-1">
            <p className="truncate">{task.title}</p>
            {task.due_on && (
              <p className={cn("text-xs text-muted-foreground", task.overdue && "font-medium text-destructive")}>
                期日: {task.due_on}
                {task.overdue && " (超過)"}
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
