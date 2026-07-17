import type { Metadata } from "next";
import { Noto_Sans_JP } from "next/font/google";
import { headers } from "next/headers";

import { Toaster } from "@/components/ui/sonner";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NAV_BADGE_HREFS } from "@/modules/nav-badges/contracts";
import { navBadgesFacade } from "@/modules/nav-badges/facade";

import { AdminNav } from "./admin-nav";
import { logoutAction } from "./actions";

/**
 * [#117 R0] admin 限定の Noto Sans JP。globals.css の `.admin-theme` が
 * `font-family: var(--font-noto-sans-jp)` で参照する。公開サイトの
 * --font-disp / --font-body には一切触れない (admin レイアウト配下だけに付与)。
 */
const notoSansJP = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "隈部塗装 CMS", template: "%s | 隈部塗装 CMS" },
  robots: { index: false, follow: false },
};

/**
 * /admin/** 全体のシェル (設計書 §5.1)。
 * - 左サイドナビ (§5.2 の全画面へのリンク。未実装先もリンクだけ置く)。
 *   ナビのアクティブ判定は AdminNav (Client Component, usePathname) に委譲している
 *   (このレイアウト自体は Server Component でクライアント遷移では再実行されないため、
 *    x-pathname ヘッダーに基づく判定だとハイライトが前のページのまま固定される)。
 * - /admin/login はナビ無しの中央カードレイアウト
 *   (middleware.ts が x-pathname リクエストヘッダを積んでおり、ここで判定する。
 *    Server Component から usePathname は使えないための標準的な回避策。
 *    login ページは常にフルロード/リダイレクト経由でしか到達しないため、
 *    ここでのヘッダー参照はクライアント遷移追従の問題を起こさない)。
 * - 公開サイトとは別トーンのシンプル UI (shadcn)。
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const headerList = await headers();
  const pathname = headerList.get("x-pathname") ?? "";
  const isLoginPage = pathname === "/admin/login";

  if (isLoginPage) {
    return (
      <div
        className={`admin-theme ${notoSansJP.variable} flex min-h-screen items-center justify-center bg-admin-canvas p-6`}
      >
        {children}
        <Toaster />
      </div>
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // [#129 R6c] ナビの未対応件数バッジ (問い合わせ/通話/やること) を server 集計する。
  // 【失敗時非表示縮退】集計が err / タイムアウトでも badgeCounts=undefined を渡すだけで
  // ナビは通常描画される (レイアウトを壊さない)。facade は Result を返し throw しない設計だが、
  // 万一の例外でもシェル全体が落ちないよう try/catch でも二重に囲む (エラーはログのみ)。
  // タイムアウト (NAV_BADGE_TIMEOUT_MS) により、この await が全 admin ページの描画をブロック
  // する時間には上限がある (超過時は縮退)。
  let navBadgeCounts: Record<string, number> | undefined;
  if (user) {
    try {
      const counts = await navBadgesFacade.getNavBadgeCounts();
      if (counts.ok) {
        // href は contracts の NAV_BADGE_HREFS を真実源にする (文字列直書きの分散を排除)。
        navBadgeCounts = {
          [NAV_BADGE_HREFS.inquiries]: counts.value.inquiries,
          [NAV_BADGE_HREFS.calls]: counts.value.calls,
          [NAV_BADGE_HREFS.tasks]: counts.value.tasks,
        };
      } else {
        console.error(
          `[${counts.code}] admin ナビバッジ集計に失敗しました (バッジ非表示に縮退):`,
          counts.detail,
        );
      }
    } catch (err) {
      console.error("admin ナビバッジ集計で予期しない例外 (バッジ非表示に縮退):", err);
    }
  }

  return (
    // admin-shell: 公開サイトのクリーム背景 (--primer) とは別の、CMS ツールらしい
    // 暖色クリーム背景 (--admin-canvas, globals.css で admin 専用に定義)。
    // [#117 R0] .admin-theme スコープ + Noto Sans JP フォント変数をルート要素に付与し、
    // shadcn 標準変数を admin 配下だけ新配色へ上書きする (公開サイトには影響しない)。
    <div className={`admin-theme ${notoSansJP.variable} flex min-h-screen bg-admin-canvas`}>
      {/* [#118 R1] サイドバー: モック準拠で白面 (bg-card) + ロゴバッジ。幅は w-60 据え置き。 */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card p-3">
        <div className="flex items-center gap-2.5 px-3 pt-1 pb-4">
          <div
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent text-sm font-extrabold text-sidebar-accent-foreground"
            aria-hidden="true"
          >
            隈
          </div>
          <div className="leading-tight">
            <p className="text-sm font-extrabold">隈部塗装</p>
            <p className="text-[11px] text-admin-text-meta">しごと管理</p>
          </div>
        </div>
        <AdminNav badgeCounts={navBadgeCounts} />
        <div className="mt-4 border-t border-admin-divider px-3 pt-3">
          <p className="truncate text-xs text-admin-text-meta">{user?.email}</p>
          <form action={logoutAction} className="mt-1.5">
            <button
              type="submit"
              className="rounded-md text-xs text-admin-text-meta underline-offset-2 hover:underline"
            >
              ログアウト
            </button>
          </form>
        </div>
      </aside>
      {/* [#118 R1] main 幅はモック (max-width:1040px; padding:28px 36px 60px) の翻訳を
          ここ 1 箇所で定義する (65rem=1040px, px-9=36px, pt-7=28px, pb-15=60px)。
          flex-grow は付けない — auto マージン (mx-auto) と flex-grow を併用すると
          仕様上グロー係数が 0 扱いになり main が min-content へ縮む。basis auto の
          w-full を残余幅内で shrink させ、max-w で 1040px に丸め mx-auto で中央寄せする。 */}
      <main className="mx-auto w-full max-w-[65rem] overflow-x-hidden px-9 pt-7 pb-15">
        {children}
      </main>
      <Toaster />
    </div>
  );
}
