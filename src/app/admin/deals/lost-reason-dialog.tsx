"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

/**
 * 失注理由 Dialog (01-crm.md §8.3)。カンバンの lost 列ドロップ・案件詳細ヘッダの両方から使う
 * 共用 Dialog (`onConfirm(reason)` callback 形式)。理由は必須 (zMarkDealLostInput.reason は
 * zShortText — 空文字は弾かれる)。
 */
export function LostReasonDialog({
  open,
  onOpenChange,
  dealTitle,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealTitle: string;
  onConfirm: (reason: string) => void | Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (reason.trim() === "") {
      setError("失注理由を入力してください。");
      return;
    }
    setIsSaving(true);
    setError(null);
    await onConfirm(reason.trim());
    setIsSaving(false);
    setReason("");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setReason("");
          setError(null);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>「{dealTitle}」を失注にする</DialogTitle>
          <DialogDescription>失注理由を入力してください (必須)。</DialogDescription>
        </DialogHeader>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="例: 価格が合わなかった"
          autoFocus
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル (Esc)
          </Button>
          <Button type="button" variant="destructive" disabled={isSaving} onClick={() => void handleConfirm()}>
            {isSaving ? "処理中..." : "失注にする"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
