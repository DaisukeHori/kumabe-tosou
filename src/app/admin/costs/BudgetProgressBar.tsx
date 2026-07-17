import { cn } from "@/lib/utils";

import { budgetProgressRatio } from "./aggregate";

/**
 * 「塗りプログレスバー」の意匠 (components/motion/paint-progress.tsx の
 * 塗り進める見た目のモチーフ) を流用した、静的な塗りバー。
 * ページスクロール追従の JS (PaintProgress) はここでは不要 (値は SSR 時点で確定) なため、
 * 見た目だけを踏襲した最小実装 (track を R0 の --color-admin-well、塗りを bg-primary/bg-destructive) にする。
 * 90% 以上で destructive (admin の警告色) に切り替え、予算逼迫を視覚化する。
 */
export function BudgetProgressBar({
  label,
  usedLabel,
  limitLabel,
  ratio,
}: {
  label: string;
  usedLabel: string;
  limitLabel: string;
  ratio: number;
}) {
  const percent = Math.round(ratio * 100);
  const isNearLimit = ratio >= 0.9;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-foreground">
          {usedLabel} <span className="text-muted-foreground">/ {limitLabel}</span>
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="h-2 w-full overflow-hidden rounded-full bg-admin-well"
      >
        <div
          className={cn("h-full rounded-full transition-[width]", isNearLimit ? "bg-destructive" : "bg-primary")}
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
    </div>
  );
}

/** 予算 (µUSD) 用の便利関数。呼び出し側で reserved+settled を合算してから渡す。 */
export function computeBudgetRatio(usedMicroUsd: number, limitMicroUsd: number): number {
  return budgetProgressRatio(usedMicroUsd, limitMicroUsd);
}
