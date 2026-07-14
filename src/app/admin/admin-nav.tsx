"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";

import { ADMIN_NAV_GROUPS, type AdminNavItem } from "./nav-items";

const COLLAPSED_STORAGE_KEY = "kumabe-admin-nav-collapsed:v1";

/**
 * 左サイドナビ (Client Component)。#94 でグループ折りたたみ化 (6 セクション)。
 *
 * 旧実装は middleware.ts が積む x-pathname リクエストヘッダを
 * admin/layout.tsx (Server Component) で読んでアクティブ判定していたが、
 * App Router のレイアウトはクライアント遷移 (soft navigation) では
 * 再実行されないため、初回ロード時のパスに固定されて追従しなかった
 * (バグ: メニュー押下後も前のメニューがハイライトされたまま)。
 * usePathname() はクライアント遷移のたびに再評価されるため、アクティブ判定は
 * 必ずここ (Client Component) で行う (layout.tsx 側の判定に戻さない)。
 *
 * shadcn の accordion.tsx (@base-ui/react) は既定スタイルが FAQ 向け
 * (not-last:border-b, hover:underline) でナビに不適合のため使わず、
 * customers-table.tsx の onKeyDown 自前パターンと同系統で実装する。
 */
export function AdminNav() {
  const pathname = usePathname();
  // 初期レンダーは常に全展開 (空集合) にして SSR/CSR を一致させる
  // (hydration mismatch 回避)。localStorage の復元はマウント後の useEffect で行う。
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const navRef = useRef<HTMLElement | null>(null);
  // 現在地追従 (pathname 変化時の自動展開) は「次の遷移から」効かせる。
  // マウント直後 (= localStorage 復元直後) まで含めて強制展開すると、
  // リロード直後に「折りたたみ中のグループに現在地がある」状態を保てなくなるため、
  // 初回だけスキップする。
  const skipNextAutoExpandRef = useRef(true);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setCollapsedIds(new Set(parsed.filter((v): v is string => typeof v === "string")));
        }
      }
    } catch {
      // localStorage 不可 (プライベートブラウズ等) は無視して全展開のまま
    }
  }, []);

  useEffect(() => {
    if (skipNextAutoExpandRef.current) {
      skipNextAutoExpandRef.current = false;
      return;
    }
    const activeGroupId = findActiveGroupId(pathname);
    if (!activeGroupId) return;
    setCollapsedIds((prev) => {
      if (!prev.has(activeGroupId)) return prev;
      const next = new Set(prev);
      next.delete(activeGroupId);
      persistCollapsedIds(next);
      return next;
    });
  }, [pathname]);

  function toggleGroup(groupId: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      persistCollapsedIds(next);
      return next;
    });
  }

  function setGroupCollapsed(groupId: string, collapsed: boolean) {
    setCollapsedIds((prev) => {
      if (prev.has(groupId) === collapsed) return prev;
      const next = new Set(prev);
      if (collapsed) {
        next.add(groupId);
      } else {
        next.delete(groupId);
      }
      persistCollapsedIds(next);
      return next;
    });
  }

  // 可視行 (グループ見出し button + 展開中の Link) の順序リストに対して
  // ↑↓ でフォーカス移動、←→ でフォーカス中の見出しを折りたたみ/展開する
  // (01-crm.md §8.1 共通キーボード規約と整合。Enter/Space はネイティブ挙動に
  // 委譲するためここでは扱わない。Esc・Cmd+S はナビでは no-op)。
  function handleKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const rows = navRef.current
        ? Array.from(navRef.current.querySelectorAll<HTMLElement>("[data-nav-row]"))
        : [];
      if (rows.length === 0) return;
      e.preventDefault();
      const current = document.activeElement as HTMLElement | null;
      const currentIndex = current ? rows.indexOf(current) : -1;
      const nextIndex =
        e.key === "ArrowDown"
          ? Math.min(currentIndex + 1, rows.length - 1)
          : Math.max(currentIndex - 1, 0);
      rows[nextIndex]?.focus();
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const current = document.activeElement as HTMLElement | null;
      const groupId = current?.dataset.navGroupToggle;
      if (!groupId) return;
      e.preventDefault();
      setGroupCollapsed(groupId, e.key === "ArrowLeft");
    }
  }

  return (
    <nav
      ref={navRef}
      aria-label="管理メニュー"
      className="flex flex-1 flex-col gap-1"
      onKeyDown={handleKeyDown}
    >
      {ADMIN_NAV_GROUPS.map((group) => {
        if (group.label === null) {
          return group.items.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} />
          ));
        }

        const panelId = `admin-nav-panel-${group.id}`;
        const isCollapsed = collapsedIds.has(group.id);
        const hasActiveItem = group.items.some((item) => isItemActive(item, pathname));

        return (
          <div key={group.id} className="flex flex-col gap-0.5">
            <button
              type="button"
              data-nav-row=""
              data-nav-group-toggle={group.id}
              aria-expanded={!isCollapsed}
              aria-controls={panelId}
              onClick={() => toggleGroup(group.id)}
              className={
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-left text-xs transition-colors hover:bg-muted " +
                (isCollapsed && hasActiveItem ? "font-semibold text-foreground" : "text-muted-foreground")
              }
            >
              {isCollapsed ? (
                <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
              )}
              {isCollapsed && hasActiveItem && (
                <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
              )}
              <span className="truncate">{group.label}</span>
            </button>
            {!isCollapsed && (
              <div id={panelId} className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <NavLink key={item.href} item={item} pathname={pathname} indent />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function NavLink({
  item,
  pathname,
  indent = false,
}: {
  item: AdminNavItem;
  pathname: string;
  indent?: boolean;
}) {
  const isActive = isItemActive(item, pathname);
  return (
    <Link
      href={item.href}
      data-nav-row=""
      aria-current={isActive ? "page" : undefined}
      className={
        "rounded-lg px-3 py-2 text-sm transition-colors " +
        (indent ? "pl-5 " : "") +
        (isActive
          ? "bg-primary text-primary-foreground"
          : "text-foreground/80 hover:bg-muted hover:text-foreground")
      }
    >
      {item.label}
    </Link>
  );
}

// ダッシュボード (/admin) は完全一致のみ (他ページで誤点灯しないように)。
// それ以外は完全一致、または現在パスがそのリンクの子パスである場合に
// アクティブとする (例: /admin/works と /admin/works/[id] の両方で
// 「施工事例」をアクティブにする)。
function isItemActive(item: AdminNavItem, pathname: string): boolean {
  return item.href === "/admin" ? pathname === "/admin" : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function findActiveGroupId(pathname: string): string | null {
  for (const group of ADMIN_NAV_GROUPS) {
    if (group.label === null) continue; // ダッシュボードは折りたたみ対象外
    if (group.items.some((item) => isItemActive(item, pathname))) return group.id;
  }
  return null;
}

function persistCollapsedIds(ids: Set<string>) {
  try {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // localStorage 不可 (プライベートブラウズ等) は無視 (状態はメモリ上のみ維持)
  }
}
