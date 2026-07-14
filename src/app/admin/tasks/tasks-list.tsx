"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Surface } from "@/app/admin/_ui";
import { cn } from "@/lib/utils";
import type { TaskListItem } from "@/modules/crm/contracts";

import { cancelTaskAction, reopenTaskAction } from "./actions";
import { TaskEditSheet } from "./TaskEditSheet";
import { useTaskComplete } from "./use-task-complete";

// tasks-kanban.tsx でも共用 (#99)。
export const ORIGIN_LABEL: Record<TaskListItem["origin"], string> = {
  manual: "手動",
  ai_call: "電話AI",
  form: "フォーム",
  system: "システム",
};

/**
 * やること一覧の行群 (01-crm.md §8.4)。Checkbox クリック/Space = completeTaskAction
 * (即時反映 + toast「元に戻す」— useTaskComplete フック、#99 で tasks-kanban.tsx と共用化)。
 * 行 dropdown: 編集 (Sheet) / 取り消し (確認 Dialog)。
 */
export function TasksList({ tasks: initialTasks }: { tasks: TaskListItem[] }) {
  const router = useRouter();
  const { completeTask } = useTaskComplete();
  const [tasks, setTasks] = useState(initialTasks);
  const [editingTask, setEditingTask] = useState<TaskListItem | null>(null);
  const [cancellingTask, setCancellingTask] = useState<TaskListItem | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  useEffect(() => setTasks(initialTasks), [initialTasks]);

  async function handleComplete(task: TaskListItem) {
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    await completeTask(task, () => setTasks((prev) => [task, ...prev]));
  }

  async function handleReopen(task: TaskListItem) {
    const result = await reopenTaskAction(task.id, task.updated_at);
    if (!result.ok) {
      toast.error(result.detail ?? "元に戻せませんでした。");
      return;
    }
    toast.success("やることを再開しました。");
    router.refresh();
  }

  async function handleCancel() {
    if (!cancellingTask) return;
    setIsCancelling(true);
    const result = await cancelTaskAction(cancellingTask.id, cancellingTask.updated_at);
    setIsCancelling(false);
    if (!result.ok) {
      toast.error(result.detail ?? "取り消しに失敗しました。");
      return;
    }
    toast.success("やることを取り消しました。");
    setCancellingTask(null);
    router.refresh();
  }

  if (tasks.length === 0) {
    return <p className="text-sm text-muted-foreground">該当するやることはありません。</p>;
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        {tasks.map((task) => (
          <Surface key={task.id} className="flex items-center gap-2.5 p-3">
            {task.status === "open" && (
              <Checkbox
                checked={false}
                onCheckedChange={() => void handleComplete(task)}
                aria-label={`「${task.title}」を完了にする`}
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className={cn("truncate text-sm", task.status !== "open" && "text-muted-foreground line-through")}>
                  {task.title}
                </p>
                <Badge variant="outline" className="shrink-0">
                  {ORIGIN_LABEL[task.origin]}
                </Badge>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                {task.due_on && (
                  <span className={cn(task.overdue && "font-medium text-destructive")}>
                    期日: {task.due_on}
                    {task.overdue && " (超過)"}
                  </span>
                )}
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
            </div>
            {task.status !== "cancelled" && (
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" />}>
                  <span aria-hidden>⋯</span>
                  <span className="sr-only">操作</span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {task.status === "open" && (
                    <>
                      <DropdownMenuItem onClick={() => setEditingTask(task)}>編集</DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => setCancellingTask(task)}>
                        取り消し
                      </DropdownMenuItem>
                    </>
                  )}
                  {task.status === "done" && (
                    <DropdownMenuItem onClick={() => void handleReopen(task)}>元に戻す</DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </Surface>
        ))}
      </div>

      {editingTask && (
        <TaskEditSheet task={editingTask} open={!!editingTask} onOpenChange={(open) => !open && setEditingTask(null)} />
      )}

      <Dialog open={!!cancellingTask} onOpenChange={(open) => !open && setCancellingTask(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>やることを取り消しますか</DialogTitle>
            <DialogDescription>この操作は元に戻せません。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCancellingTask(null)}>
              キャンセル
            </Button>
            <Button type="button" variant="destructive" disabled={isCancelling} onClick={() => void handleCancel()}>
              {isCancelling ? "処理中..." : "取り消す"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
