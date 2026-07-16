import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * [#117 R0] 反転塗り pill セグメント (フィルタピル)。
 *
 * 現行の一覧フィルタは GET フォーム (クエリパラメータ) で実装されているため、
 * 各ピルは `<Link href>` ベースにして遷移で状態を切り替える (JS 不要・両立)。
 * active なピルは反転塗り (濃色 bg + 明色 text)、非 active は白カード + ミュート文字。
 */
export type PillItem = {
  key: string;
  label: string;
  href: string;
  active?: boolean;
};

export function PillToggle({
  items,
  ariaLabel,
  className,
}: {
  items: readonly PillItem[];
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn("inline-flex flex-wrap items-center gap-1.5", className)}
    >
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.active ? "true" : undefined}
          className={cn(
            "inline-flex items-center rounded-full border px-3 py-1 text-table font-medium transition-colors",
            item.active
              ? "border-foreground bg-foreground text-background"
              : "border-input bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}
