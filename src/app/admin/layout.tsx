import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";

import { Toaster } from "@/components/ui/sonner";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { logoutAction } from "./actions";
import { ADMIN_NAV_ITEMS } from "./nav-items";

export const metadata: Metadata = {
  title: { default: "隈部塗装 CMS", template: "%s | 隈部塗装 CMS" },
  robots: { index: false, follow: false },
};

/**
 * /admin/** 全体のシェル (設計書 §5.1)。
 * - 左サイドナビ (§5.2 の全画面へのリンク。未実装先もリンクだけ置く)。
 * - /admin/login はナビ無しの中央カードレイアウト
 *   (middleware.ts が x-pathname リクエストヘッダを積んでおり、ここで判定する。
 *    Server Component から usePathname は使えないための標準的な回避策)。
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
    <div className="flex min-h-screen bg-muted/20">
      <aside className="flex w-60 shrink-0 flex-col border-r bg-background p-4">
        <div className="mb-6 px-2">
          <p className="font-heading text-sm font-semibold">隈部塗装 CMS</p>
        </div>
        <nav aria-label="管理メニュー" className="flex flex-1 flex-col gap-0.5">
          {ADMIN_NAV_ITEMS.map((item) => {
            const isActive =
              item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
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
        <div className="mt-6 border-t pt-4">
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
