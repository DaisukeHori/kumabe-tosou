"use client";

import { useState } from "react";
import { format, parse } from "date-fns";
import { ja } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * date-picker (shadcn の単体ブロックではなく popover+calendar を組む「レシピ」— #44 実装計画書に
 * 明記のとおり自作)。値は `zDateOnly` (`YYYY-MM-DD`) 文字列 ⇄ 表示は `toLocaleDateString("ja-JP")`。
 *
 * タイムゾーンずれ地雷 (計画書注記): `Date.toISOString().slice(0,10)` は UTC 変換されるため
 * JST 日付がずれる (例: JST 2026-07-12 00:30 → toISOString だと前日 2026-07-11 になる)。
 * ここでは date-fns の `format`/`parse` をローカルタイムゾーンのカレンダー日付として扱う
 * ("yyyy-MM-dd" フォーマットはローカル成分を読み書きするため UTC 変換を経由しない) ことで回避する。
 */
const DATE_ONLY_FORMAT = "yyyy-MM-dd";

type DatePickerProps = {
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-invalid"?: boolean;
};

export function DatePicker({
  value,
  onChange,
  placeholder = "日付を選択",
  disabled,
  className,
  id,
  ...rest
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const selectedDate = value ? parse(value, DATE_ONLY_FORMAT, new Date()) : undefined;
  const isValidDate = selectedDate !== undefined && !Number.isNaN(selectedDate.getTime());

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "w-full justify-start gap-2 font-normal",
              !isValidDate && "text-muted-foreground",
              className,
            )}
            {...rest}
          />
        }
      >
        <CalendarIcon className="size-4 shrink-0" />
        <span className="truncate">{isValidDate ? selectedDate.toLocaleDateString("ja-JP") : placeholder}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          locale={ja}
          selected={isValidDate ? selectedDate : undefined}
          onSelect={(date) => {
            onChange(date ? format(date, DATE_ONLY_FORMAT) : null);
            setOpen(false);
          }}
        />
        {isValidDate && (
          <div className="border-t border-border p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              クリア
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
