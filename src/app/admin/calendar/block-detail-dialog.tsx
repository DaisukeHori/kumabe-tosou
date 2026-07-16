"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { updateDealStageAction } from "@/app/admin/deals/actions";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  zUpdateWorkBlockInput,
  type ExternalDeletionResolution,
  type UpdateWorkBlockInput,
  type WorkBlockView,
  type WorkTypeRow,
} from "@/modules/scheduling/contracts";

import {
  deleteBlockAction,
  placeBlockAction,
  proposeInProductionAction,
  recordActualAction,
  resolveExternalDeletionAction,
  transitionBlockAction,
  unscheduleBlockAction,
  updateBlockAction,
} from "./actions";
import { DatePicker } from "./_ui/date-picker";
import { DealPicker } from "./_ui/deal-picker";
import { formatJstDateLabel, isoPlusHours, isoToJstParts, jstDateTimeToIso, todayJstDateOnly } from "./_ui/jst-time";
import {
  CAN_CANCEL,
  CAN_DELETE,
  CAN_EDIT_DETAIL,
  CAN_PLACE,
  CAN_RECORD_ACTUAL,
  CAN_START,
  CAN_UNSCHEDULE,
  STATUS_LABEL,
} from "./_ui/status-labels";
import { TimeSelect } from "./_ui/time-select";

function toUpdateInput(block: WorkBlockView): UpdateWorkBlockInput {
  return {
    work_type_id: block.work_type_id,
    title: block.title,
    planned_hours: block.planned_hours,
    memo: block.memo,
    deal_id: block.deal_id,
  };
}

