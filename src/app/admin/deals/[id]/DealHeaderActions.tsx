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

import { markDealLostAction, updateDealStageAction } from "../actions";
import { LostReasonDialog } from "../lost-reason-dialog";

/**
 * 案件詳細ヘッダの操作 (01-crm.md §8.3): dropdown-menu (「失注にする」→ 理由 Dialog /
 * 「受注にする」→ v1 は updateDealStage のみ。02-sales 配線の帳票発行合成は Phase 3s 以降)。
 */
export function DealHeaderActions({ deal }: { deal: DealDetail }) {
  const router = useRouter();
  const [lostOpen, setLostOpen] = useState(false);
  const [isOrdering, setIsOrdering] = useState(false);

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

  if (isTerminal) return null;

  return (
    <>
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
      <LostReasonDialog open={lostOpen} onOpenChange={setLostOpen} dealTitle={deal.title} onConfirm={handleLost} />
    </>
  );
}
