"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ADMIN_NAV_ITEMS } from "./nav-items";

/**
 * 左サイドナビのリンク部分 (Client Component)。
 *
 * 旧実装は middleware.ts が積む x-pathname リクエストヘッダを
 * admin/layout.tsx (Server Component) で読んでアクティブ判定していたが、
 * App Router のレイアウトはクライアント遷移 (soft navigation) では
 * 再実行されないため、初回ロード時のパスに固定されて追従しなかった
 * (バグ: メニュー押下後も前のメニューがハイライトされたまま)。
 *
 * usePathname() はクライアント遷移のたびに再評価されるため、ここに切り出して
 * 現在パスを直接取得する。判定ロジックのみ変更し、見た目 (アクティブ時の
 * 背景色クラス等) は既存のものをそのまま流用する。
 */
export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="管理メニュー" className="flex flex-1 flex-col gap-0.5">
      {ADMIN_NAV_ITEMS.map((item) => {
        // ダッシュボード (/admin) は完全一致のみ (他ページで誤点灯しないように)。
        // それ以外は完全一致、または現在パスがそのリンクの子パスである場合に
        // アクティブとする (例: /admin/works と /admin/works/[id] の両方で
        // 「施工事例」をアクティブにする)。
        const isActive =
          item.href === "/admin"
            ? pathname === "/admin"
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={
              "rounded-lg px-3 py-2 text-sm transition-colors " +
              (isActive
                ? "bg-primary text-primary-foreground"
                : "text-foreground/80 hover:bg-muted hover:text-foreground")
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
