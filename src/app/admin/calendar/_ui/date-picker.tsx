"use client";

import { useState } from "react";
import { CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { formatDateOnlyLabel, type DateOnly } from "./jst-time";

/**
 * popover + calendar + Button の自作 date-picker (03-scheduling.md §10.2)。
 * shadcn に単体の date-picker 部品は存在しない (popover+calendar+Button の組み合わせが公式レシピ)。
 *
 * shadcn Calendar は Date オブジェクトベースだが、このアプリの日付は常に zDateOnly (YYYY-MM-DD)
 * 文字列で受け渡す (実装計画書の地雷 — Date 変換は表示直前のみ)。ブラウザのローカル TZ が
 * JST でない環境でも "YYYY-MM-DD" 文字列 → `new Date(\`${s}T00:00:00\`)` (オフセットなし = ローカル
 * 深夜 0 時) で Calendar に渡し、選択結果は getFullYear/Month/Date (ローカル成分) から
 * YYYY-MM-DD を組み立てて返す。これは「カレンダー UI 上でクリックした日付セル」を
 * そのまま文字列化するだけなので、ブラウザ TZ に関わらず選択した日付と一致する
 * (JST 深夜 0 時への変換はしない — 単なる日付ピッカーの表示/選択ロジックのため)。
 */
export function DatePicker({
  value,
  onSelect,
  disabled,
  placeholder = "日付を選択",
}: {
  value: DateOnly | null;
  onSelect: (dateOnly: DateOnly) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedDate = value ? new Date(`${value}T00:00:00`) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button type="button" variant="outline" size="sm" className="justify-start font-normal">
            <CalendarIcon className="opacity-60" />
            {value ? formatDateOnlyLabel(value) : placeholder}
          </Button>
        }
      />
      <PopoverContent className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={(date) => {
            if (!date) return;
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, "0");
            const d = String(date.getDate()).padStart(2, "0");
            onSelect(`${y}-${m}-${d}`);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
