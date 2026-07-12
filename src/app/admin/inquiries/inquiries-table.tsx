"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Surface } from "@/app/admin/_ui";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
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

function statusBadgeVariant(status: InquiryStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "new") return "default";
  if (status === "spam") return "destructive";
  if (status === "done") return "secondary";
  return "outline";
}

export function InquiriesTable({ items }: { items: InquiryRow[] }) {
  const [focusedIndex, setFocusedIndex] = useState<number>(items.length > 0 ? 0 : -1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<InquiryStatus | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);

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
      <Surface className="overflow-x-auto p-0">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>受信日時</TableHead>
              <TableHead>お名前</TableHead>
              <TableHead>種別</TableHead>
              <TableHead>メール</TableHead>
              <TableHead>ステータス</TableHead>
              <TableHead>リード化</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  該当する問い合わせはありません。
                </TableCell>
              </TableRow>
            )}
            {items.map((item, index) => (
              <TableRow
                key={item.id}
                ref={(el) => {
                  rowRefs.current[index] = el;
                }}
                tabIndex={0}
                onFocus={() => setFocusedIndex(index)}
                onClick={() => openDialog(item.id, item.status)}
                aria-selected={focusedIndex === index}
                className={cn(
                  "cursor-pointer border-l-4 outline-none",
                  focusedIndex === index
                    ? "border-l-soul bg-soul/5"
                    : "border-l-transparent",
                )}
              >
                <TableCell>
                  {new Date(item.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                </TableCell>
                <TableCell>{item.name}</TableCell>
                <TableCell>{INQUIRY_TYPE_LABELS[item.inquiry_type] ?? item.inquiry_type}</TableCell>
                <TableCell>{item.email}</TableCell>
                <TableCell>
                  <Badge variant={statusBadgeVariant(item.status)}>{STATUS_LABELS[item.status]}</Badge>
                </TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <InquiryLeadButton
                    inquiryId={item.id}
                    name={item.name}
                    email={item.email}
                    tel={item.tel}
                    inquiryType={item.inquiry_type}
                    body={item.body}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Surface>

      <Dialog
        open={!!openItem}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
      >
        <DialogContent
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
                  {INQUIRY_TYPE_LABELS[openItem.inquiry_type] ?? openItem.inquiry_type} /{" "}
                  {new Date(openItem.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-3 text-sm">
                <p>
                  <span className="text-muted-foreground">メール: </span>
                  {openItem.email}
                </p>
                {openItem.tel && (
                  <p>
                    <span className="text-muted-foreground">電話: </span>
                    {openItem.tel}
                  </p>
                )}
                {openItem.item && (
                  <p>
                    <span className="text-muted-foreground">対象品目: </span>
                    {openItem.item}
                  </p>
                )}
                <p className="whitespace-pre-wrap rounded-lg bg-muted p-3">{openItem.body}</p>

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
                  <label className="mb-1 block text-xs text-muted-foreground">ステータス</label>
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
