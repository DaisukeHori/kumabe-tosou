"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DEAL_STAGE_REGISTRY, type DealStage, type ReopenDealInput } from "@/modules/crm/contracts";

/** zReopenDealInput.to_stage の型 (非終端 7 値のみ) — DealStage (9 値) より狭い */
export type ReopenTargetStage = ReopenDealInput["to_stage"];

/** 再開先として選べる非終端 7 ステージ (01-crm.md §4.2 v1.2 — #102)。zReopenDealInput.to_stage と 1:1 */
const REOPEN_TARGET_STAGES: ReopenTargetStage[] = [
  "inquiry", "estimating", "quote_sent", "ordered", "in_production", "delivered", "invoiced",
];

/** 既定の戻し先: paid→invoiced (直前の請求済みへ) / lost→estimating (作り直しの起点) */
function defaultReopenTarget(fromStage: DealStage): ReopenTargetStage {
  return fromStage === "paid" ? "invoiced" : "estimating";
}

/**
 * 終端ステージ (入金済み/失注) の案件再開 Dialog (01-crm.md §8.3 — #102)。lost-reason-dialog.tsx と
 * 同型 (共用 Dialog + `onConfirm(toStage, reason)` callback 形式)。理由は必須。
 * キーボード: Esc = 閉じる (Radix Dialog 既定)、Cmd/Ctrl+S = 再開 (block-detail-dialog.tsx /
 * CustomerEditSheet.tsx と同型の DialogContent onKeyDown パターン — Textarea 内の Enter は
 * 改行に使うため、確定ショートカットには使わない)。
 */
export function ReopenDealDialog({
  open,
  onOpenChange,
  dealTitle,
  fromStage,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealTitle: string;
  fromStage: DealStage;
  onConfirm: (toStage: ReopenTargetStage, reason: string) => void | Promise<void>;
}) {
  const [toStage, setToStage] = useState<ReopenTargetStage>(defaultReopenTarget(fromStage));
  const [reason, setReason] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dialog を開くたびに現在の終端ステージに応じた既定の戻し先へ揃える (paid/lost の切り替わり対応)
  useEffect(() => {
    if (open) setToStage(defaultReopenTarget(fromStage));
  }, [open, fromStage]);

  async function handleConfirm() {
    if (reason.trim() === "") {
      setError("再開理由を入力してください。");
      return;
    }
    setIsSaving(true);
    setError(null);
    await onConfirm(toStage, reason.trim());
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
      <DialogContent
        className="sm:max-w-[560px] shadow-modal"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            void handleConfirm();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>「{dealTitle}」を再開する</DialogTitle>
          <DialogDescription>
            帳票・入金記録は変更されません。請求書の取消が必要な場合は帳票画面から行ってください (§4.3-C)。
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="reopen-deal-to-stage">戻し先ステージ</FieldLabel>
            <Select
              items={REOPEN_TARGET_STAGES.map((s) => ({ value: s, label: DEAL_STAGE_REGISTRY[s].label }))}
              value={toStage}
              onValueChange={(v) => v && setToStage(v as ReopenTargetStage)}
            >
              <SelectTrigger id="reopen-deal-to-stage" className="w-full" autoFocus>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REOPEN_TARGET_STAGES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {DEAL_STAGE_REGISTRY[s].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="reopen-deal-reason">再開理由 (必須)</FieldLabel>
            <Textarea
              id="reopen-deal-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="例: 誤って入金済みにしてしまった / 請求取消のため差し戻す"
            />
          </Field>
        </FieldGroup>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル (Esc)
          </Button>
          <Button type="button" disabled={isSaving} onClick={() => void handleConfirm()}>
            {isSaving ? "処理中..." : "再開する (Cmd+S)"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
