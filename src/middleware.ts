import { NextResponse, type NextRequest } from "next/server";

import { updateSupabaseSession } from "@/lib/supabase/middleware";

/**
 * /admin/** および /edit/** の保護 (設計書 §5.1: 未認証は /admin/login へ、
 * §5.3: /edit も同じ保護を適用)。
 *
 * - Supabase セッションの cookie リフレッシュを毎リクエスト行う (updateSupabaseSession)。
 * - /admin/login 自体は保護対象外 (ここに未認証でアクセスできないと詰む)。
 * - 未認証で他の /admin/** or /edit/** にアクセスした場合は /admin/login?next=<元パス> へ
 *   307 リダイレクト。
 * - admin (profiles 存在) かどうかの厳密な判定は各 Server Action / 各ページの
 *   requireAdmin() 呼び出しに委ねる (defense in depth。設計書 §3.5 / §5.3)。
 *   middleware はセッションの有無 (未ログイン) のみを見る軽量ガードとする。
 */
export async function middleware(request: NextRequest) {
  const { supabaseResponse, user } = await updateSupabaseSession(request);

  const { pathname } = request.nextUrl;
  const isLoginRoute = pathname === "/admin/login";

  if (!user && !isLoginRoute) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/admin/login";
    loginUrl.search = "";
    if (pathname !== "/admin") {
      loginUrl.searchParams.set("next", pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  if (user && isLoginRoute) {
    // 既にログイン済みでログイン画面に来た場合はダッシュボードへ。
    const adminUrl = request.nextUrl.clone();
    adminUrl.pathname = "/admin";
    adminUrl.search = "";
    return NextResponse.redirect(adminUrl);
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/admin/:path*", "/edit/:path*"],
};
