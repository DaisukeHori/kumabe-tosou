"use client";

import { usePathname } from "next/navigation";

import { resolveHelpSlug } from "@/help/slugs";

/**
 * 「このページの使い方」を別ウィンドウで開く丸い ? ボタン。
 * canonical: docs/design/admin-help/README.md §2。
 *
 * - 現在のパスから resolveHelpSlug で slug を決める。決まらないパスでは何も出さない
 *   (tests/help-slugs.test.ts が全 admin ページで決まることを保証している)。
 * - window.open のウィンドウ名は固定なので、別のページで押しても同じ 1 枚の
 *   ヘルプウィンドウが切り替わる (何枚も開かない)。
 * - PageHeader が自動で右端に出すので、通常はページ側で置く必要はない。
 *   PageHeader を使わないページ (/admin/documents/[id]) だけ個別に置く。
 */
export function HelpButton({ pathname: pathnameProp }: { pathname?: string }) {
  const currentPathname = usePathname();
  const slug = resolveHelpSlug(pathnameProp ?? currentPathname);
  if (!slug) return null;

  return (
    <button
      type="button"
      data-help="help-button"
      aria-label="このページの使い方"
      title="このページの使い方"
      onClick={() => {
        window.open(`/help/${slug}`, "kmb-help", "width=1180,height=920,noopener");
      }}
      className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-card text-sm font-bold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <span aria-hidden="true">?</span>
    </button>
  );
}
