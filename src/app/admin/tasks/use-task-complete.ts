"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import type { TaskListItem } from "@/modules/crm/contracts";

import { completeTaskAction, undoCompleteTaskAction } from "./actions";

/**
 * 「Checkbox 完了 → toast『元に戻す』」の共通フック (01-crm.md §8.4)。#99 で tasks-list.tsx の
 * handleComplete (#44) から抽出し、tasks-list.tsx (リスト) と tasks-kanban.tsx (カンバン) で
 * 共用する。表示構造 (配列/カンバン列) がリストとカンバンで異なるため、対象タスクを表示から
 * 取り除く楽観更新そのものは呼び出し元の責務のままにし、本フックは Server Action 呼び出しと
 * 成功/失敗の toast・失敗時ロールバック呼び出しのみを担当する。
 */
export function useTaskComplete() {
  const router = useRouter();

  async function completeTask(task: TaskListItem, onRollback: () => void): Promise<void> {
    const result = await completeTaskAction(task.id, task.updated_at);
    if (!result.ok) {
      toast.error(result.detail ?? "完了にできませんでした。");
      onRollback();
      return;
    }
    toast.success(`「${task.title}」を完了にしました。`, {
      action: {
        label: "元に戻す",
        onClick: () => {
          void undoCompleteTaskAction(task.id).then((r) => {
            if (!r.ok) {
              toast.error(r.detail ?? "元に戻せませんでした。");
              return;
            }
            router.refresh();
          });
        },
      },
    });
    router.refresh();
  }

  return { completeTask };
}
