import type { ReactNode } from "react";
import Link from "next/link";

import { HelpButton } from "./help-button";

/**
 * admin 全ページ共通のページヘッダー。
 * タイトル + 説明 (任意) + 右上アクション (新規作成ボタン等、任意) の定位置。
 *
 * `backHref` (Issue #96): 詳細ページの「← 一覧へ」戻り導線を共通化する。指定時は `actions` の
 * 先頭に自動でリンクを差し込む (calls/[id]/page.tsx が手書きしていた `<Link>` をこの prop に移行)。
 * `actions` 側で追加のボタン (操作メニュー等) を渡した場合は戻るリンクの後ろに並ぶ。
 *
 * ヘルプ (docs/design/admin-help/README.md §2): 右端に「このページの使い方」の ? ボタンを
 * 常設する。ヘルプ slug が決まらないパスでは HelpButton 自身が null を返すため、
 * ここでは無条件に置いてよい (`showHelp={false}` で個別に消せる)。
 */
export function PageHeader({
  title,
  description,
  actions,
  backHref,
  backLabel = "← 一覧へ",
  showHelp = true,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
  showHelp?: boolean;
}) {
  return (
    <div
      data-help="page-header"
      className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
    >
      <div>
        <h1 className="font-heading text-xl font-semibold text-foreground">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {(backHref || actions || showHelp) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {backHref && (
            <Link href={backHref} className="text-sm underline underline-offset-4">
              {backLabel}
            </Link>
          )}
          {actions}
          {showHelp && <HelpButton />}
        </div>
      )}
    </div>
  );
}
