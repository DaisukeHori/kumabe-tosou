"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { getErrorInfo } from "@/modules/platform/errors";

import { generateBlocksAction } from "./actions";

/**
 * 「作業ブロックを用意」ボタン (実装計画書 issue-61.md 成果物2)。
 * Issue #96 §C-左4 で `document-detail.tsx` の実装 (state/handleGenerateBlocks/確認 Dialog、
 * L105-106,216-236,330-339,488-505) をここへ抽出し、`DealWorkSummaryCard.tsx` からも共用する。
 *
 * `confirmed=false` で 1 回目を呼び、`confirm_required` が返ったら確認ダイアログを出して
 * `confirmed=true` で再実行する (PaymentDialog の paidConfirmOpen ネスト Dialog と同型の
 * 「確認→再実行」パターン)。`generateBlocksFromLines` が全滅したときは facade が KMB-E704 を返し
 * Result 自体が `ok:false` になる (block_ids が空の成功はあり得ない設計) ため、ここでは
 * `!result.ok` 分岐でのみエラートーストを出す。
 */
export function GenerateBlocksButton({
  documentId,
  dealId,
  label = "作業ブロックを用意",
  variant = "outline",
}: {
  documentId: string;
  dealId: string;
  label?: string;
  variant?: "outline" | "default";
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [confirm, setConfirm] = useState<{ existingCount: number } | null>(null);

  async function handleGenerateBlocks(confirmed: boolean) {
    setIsPending(true);
    const result = await generateBlocksAction(documentId, dealId, confirmed);
    setIsPending(false);
    if (!result.ok) {
      setConfirm(null);
      toast.error(result.detail ?? getErrorInfo(result.code).message);
      return;
    }
    if (result.value.status === "confirm_required") {
      setConfirm({ existingCount: result.value.existingCount });
      return;
    }
    setConfirm(null);
    const { block_ids, skipped } = result.value;
    toast.success(
      `作業ブロックを ${block_ids.length} 件用意しました${skipped.length > 0 ? ` (${skipped.length} 件は対象外です)` : ""}`,
      { action: { label: "カレンダーを開く", onClick: () => router.push("/admin/calendar") } },
    );
    router.refresh();
  }

  return (
    <>
      <Button type="button" variant={variant} disabled={isPending} onClick={() => void handleGenerateBlocks(false)}>
        {label}
      </Button>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>すでに作業ブロックがあります</DialogTitle>
            <DialogDescription>
              すでに {confirm?.existingCount ?? 0} 件の作業ブロックがあります。もう一度実行すると重複して生成されます。続けますか?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirm(null)}>
              キャンセル
            </Button>
            <Button type="button" disabled={isPending} onClick={() => void handleGenerateBlocks(true)}>
              続ける
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
