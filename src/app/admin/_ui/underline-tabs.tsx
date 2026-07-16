"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * [#117 R0] admin 共通の下線タブ。後続 Issue の SiteSecondaryTabs /
 * CalendarSettingsTabs / settings 等で共用する。
 *
 * usePathname で active タブを自己判定する (既存 calendar/_ui/secondary-tabs.tsx の
 * パターンを一般化)。active 判定は既定で「完全一致 or 配下パス (`${href}/...`)」。
 * exact:true のタブは完全一致のみ active にする (ハブのトップと配下を区別したい場合)。
 */
export type UnderlineTab = {
  href: string;
  label: string;
  exact?: boolean;
};

export function UnderlineTabs({
  tabs,
  ariaLabel,
  className,
}: {
  tabs: readonly UnderlineTab[];
  ariaLabel: string;
  className?: string;
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label={ariaLabel}
      className={cn("flex gap-1 border-b border-border", className)}
    >
      {tabs.map((tab) => {
        const isActive = tab.exact
          ? pathname === tab.href
          : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "border-b-2 px-3 py-2 text-label font-medium transition-colors",
              isActive
                ? "border-primary text-foreground"
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