export function BlockDetailDialog({
  block,
  open,
  onOpenChange,
  workTypes,
  onChanged,
}: {
  block: WorkBlockView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workTypes: WorkTypeRow[];
  onChanged: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const [placeDate, setPlaceDate] = useState(todayJstDateOnly());
  const [placeTime, setPlaceTime] = useState("09:00");
  const [actualHours, setActualHours] = useState("0");
  const [performedOn, setPerformedOn] = useState(todayJstDateOnly());

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<UpdateWorkBlockInput>({
    resolver: zodResolver(zUpdateWorkBlockInput),
    defaultValues: block ? toUpdateInput(block) : undefined,
  });

  useEffect(() => {
    if (!open || !block) return;
    setServerError(null);
    reset(toUpdateInput(block));
    if (block.starts_at) {
      const parts = isoToJstParts(block.starts_at);
      setPlaceDate(parts.dateOnly);
      setPlaceTime(`${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`);
    } else {
      setPlaceDate(todayJstDateOnly());
      setPlaceTime("09:00");
    }
    setActualHours(String(block.planned_hours || 1));
    setPerformedOn(block.performed_on ?? todayJstDateOnly());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, block?.id, block?.updated_at]);

  if (!block) return null;
  const status = block.status;

  function afterSuccess(message: string) {
    toast.success(message);
    onChanged();
  }

  function onSubmitEdit(values: UpdateWorkBlockInput) {
    if (!block) return;
    setServerError(null);
    startTransition(async () => {
      const result = await updateBlockAction(block.id, values, block.updated_at);
      if (!result.ok) {
        setServerError(result.detail ?? `保存に失敗しました (${result.code})`);
        return;
      }
      afterSuccess("保存しました。");
    });
  }

  function handlePlace() {
    if (!block) return;
    // 「初回配置」判定 (実装計画書 issue-61.md 成果物5): block は既にフルオブジェクトとして
    // scope 内にあるため calendar-board.tsx のように backlog 配列を探索する必要はない。
    const wasBacklog = block.status === "backlog";
    const dealId = block.deal_id;
    const [h, m] = placeTime.split(":").map(Number);
    const startsAt = jstDateTimeToIso(placeDate, h, m);
    const endsAt = isoPlusHours(startsAt, block.planned_hours || 0.5);
    setServerError(null);
    startTransition(async () => {
      const result = await placeBlockAction(block.id, startsAt, endsAt, block.updated_at);
      if (!result.ok) {
        setServerError(result.detail ?? `配置に失敗しました (${result.code})`);
        return;
      }
      afterSuccess("配置しました。");
      if (wasBacklog && dealId) void proposeInProductionAfterPlace(dealId);
    });
  }

  /**
   * ブロック配置成功後の「製作中に進めますか?」提案 (calendar-board.tsx の
   * proposeInProductionIfNeeded と同一ロジック — このダイアログは calendar-board.tsx とは
   * 別コンポーネントとしてマウントされるため、同じ提案トーストをここでも独立して発火する必要がある)。
   */
  async function proposeInProductionAfterPlace(dealId: string) {
    const propose = await proposeInProductionAction(dealId);
    if (!propose.ok || !propose.value.propose) return;
    toast("この案件、製作中に進めますか?", {
      action: {
        label: "はい",
        onClick: () => {
          void updateDealStageAction(dealId, "in_production", propose.value.dealUpdatedAt!).then((r) => {
            if (!r.ok) {
              toast.error(r.detail ?? `変更できませんでした (${r.code})`);
              return;
            }
            toast.success("製作中にしました。");
            router.refresh();
          });
        },
      },
    });
  }

  function handleUnschedule() {
    if (!block) return;
    startTransition(async () => {
      const result = await unscheduleBlockAction(block.id, block.updated_at);
      if (!result.ok) {
        toast.error(result.detail ?? `未配置に戻せませんでした (${result.code})`);
        return;
      }
      afterSuccess("未配置に戻しました。");
    });
  }

  function handleTransition(to: "in_progress" | "cancelled") {
    if (!block) return;
    startTransition(async () => {
      const result = await transitionBlockAction(block.id, to, block.updated_at);
      if (!result.ok) {
        toast.error(result.detail ?? `状態変更に失敗しました (${result.code})`);
        return;
      }
      afterSuccess(to === "in_progress" ? "着手しました。" : "キャンセルしました。");
    });
  }

  function handleDelete() {
    if (!block) return;
    if (!window.confirm("このブロックを削除します。よろしいですか？")) return;
    startTransition(async () => {
      const result = await deleteBlockAction(block.id);
      if (!result.ok) {
        toast.error(result.detail ?? `削除に失敗しました (${result.code})`);
        return;
      }
      toast.success("削除しました。");
      onOpenChange(false);
      onChanged();
    });
  }

  /**
   * deleted_externally (外部カレンダー側で削除された) link の解決 3 択 (03-scheduling.md §10.2
   * 「クリックで解決ダイアログ」/ §9.2 resolveExternalDeletionAction)。#54 レビュー修正で追加:
   * 従来はカレンダー画面上のブロックをクリックしても通常の編集ダイアログが開くだけで、
   * /admin/calendar/connections の「同期の問題」表 (sync-issues-table.tsx) に移動しない限り
   * 解決できなかった。同じ 3 択ロジックをここでも呼べるようにする。
   */
  function handleResolveExternalDeletion(linkId: string, action: ExternalDeletionResolution) {
    if (!block) return;
    startTransition(async () => {
      const result = await resolveExternalDeletionAction(linkId, action);
      if (!result.ok) {
        toast.error(result.detail ?? `解決に失敗しました (${result.code})`);
        return;
      }
      const message =
        action === "unschedule" ? "未配置に戻しました。" : action === "cancel_block" ? "キャンセルしました。" : "再作成を予約しました。";
      afterSuccess(message);
    });
  }

  function handleRecordActual() {
    if (!block) return;
    const hours = Number(actualHours);
    if (!Number.isFinite(hours) || hours < 0) {
      setServerError("実績時間は 0 以上の数値で入力してください。");
      return;
    }
    setServerError(null);
    startTransition(async () => {
      const result = await recordActualAction(block.id, { actual_hours: hours, performed_on: performedOn }, block.updated_at);
      if (!result.ok) {
        setServerError(result.detail ?? `実績の保存に失敗しました (${result.code})`);
        return;
      }
      afterSuccess("実績を保存しました。");
    });
  }

  const diff = block.actual_hours !== null ? block.actual_hours - block.planned_hours : null;
  // deleted_externally は provider ごとに起こり得るが、解決 3 択はブロック単位の操作 (unschedule/
  // cancel_block はブロック本体を動かす) なので最初の 1 件のみを対象にする (§10.2)。
  const deletedExternallyLink = block.sync.find((s) => s.sync_status === "deleted_externally") ?? null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onOpenChange(false); }}>
      <DialogContent
        className="sm:max-w-[560px] shadow-modal"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            if (CAN_EDIT_DETAIL[status]) void handleSubmit(onSubmitEdit)();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {block.title || block.work_type_label}
            <Badge variant="outline">{STATUS_LABEL[status]}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
          {/* ---- 外部削除検知の解決 (deleted_externally, §10.2/§9.2) ---- */}
          {deletedExternallyLink && (
            <div className="space-y-2 rounded-lg border-2 border-dashed border-destructive p-3">
              <p className="text-sm font-medium text-destructive">
                ⚠ 外部カレンダー側で削除されています。どうしますか？
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() => handleResolveExternalDeletion(deletedExternallyLink.link_id, "unschedule")}
                >
                  未配置に戻す
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() => handleResolveExternalDeletion(deletedExternallyLink.link_id, "cancel_block")}
                >
                  キャンセルする
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() => handleResolveExternalDeletion(deletedExternallyLink.link_id, "repush")}
                >
                  作り直して再送
                </Button>
              </div>
            </div>
          )}

          {/* ---- 配置 ---- */}
          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-xs font-medium text-muted-foreground">配置</p>
            {block.starts_at && block.ends_at ? (
              <p className="text-sm">
                {formatJstDateLabel(block.starts_at)} {isoToJstParts(block.starts_at).hour.toString().padStart(2, "0")}:
                {isoToJstParts(block.starts_at).minute.toString().padStart(2, "0")} 〜{" "}
                {isoToJstParts(block.ends_at).hour.toString().padStart(2, "0")}:
                {isoToJstParts(block.ends_at).minute.toString().padStart(2, "0")}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">未配置</p>
            )}
            {CAN_PLACE[status] ? (
              <div className="flex flex-wrap items-center gap-2">
                <DatePicker value={placeDate} onSelect={setPlaceDate} />
                <TimeSelect value={placeTime} onChange={setPlaceTime} />
                <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={handlePlace}>
                  {block.starts_at ? "移動する" : "配置する"}
                </Button>
                {CAN_UNSCHEDULE[status] && (
                  <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={handleUnschedule}>
                    未配置に戻す
                  </Button>
                )}
              </div>
            ) : null}
          </div>

          {/* ---- 編集フォーム ---- */}
          {CAN_EDIT_DETAIL[status] && (
            <form onSubmit={handleSubmit(onSubmitEdit)} noValidate className="space-y-3">
              <FieldGroup>
                <Field>
                  <FieldLabel>案件リンク</FieldLabel>
                  <DealPicker
                    value={watch("deal_id")}
                    selectedLabel={block.deal_title}
                    onChange={(id) => setValue("deal_id", id, { shouldDirty: true })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="blk-work-type">種別</FieldLabel>
                  <Select
                    items={workTypes.map((wt) => ({ value: wt.id, label: wt.label }))}
                    value={watch("work_type_id")}
                    onValueChange={(v) => v && setValue("work_type_id", v, { shouldDirty: true })}
                  >
                    <SelectTrigger id="blk-work-type" className="w-full">
                      <SelectValue />
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
                <Field data-invalid={!!errors.title}>
                  <FieldLabel htmlFor="blk-title">タイトル (空欄=種別名)</FieldLabel>
                  <Input id="blk-title" {...register("title", { setValueAs: (v) => (v === "" ? null : v) })} />
                  <FieldError errors={errors.title ? [errors.title] : undefined} />
                </Field>
                <Field data-invalid={!!errors.planned_hours}>
                  <FieldLabel htmlFor="blk-planned-hours">予定時間 (h)</FieldLabel>
                  <Input
                    id="blk-planned-hours"
                    type="number"
                    step="0.25"
                    min={0}
                    {...register("planned_hours", { valueAsNumber: true })}
                  />
                  <FieldError errors={errors.planned_hours ? [errors.planned_hours] : undefined} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="blk-memo">メモ</FieldLabel>
                  <Textarea id="blk-memo" {...register("memo", { setValueAs: (v) => (v === "" ? null : v) })} />
                </Field>
              </FieldGroup>
              <Button type="submit" size="sm" disabled={isPending}>
                {isPending ? "保存中..." : "編集内容を保存 (Cmd+S)"}
              </Button>
            </form>
          )}

          {/* ---- 状態操作 ---- */}
          <div className="flex flex-wrap gap-2">
            {CAN_START[status] && (
              <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => handleTransition("in_progress")}>
                着手
              </Button>
            )}
            {CAN_CANCEL[status] && (
              <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => handleTransition("cancelled")}>
                キャンセル
              </Button>
            )}
            {CAN_DELETE[status] && (
              <Button type="button" variant="destructive" size="sm" disabled={isPending} onClick={handleDelete}>
                削除
              </Button>
            )}
          </div>

          {/* ---- 実績入力 ---- */}
          {CAN_RECORD_ACTUAL[status] && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <p className="text-xs font-medium text-muted-foreground">
                実績を入れる {status === "done" && "(訂正)"}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="number"
                  step="0.25"
                  min={0}
                  className="w-24"
                  value={actualHours}
                  onChange={(e) => setActualHours(e.target.value)}
                  aria-label="実績時間"
                />
                <span className="text-sm text-muted-foreground">h</span>
                <DatePicker value={performedOn} onSelect={setPerformedOn} placeholder="実施日" />
                <Button type="button" size="sm" disabled={isPending} onClick={handleRecordActual}>
                  実績を保存
                </Button>
              </div>
              {diff !== null && (
                <p className="text-sm">
                  予定 {block.planned_hours.toFixed(1)}h / 実績 {block.actual_hours?.toFixed(1)}h (
                  {diff >= 0 ? "+" : ""}
                  {diff.toFixed(1)}h)
                </p>
              )}
            </div>
          )}

          {serverError && <p className="text-sm text-destructive">{serverError}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            閉じる (Esc)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
