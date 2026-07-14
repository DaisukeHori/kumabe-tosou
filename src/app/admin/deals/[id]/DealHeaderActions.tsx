"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DealDetail } from "@/modules/crm/contracts";

import { getOpenBlockCountForDealAction } from "@/app/admin/calendar/actions";

import { markDealLostAction, updateDealStageAction } from "../actions";
import { CancelBlocksDialog } from "../cancel-blocks-dialog";
import { LostReasonDialog } from "../lost-reason-dialog";

/**
 * 案件詳細ヘッダの操作 (01-crm.md §8.3): dropdown-menu (「失注にする」→ 理由 Dialog /
 * 「受注にする」→ v1 は updateDealStage のみ。02-sales 配線の帳票発行合成は Phase 3s 以降)。
 */
export function DealHeaderActions({ deal }: { deal: DealDetail }) {
  const router = useRouter();
  const [lostOpen, setLostOpen] = useState(false);
  const [isOrdering, setIsOrdering] = useState(false);
  const [cancelBlocksCount, setCancelBlocksCount] = useState<number | null>(null);

  const isTerminal = deal.stage === "paid" || deal.stage === "lost";

  async function handleLost(reason: string) {
    const result = await markDealLostAction(deal.id, { reason }, deal.updated_at);
    if (!result.ok) {
      toast.error(result.detail ?? "失注にできませんでした。");
      return;
    }
    toast.success("失注にしました。");
    setLostOpen(false);
    router.refresh();
    // 失注確定成功後、未着手ブロックの一括キャンセル提案 (実装計画書 issue-61.md 成果物6)。
    // カウント取得自体が失敗しても失注操作の完了体験は壊さない (Dialog を出さず黙って終了)。
    const openCount = await getOpenBlockCountForDealAction(deal.id);
    if (openCount.ok && openCount.value.count > 0) {
      setCancelBlocksCount(openCount.value.count);
    }
  }

  async function handleOrder() {
    setIsOrdering(true);
    const result = await updateDealStageAction(deal.id, "ordered", deal.updated_at);
    setIsOrdering(false);
    if (!result.ok) {
      toast.error(result.detail ?? "受注にできませんでした。");
      return;
    }
    toast.success("受注にしました。");
    router.refresh();
  }

  // BLOCKER 修正 (敵対レビュー): isTerminal での早期 return をコンポーネント全体に掛けると、
  // handleLost() 成功後の router.refresh() で deal.stage が 'lost' になった新しい props が
  // 流れてきた瞬間にコンポーネント自体がアンマウントされ、直後に開こうとする CancelBlocksDialog
  // (失注確定→未着手ブロック一括キャンセル提案、00-overview §6.2 / 03-scheduling §5.4) が
  // 表示前後を問わず必ず消えてしまう。「操作」ドロップダウン (受注/失注を選ぶ入口) だけを
  // isTerminal で隠し、LostReasonDialog・CancelBlocksDialog は deal.stage の変化と無関係に
  // 常時マウントしたままにする (deals-kanban.tsx の DealsKanban と同型の設計に揃える)。
  return (
    <>
      {!isTerminal && (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" />}>操作</DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {deal.stage !== "ordered" && (
              <DropdownMenuItem disabled={isOrdering} onClick={() => void handleOrder()}>
                受注にする
              </DropdownMenuItem>
            )}
            <DropdownMenuItem variant="destructive" onClick={() => setLostOpen(true)}>
              失注にする
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <LostReasonDialog open={lostOpen} onOpenChange={setLostOpen} dealTitle={deal.title} onConfirm={handleLost} />
      {cancelBlocksCount !== null && (
        <CancelBlocksDialog
          open={cancelBlocksCount !== null}
          onOpenChange={(open) => !open && setCancelBlocksCount(null)}
          dealId={deal.id}
          count={cancelBlocksCount}
          onCancelled={() => {
            setCancelBlocksCount(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}
