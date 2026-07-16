import { cn } from "@/lib/utils";

/**
 * [#117 R0] プログレス/使用量バー。track は --color-admin-well、fill は tone 別。
 * 見込み合計バー・予算バー・進捗率など後続 Issue で共用する。
 */
export type MeterTone = "primary" | "success" | "warning";

const FILL_CLASS: Record<MeterTone, string> = {
  primary: "bg-primary",
  success: "bg-status-success-fg",
  warning: "bg-status-warning-fg",
};

export function MeterBar({
  value,
  max = 100,
  tone = "primary",
  label,
  showValue = true,
  className,
}: {
  value: number;
  max?: number;
  tone?: MeterTone;
  label?: string;
  showValue?: boolean;
  className?: string;
}) {
  const ratio = max <= 0 ? 0 : Math.min(1, Math.max(0, value / max));
  const pct = Math.round(ratio * 100);

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {label || showValue ? (
        <div className="flex items-center justify-between text-meta text-admin-text-meta">
          {label ? <span className="truncate">{label}</span> : <span />}
          {showValue ? <span>{pct}%</span> : null}
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
        className="h-2 w-full overflow-hidden rounded-full bg-admin-well"
      >
        <div
          className={cn("h-full rounded-full transition-[width]", FILL_CLASS[tone])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
