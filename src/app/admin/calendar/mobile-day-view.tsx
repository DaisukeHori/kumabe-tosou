"use client";

import { useState } from "react";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { WeeklyCapacity, WorkBlockView } from "@/modules/scheduling/contracts";

import { DatePicker } from "./_ui/date-picker";
import {
  addDaysJst,
  formatDateOnlyLabel,
  formatJstTime,
  isoPlusHours,
  jstDateTimeToIso,
  todayJstDateOnly,
  type DateOnly,
} from "./_ui/jst-time";
import { STATUS_LABEL } from "./_ui/status-labels";
import { TimeSelect } from "./_ui/time-select";

/**
 * モバイル幅 (<768px) の日ビュー + リスト (03-scheduling.md §10.6)。
 * 7 日グリッドは描画しない。日送りヘッダ + 当日ブロック札の時刻順リスト + キャパチップ。
 * 未配置トレイは下部アコーディオン。配置はドラッグ不要の代替経路 (「この日に置く」→シート)。
 *
 * 【簡略化した点】§10.6 は「ブロック詳細 Dialog はモバイルでは全画面シート」と指定しているが、
 * この Issue では専用のモバイル用フルスクリーン Sheet は作らず、デスクトップと共通の
 * BlockDetailDialog (base-ui Dialog、max-w 制限あり) をそのまま流用する (機能は完結するが
 * 画面占有率は仕様どおりではない — 安全側の簡略化。openIssues に記載)。
 */
export function MobileDayView({
  date,
  onDateChange,
  dayBlocks,
  backlog,
  capacity,
  onOpenDetail,
  onPlace,
}: {
  date: DateOnly;
  onDateChange: (d: DateOnly) => void;
  dayBlocks: WorkBlockView[];
  backlog: WorkBlockView[];
  capacity: WeeklyCapacity | null;
  onOpenDetail: (id: string) => void;
  onPlace: (blockId: string, startsAtIso: string, endsAtIso: string, expectedUpdatedAt: string) => void;
}) {
  const [placingBlock, setPlacingBlock] = useState<WorkBlockView | null>(null);
  const [placeDate, setPlaceDate] = useState(date);
  const [placeTime, setPlaceTime] = useState("09:00");

  const sorted = [...dayBlocks].sort((a, b) => (a.starts_at ?? "").localeCompare(b.starts_at ?? ""));

  function openPlaceSheet(block: WorkBlockView) {
    setPlacingBlock(block);
    setPlaceDate(date);
    setPlaceTime("09:00");
  }

  function confirmPlace() {
    if (!placingBlock) return;
    const [h, m] = placeTime.split(":").map(Number);
    const startsAt = jstDateTimeToIso(placeDate, h, m);
    const endsAt = isoPlusHours(startsAt, placingBlock.planned_hours || 0.5);
    onPlace(placingBlock.id, startsAt, endsAt, placingBlock.updated_at);
    setPlacingBlock(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="outline" size="icon" aria-label="前日" className="min-h-11 min-w-11" onClick={() => onDateChange(addDaysJst(date, -1))}>
          ◀
        </Button>
        <div className="flex flex-col items-center">
          <span className="text-sm font-medium">{formatDateOnlyLabel(date)}</span>
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => onDateChange(todayJstDateOnly())}>
            今日へ
          </Button>
        </div>
        <Button type="button" variant="outline" size="icon" aria-label="翌日" className="min-h-11 min-w-11" onClick={() => onDateChange(addDaysJst(date, 1))}>
          ▶
        </Button>
      </div>

      {capacity && (
        <div className={`rounded-lg border px-3 py-2 text-center text-sm ${capacity.remaining_hours < 0 ? "border-destructive text-destructive" : "border-border"}`}>
          今週あと {capacity.remaining_hours.toFixed(1)} 時間
        </div>
      )}

      <div className="space-y-2">
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">この日の予定はありません。</p>
        ) : (
          sorted.map((block) => (
            <button
              key={block.id}
              type="button"
              onClick={() => onOpenDetail(block.id)}
              className="min-h-11 w-full rounded-lg border border-border p-3 text-left"
              style={{ borderLeftColor: block.color, borderLeftWidth: 4 }}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {!block.consumes_capacity && "⏳ "}
                  {block.title || block.work_type_label}
                </span>
                <Badge variant="outline">{STATUS_LABEL[block.status]}</Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                {block.starts_at && block.ends_at ? `${formatJstTime(block.starts_at)} 〜 ${formatJstTime(block.ends_at)}` : "時刻未定"} ・{" "}
                {block.planned_hours}h
              </div>
            </button>
          ))
        )}
      </div>

      <Accordion defaultValue={["backlog"]}>
        <AccordionItem value="backlog">
          <AccordionTrigger className="min-h-11">未配置 ({backlog.length})</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-2">
              {backlog.length === 0 ? (
                <p className="text-sm text-muted-foreground">未配置のブロックはありません。</p>
              ) : (
                backlog.map((block) => (
                  <div key={block.id} className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-border p-2">
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpenDetail(block.id)}>
                      <div className="truncate text-sm font-medium">{block.title || block.work_type_label}</div>
                      <div className="text-xs text-muted-foreground">{block.planned_hours}h</div>
                    </button>
                    <Button type="button" size="sm" className="min-h-11" onClick={() => openPlaceSheet(block)}>
                      この日に置く
                    </Button>
                  </div>
                ))
              )}
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <Sheet open={placingBlock !== null} onOpenChange={(open) => { if (!open) setPlacingBlock(null); }}>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>{placingBlock?.title || placingBlock?.work_type_label} を配置</SheetTitle>
          </SheetHeader>
          <div className="flex flex-wrap items-center gap-2 px-4">
            <DatePicker value={placeDate} onSelect={setPlaceDate} />
            <TimeSelect value={placeTime} onChange={setPlaceTime} />
          </div>
          <SheetFooter>
            <Button type="button" className="min-h-11" onClick={confirmPlace}>
              配置する
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
