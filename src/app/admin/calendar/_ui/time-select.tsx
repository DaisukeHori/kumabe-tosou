"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2, "0")}:${m}`;
});

/** 時刻 Select (30 分刻み、00:00〜23:30。§10.2「配置 (date-picker + 時刻 Select 30 分刻み)」) */
export function TimeSelect({
  value,
  onChange,
  disabled,
}: {
  value: string; // "HH:MM"
  onChange: (hhmm: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      items={OPTIONS.map((hhmm) => ({ value: hhmm, label: hhmm }))}
      value={value}
      onValueChange={(v) => v && onChange(v)}
      disabled={disabled}
    >
      <SelectTrigger className="w-24">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {OPTIONS.map((hhmm) => (
          <SelectItem key={hhmm} value={hhmm}>
            {hhmm}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
