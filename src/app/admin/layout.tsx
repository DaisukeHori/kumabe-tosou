import type { Metadata } from "next";
import { headers } from "next/headers";

import { Toaster } from "@/components/ui/sonner";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { AdminNav } from "./admin-nav";
import { logoutAction } from "./actions";

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
      <div className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
        {children}
        <Toaster />
      </div>
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    // admin-shell: 公開サイトのクリーム背景 (--primer) とは別の、CMS ツールらしい
    // ニュートラルなグレー背景 (--admin-canvas, globals.css で admin 専用に定義)。
    // 公開サイト側のトークン/見た目には一切影響しない。
    <div className="flex min-h-screen bg-admin-canvas">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-background p-4">
        <div className="mb-6 px-2">
          <p className="font-heading text-sm font-semibold">隈部塗装 CMS</p>
        </div>
        <AdminNav />
        <div className="mt-6 border-t border-border pt-4">
          <p className="truncate px-2 text-xs text-muted-foreground">{user?.email}</p>
          <form action={logoutAction} className="mt-2">
            <button
              type="submit"
              className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              ログアウト
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 overflow-x-hidden p-6 sm:p-8">{children}</main>
      <Toaster />
    </div>
  );
}
