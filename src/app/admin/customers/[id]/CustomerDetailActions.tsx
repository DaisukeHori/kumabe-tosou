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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EntityPicker, type EntityPickerItem } from "@/app/admin/_ui/entity-picker";
import { searchCustomersAction } from "@/app/admin/_ui/entity-search-actions";
import type { CustomerDetail } from "@/modules/crm/contracts";

import { mergeCustomersAction, updateCustomerAction } from "../actions";

/**
 * 顧客詳細ページの操作メニュー (01-crm.md §8.2): 「重複を統合」→ 統合 Dialog
 * (相手を command 検索 → 確認 → mergeCustomersAction。**この顧客を統合先 (winner) とする**
 * — 詳細ページを開いている顧客が「残る側」という UX 上自然な向き)。「アーカイブ」→
 * updateCustomerAction(lifecycle='archived')。
 */
export function CustomerDetailActions({ customer }: { customer: CustomerDetail }) {
  const router = useRouter();
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<EntityPickerItem | null>(null);
  const [isMerging, setIsMerging] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);

  const isSelf = mergeTarget?.id === customer.id;

  async function handleMerge() {
    if (!mergeTarget || isSelf) return;
    setIsMerging(true);
    const result = await mergeCustomersAction({ winner_id: customer.id, loser_id: mergeTarget.id }, customer.updated_at);
    setIsMerging(false);
    if (!result.ok) {
      if (result.code === "KMB-E103") {
        toast.error("他の操作でこの顧客が更新されています。再読み込みしてください。");
      } else {
        toast.error(result.detail ?? "統合に失敗しました。");
      }
      return;
    }
    toast.success("統合しました。");
    setMergeOpen(false);
    setMergeTarget(null);
    router.refresh();
  }

  async function handleArchive() {
    setIsArchiving(true);
    const result = await updateCustomerAction(
      customer.id,
      {
        kind: customer.kind,
        name: customer.name,
        name_kana: customer.name_kana,
        email: customer.email,
        tel_raw: customer.tel_e164,
        company_id: customer.company_id,
        address: customer.address,
        notes: customer.notes,
        lifecycle: "archived",
        custom_fields: customer.custom_fields,
        // 請求先/配送先は read-modify-write で保持する (tel_e164 → tel_raw のフォーム形へ写す)。
        billing_info: customer.billing_info
          ? {
              postal_code: customer.billing_info.postal_code,
              address: customer.billing_info.address,
              tel_raw: customer.billing_info.tel_e164,
              name: customer.billing_info.name,
              suffix: customer.billing_info.suffix,
            }
          : null,
        shipping_info: customer.shipping_info
          ? {
              postal_code: customer.shipping_info.postal_code,
              address: customer.shipping_info.address,
              tel_raw: customer.shipping_info.tel_e164,
              name: customer.shipping_info.name,
              suffix: customer.shipping_info.suffix,
            }
          : null,
      },
      customer.updated_at,
    );
    setIsArchiving(false);
    if (!result.ok) {
      toast.error(result.detail ?? "アーカイブに失敗しました。");
      return;
    }
    toast.success("アーカイブしました。");
    router.refresh();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" />}>操作</DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setMergeOpen(true)}>重複を統合</DropdownMenuItem>
          <DropdownMenuItem variant="destructive" disabled={isArchiving} onClick={() => void handleArchive()}>
            アーカイブ
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重複顧客を統合</DialogTitle>
            <DialogDescription>
              選んだ顧客をこの顧客 ({customer.name}) に統合します。統合すると選んだ顧客の案件・タスク・記録がこちらへ移り、選んだ顧客はアーカイブされます。この操作は取り消せません。
            </DialogDescription>
          </DialogHeader>
          <EntityPicker
            value={mergeTarget}
            onChange={setMergeTarget}
            search={searchCustomersAction}
            placeholder="統合する顧客 (消える側) を検索"
          />
          {isSelf && <p className="text-sm text-destructive">同一の顧客は選べません。</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMergeOpen(false)}>
              キャンセル
            </Button>
            <Button type="button" variant="destructive" disabled={!mergeTarget || isSelf || isMerging} onClick={() => void handleMerge()}>
              {isMerging ? "統合中..." : "統合する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
