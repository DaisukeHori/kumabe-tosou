import type { Metadata } from "next";
import { Noto_Sans_JP } from "next/font/google";

import { HelpChromeButtons } from "./help-chrome";

/**
 * /help/** のシェル (docs/design/admin-help/README.md §3)。
 * 管理画面のサイドナビは出さない (ヘルプは別ウィンドウで開くため)。
 * 上部にタイトルと「印刷」「管理画面に戻る」、下に 2 段組 (左: 目次 / 右: 本文) の器を置く。
 * 目次と本文そのものは各ページ (help/[slug]/page.tsx) が HelpToc / HelpRenderer で描く。
 *
 * 色とフォントは管理画面と同じ .admin-theme + Noto Sans JP を使う
 * (ヘルプだけ見た目が変わると別のシステムに見えるため)。
 */
const notoSansJP = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "使い方", template: "%s の使い方 | 山岸塗装 CMS" },
  robots: { index: false, follow: false },
};

/** 印刷時の見え方 (背景色を残し、目次と操作ボタンは省く)。 */
const PRINT_CSS = `
@media print {
  [data-help-chrome], [data-help-toc], [data-help-toc-column] { display: none !important; }
  [data-help-layout] { display: block !important; }
  [data-help-topbar] { position: static !important; border: 0 !important; }
  details > summary { list-style: none; }
  [data-help-doc] { font-size: 11pt; }
  html, body { background: #fff !important; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
}
`;

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`admin-theme ${notoSansJP.variable} min-h-screen bg-admin-canvas`}>
      <style>{PRINT_CSS}</style>
      <header
        data-help-topbar=""
        className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-card px-6 py-3"
      >
        <div className="flex items-center gap-2.5">
          <div
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent text-sm font-extrabold text-sidebar-accent-foreground"
            aria-hidden="true"
          >
            ?
          </div>
          <div className="leading-tight">
            <p className="text-sm font-extrabold text-foreground">山岸塗装 しごと管理</p>
            <p className="text-[11px] text-admin-text-meta">使い方の説明</p>
          </div>
        </div>
        <HelpChromeButtons backHref="/admin" />
      </header>
      <div className="mx-auto w-full max-w-[72rem] px-6 py-6">{children}</div>
    </div>
  );
}
