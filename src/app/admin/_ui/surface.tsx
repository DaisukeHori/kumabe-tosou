import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * admin 専用の白いサーフェス (カード/コンテナ)。
 *
 * globals.css の --admin-canvas (content 領域のグレー背景) の上に
 * 白いカードとして浮かせるための最小の見た目部品。公開サイトの
 * @/components/ui/card とは独立しており (admin scope 専用)、
 * こちらを変更しても公開サイトの見た目には影響しない。
 *
 * 境界線は共通の --border (薄いグレー、公開サイトのボタン等でも使われる) ではなく
 * admin 専用の --admin-card-border (濃いめ) を使い、shadow も sm→md にして
 * 「背景と同色で見づらい」(2026-07-09 指摘) を解消し、カードの輪郭をくっきりさせる。
 */
export function Surface({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-xl border border-admin-card-border bg-card text-card-foreground shadow-md",
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
