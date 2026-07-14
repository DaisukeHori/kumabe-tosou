"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { WorkTypeRow } from "@/modules/scheduling/contracts";

import { createBlockAction } from "./actions";
import { DatePicker } from "./_ui/date-picker";
import { DealPicker } from "./_ui/deal-picker";
import { isoPlusHours, jstDateTimeToIso, todayJstDateOnly } from "./_ui/jst-time";
import { TimeSelect } from "./_ui/time-select";

export function CreateBlockDialog({
  open,
  onOpenChange,
  workTypes,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workTypes: WorkTypeRow[];
  onCreated: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dealId, setDealId] = useState<string | null>(null);
  const [dealLabel, setDealLabel] = useState<string | null>(null);
  const [workTypeId, setWorkTypeId] = useState(workTypes[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [plannedHours, setPlannedHours] = useState("1");
  const [memo, setMemo] = useState("");
  const [placeNow, setPlaceNow] = useState(false);
  const [placeDate, setPlaceDate] = useState(todayJstDateOnly());
  const [placeTime, setPlaceTime] = useState("09:00");

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDealId(null);
    setDealLabel(null);
    setWorkTypeId(workTypes[0]?.id ?? "");
    setTitle("");
    setPlannedHours("1");
    setMemo("");
    setPlaceNow(false);
    setPlaceDate(todayJstDateOnly());
    setPlaceTime("09:00");
  }, [open, workTypes]);

  function handleSubmit() {
    const hours = Number(plannedHours);
    if (!workTypeId) {
      setError("作業種別を選択してください。");
      return;
    }
    if (!Number.isFinite(hours) || hours < 0) {
      setError("予定時間は 0 以上の数値で入力してください。");
      return;
    }
    let startsAt: string | null = null;
    let endsAt: string | null = null;
    if (placeNow) {
      const [h, m] = placeTime.split(":").map(Number);
      startsAt = jstDateTimeToIso(placeDate, h, m);
      endsAt = isoPlusHours(startsAt, hours || 0.5);
    }
    setError(null);
    startTransition(async () => {
      const result = await createBlockAction({
        deal_id: dealId,
        work_type_id: workTypeId,
        title: title.trim() === "" ? null : title.trim(),
        starts_at: startsAt,
        ends_at: endsAt,
        planned_hours: hours,
        memo: memo.trim() === "" ? null : memo.trim(),
      });
      if (!result.ok) {
        setError(result.detail ?? `作成に失敗しました (${result.code})`);
        return;
      }
      toast.success("作業ブロックを作成しました。");
      onOpenChange(false);
      onCreated();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onOpenChange(false); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>作業ブロックを作る</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <FieldGroup>
            <Field>
              <FieldLabel>案件リンク</FieldLabel>
              <DealPicker value={dealId} selectedLabel={dealLabel} onChange={(id, label) => { setDealId(id); setDealLabel(label); }} />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-blk-type">種別</FieldLabel>
              <Select
                items={workTypes.map((wt) => ({ value: wt.id, label: wt.label }))}
                value={workTypeId || undefined}
                onValueChange={(v) => v && setWorkTypeId(v)}
              >
                <SelectTrigger id="new-blk-type" className="w-full">
                  <SelectValue placeholder="種別を選択" />
                </SelectTrigger>
                <SelectContent>
                  {workTypes.map((wt) => (
                    <SelectItem key={wt.id} value={wt.id}>
                      {wt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="new-blk-title">タイトル (空欄=種別名)</FieldLabel>
              <Input id="new-blk-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-blk-hours">予定時間 (h)</FieldLabel>
              <Input
                id="new-blk-hours"
                type="number"
                step="0.25"
                min={0}
                value={plannedHours}
                onChange={(e) => setPlannedHours(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-blk-memo">メモ</FieldLabel>
              <Textarea id="new-blk-memo" value={memo} onChange={(e) => setMemo(e.target.value)} />
            </Field>
            <Field orientation="horizontal">
              <Checkbox id="new-blk-place-now" checked={placeNow} onCheckedChange={(v) => setPlaceNow(v === true)} />
              <FieldLabel htmlFor="new-blk-place-now">今すぐカレンダーに配置する</FieldLabel>
            </Field>
            {placeNow && (
              <div className="flex flex-wrap items-center gap-2">
                <DatePicker value={placeDate} onSelect={setPlaceDate} />
                <TimeSelect value={placeTime} onChange={setPlaceTime} />
              </div>
            )}
          </FieldGroup>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button type="button" disabled={isPending} onClick={handleSubmit}>
            {isPending ? "作成中..." : "作成する"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
