"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { cancelOpenBlocksForDealAction } from "@/app/admin/calendar/actions";

/**
 * 失注確定成功後の「未着手の作業ブロックを取り消しますか?」確認 Dialog (実装計画書 issue-61.md
 * 成果物6)。`DealHeaderActions.tsx` (案件詳細) と `deals-kanban.tsx` (カンバン失注ドロップ) の
 * 両方から使う共用 Dialog — `LostReasonDialog` と同じ「共用 Dialog + onConfirm 系 callback なし・
 * 自前で Action を呼ぶ」設計にする (適用は既存 `cancelOpenBlocksForDealAction`
 * (`@/app/admin/calendar/actions`、#53 実装済み) をそのまま呼ぶ。新規 Action は作らない — 乖離B)。
 *
 * `open` は呼び出し側が `getOpenBlockCountForDealAction` で件数を取得できた (count > 0) ときのみ
 * true にする想定 (count === 0 なら呼び出し側でそもそも Dialog を開かない)。
 */
export function CancelBlocksDialog({
  open,
  onOpenChange,
  dealId,
  count,
  onCancelled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  count: number;
  onCancelled: () => void;
}) {
  const [isPending, setIsPending] = useState(false);

  async function handleConfirm() {
    setIsPending(true);
    const result = await cancelOpenBlocksForDealAction(dealId);
    setIsPending(false);
    onOpenChange(false);
    if (!result.ok) {
      toast.error(result.detail ?? `取り消せませんでした (${result.code})`);
      return;
    }
    toast.success(`${result.value.cancelled} 件の作業ブロックを取り消しました。`);
    onCancelled();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] shadow-modal">
        <DialogHeader>
          <DialogTitle>未着手の作業ブロックを取り消しますか?</DialogTitle>
          <DialogDescription>
            この案件には未着手 (backlog/scheduled) の作業ブロックが {count} 件あります。着手済み・完了済みのブロックは対象外です。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            そのままにする
          </Button>
          <Button type="button" variant="destructive-outline" disabled={isPending} onClick={() => void handleConfirm()}>
            取り消す
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
