import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * [#117 R0] 警告/注意パネル。globals.css のステータストークン
 * (--color-status-* / --color-status-*-border / warning-panel) を参照する。
 * 既定は warning (仮画像あり等の注意喚起バナー)。
 */
export type NoticeTone = "warning" | "danger" | "success" | "info";

const TONE_CLASS: Record<NoticeTone, string> = {
  warning:
    "border-status-warning-border bg-status-warning-panel text-status-warning-fg",
  danger: "border-status-danger-border bg-status-urgent-bg text-status-urgent-fg",
  success:
    "border-status-success-border bg-status-success-bg text-status-success-fg",
  info: "border-status-info-fg/25 bg-status-info-bg text-status-info-fg",
};

export function NoticePanel({
  children,
  title,
  tone = "warning",
  icon,
  className,
}: {
  children: ReactNode;
  title?: ReactNode;
  tone?: NoticeTone;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="note"
      className={cn(
        "flex gap-2 rounded-lg border px-4 py-3 text-label",
        TONE_CLASS[tone],
        className,
      )}
    >
      {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
      <div className="min-w-0">
        {title ? <p className="mb-0.5 font-bold">{title}</p> : null}
        <div className="[&_a]:underline [&_a]:underline-offset-2">{children}</div>
      </div>
    </div>
  );
}
