"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { DataTableHeaderRow, DataTableShell, dataTableRowClassName } from "@/app/admin/_ui";
import { Badge } from "@/components/ui/badge";
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { InquiryStatus } from "@/modules/inquiry/contracts";
import type { InquiryRow } from "@/modules/inquiry/facade";

import { updateInquiryStatusAction } from "./actions";
import { InquiryLeadButton } from "./InquiryLeadButton";

const STATUS_LABELS: Record<InquiryStatus, string> = {
  new: "未対応",
  in_progress: "対応中",
  done: "完了",
  spam: "スパム",
};

const INQUIRY_TYPE_LABELS: Record<string, string> = {
  construction: "施工依頼",
  estimate: "見積もり相談",
  material: "材料に関する質問",
  other: "その他",
};

// [#120 R3a] 旧 default/destructive/secondary/outline から R0 のステータス 5 系統へ載せ替え。
// 未対応=緊急(赤)、対応中=注意(黄)、完了=成功(緑)、スパム=中立(灰)。
const STATUS_VARIANT: Record<InquiryStatus, "urgent" | "warning" | "success" | "neutral"> = {
  new: "urgent",
  in_progress: "warning",
  done: "success",
  spam: "neutral",
};

// カラム: 届いた日 / お名前 / 内容 / 状態 / リード化 (モック inquiries 準拠)。
// 最終列はリード化ボタン (最長「リード化済み → 案件を開く」) が収まる固定幅。
// ヘッダ行と本文行は別々の grid コンテナのため、揃えるには固定幅トラックにする。
const GRID_COLS = "grid-cols-[160px_140px_minmax(0,1fr)_100px_200px]";

export function InquiriesTable({ items }: { items: InquiryRow[] }) {
  const [focusedIndex, setFocusedIndex] = useState<number>(items.length > 0 ? 0 : -1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<InquiryStatus | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);

  const openItem = useMemo(() => items.find((i) => i.id === openId) ?? null, [items, openId]);

  useEffect(() => {
    if (openId) return; // ダイアログが開いている間は list のキー操作を止める (Select 側の操作を優先)
    function handleKeydown(e: KeyboardEvent) {
      if (items.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(items.length - 1, i < 0 ? 0 : i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(0, i < 0 ? 0 : i - 1));
      } else if (e.key === "Enter") {
        if (focusedIndex >= 0 && items[focusedIndex]) {
          e.preventDefault();
          openDialog(items[focusedIndex].id, items[focusedIndex].status);
        }
      }
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [items, focusedIndex, openId]);

  useEffect(() => {
    rowRefs.current[focusedIndex]?.scrollIntoView({ block: "nearest" });
  }, [focusedIndex]);

  function openDialog(id: string, status: InquiryStatus) {
    setOpenId(id);
    setPendingStatus(status);
  }

  async function handleSave() {
    if (!openItem || !pendingStatus) return;
    setIsSaving(true);
    const result = await updateInquiryStatusAction(openItem.id, pendingStatus);
    setIsSaving(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success("ステータスを更新しました。");
    setOpenId(null);
  }

  return (
    <>
      <DataTableShell>
        <DataTableHeaderRow
          columns={["届いた日", "お名前", "内容", "状態", "リード化"]}
          gridClassName={GRID_COLS}
        />
        <div role="listbox" aria-label="問い合わせ一覧" className="divide-y divide-border">
          {items.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              該当する問い合わせはありません。
            </p>
          )}
          {items.map((item, index) => {
            const typeLabel = INQUIRY_TYPE_LABELS[item.inquiry_type] ?? item.inquiry_type;
            return (
              <div
                key={item.id}
                role="option"
                ref={(el) => {
                  rowRefs.current[index] = el;
                }}
                tabIndex={0}
                onFocus={() => setFocusedIndex(index)}
                onClick={() => openDialog(item.id, item.status)}
                aria-selected={focusedIndex === index}
                className={`grid cursor-pointer items-center gap-4 px-4 py-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 ${GRID_COLS} ${dataTableRowClassName(
                  focusedIndex === index,
                )}`}
              >
                <div className="text-xs whitespace-nowrap text-muted-foreground">
                  {new Date(item.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                </div>
                <div className="min-w-0 truncate font-medium">{item.name}</div>
                <div className="min-w-0 truncate text-foreground">
                  <span className="text-muted-foreground">【{typeLabel}】</span>
                  {item.body}
                </div>
                <div>
                  <Badge variant={STATUS_VARIANT[item.status]}>{STATUS_LABELS[item.status]}</Badge>
                </div>
                <div onClick={(e) => e.stopPropagation()}>
                  <InquiryLeadButton
                    inquiryId={item.id}
                    name={item.name}
                    email={item.email}
                    tel={item.tel}
                    inquiryType={item.inquiry_type}
                    body={item.body}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </DataTableShell>

      <Dialog
        open={!!openItem}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
      >
        <DialogContent
          className="max-w-[560px]"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
              e.preventDefault();
              void handleSave();
            }
          }}
        >
          {openItem && (
            <>
              <DialogHeader>
                <DialogTitle>{openItem.name} 様からのお問い合わせ</DialogTitle>
                <DialogDescription>
                  {INQUIRY_TYPE_LABELS[openItem.inquiry_type] ?? openItem.inquiry_type} ・{" "}
                  {new Date(openItem.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                  {openItem.email ? ` ・ ${openItem.email}` : ""}
                  {openItem.tel ? ` ・ ${openItem.tel}` : ""}
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-3 text-sm">
                {openItem.item && (
                  <p>
                    <span className="text-muted-foreground">対象品目: </span>
                    {openItem.item}
                  </p>
                )}
                <p className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-foreground">{openItem.body}</p>

                <div>
                  <InquiryLeadButton
                    inquiryId={openItem.id}
                    name={openItem.name}
                    email={openItem.email}
                    tel={openItem.tel}
                    inquiryType={openItem.inquiry_type}
                    body={openItem.body}
                  />
                </div>

                <div className="mt-2">
                  <label className="mb-1 block text-xs text-muted-foreground">状態</label>
                  <Select
                    items={(Object.keys(STATUS_LABELS) as InquiryStatus[]).map((s) => ({
                      value: s,
                      label: STATUS_LABELS[s],
                    }))}
                    value={pendingStatus}
                    onValueChange={(v) => setPendingStatus(v as InquiryStatus)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {(Object.keys(STATUS_LABELS) as InquiryStatus[]).map((s) => (
                          <SelectItem key={s} value={s}>
                            {STATUS_LABELS[s]}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setOpenId(null)}>
                  閉じる (Esc)
                </Button>
                <Button onClick={handleSave} disabled={isSaving}>
                  {isSaving ? "保存中..." : "保存 (Cmd+S)"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
