import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * admin 専用の白いサーフェス (カード/コンテナ)。
 *
 * globals.css の --admin-canvas (content 領域の暖色クリーム背景) の上に
 * 白いカードとして浮かせるための最小の見た目部品。公開サイトの
 * @/components/ui/card とは独立しており (admin scope 専用)、
 * こちらを変更しても公開サイトの見た目には影響しない。
 *
 * [#117 R0] リデザイン基盤トークンへ載せ替え: 角丸は --radius-surface (12px)、
 * 境界線は --border (=#e3dfd9)、影は --shadow-surface (淡い浮き)。
 */
export function Surface({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-surface border border-border bg-card text-card-foreground shadow-surface",
        className,
      )}
      {...props}
    />
  );
}

/**
 * 一覧/テーブルの外枠として使う Surface。中身がグリッド行や <table> の場合、
 * 角丸からのはみ出し (ヘッダ行の背景色など) を overflow-hidden で防ぐ。
 * 横スクロールが必要な `<table>` を包む場合は Surface を直接使うこと
 * (overflow-hidden がスクロールを妨げるため)。
 */
export function DataTableShell({ className, ...props }: ComponentProps<"div">) {
  return <Surface className={cn("overflow-hidden p-0", className)} {...props} />;
}
