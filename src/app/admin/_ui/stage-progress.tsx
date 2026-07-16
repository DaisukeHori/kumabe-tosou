import { cn } from "@/lib/utils";

/**
 * [#117 R0] 進捗ステップ (見積→受注→製造→請求→入金 のような段階表示)。
 * done は primary 塗り、current は primary 枠、upcoming は淡色。後続 Issue の
 * dealDetail / docDetail 等で共用する。見た目専用 (状態遷移ロジックは持たない)。
 */
export type StageState = "done" | "current" | "upcoming";

export type StageProgressStep = {
  key: string;
  label: string;
  state: StageState;
};

export function StageProgress({
  steps,
  ariaLabel = "進捗",
  className,
}: {
  steps: readonly StageProgressStep[];
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <ol aria-label={ariaLabel} className={cn("flex items-center gap-2", className)}>
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        return (
          <li key={step.key} className="flex flex-1 items-center gap-2">
            <span
              aria-current={step.state === "current" ? "step" : undefined}
              className={cn(
                "inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-meta font-bold",
                step.state === "done" &&
                  "border-primary bg-primary text-primary-foreground",
                step.state === "current" && "border-primary bg-card text-primary",
                step.state === "upcoming" &&
                  "border-input bg-card text-admin-text-faint",
              )}
            >
              {index + 1}
            </span>
            <span
              className={cn(
                "text-label whitespace-nowrap",
                step.state === "upcoming" ? "text-admin-text-faint" : "text-foreground",
              )}
            >
              {step.label}
            </span>
            {!isLast ? (
              <span
                aria-hidden="true"
                className={cn(
                  "h-px flex-1",
                  step.state === "done" ? "bg-primary" : "bg-admin-divider",
                )}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
