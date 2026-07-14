"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * /admin/calendar 系 4 画面共通のセカンダリタブ (03-scheduling.md §10.1)。
 * 予定表 | 作業種別 | テンプレート | 外部連携。
 * `/admin/calendar/connections` は #54 (calendar_connections/calendar_event_links = migration 0030)
 * で実装済み (接続管理 + 同期の問題一覧 — §10.4)。
 */
const TABS = [
  { href: "/admin/calendar", label: "予定表" },
  { href: "/admin/calendar/types", label: "作業種別" },
  { href: "/admin/calendar/templates", label: "テンプレート" },
  { href: "/admin/calendar/connections", label: "外部連携" },
] as const;

export function CalendarSecondaryTabs() {
  const pathname = usePathname();

  return (
    <nav aria-label="カレンダー関連画面" className="flex gap-1 border-b border-border">
      {TABS.map((tab) => {
        const isActive = tab.href === "/admin/calendar" ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "border-soul text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
