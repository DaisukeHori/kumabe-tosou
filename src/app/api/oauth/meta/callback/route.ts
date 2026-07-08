import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getEnv, isMetaOAuthConfigured } from "@/lib/env";
import { decryptCookiePayload, encryptCookiePayload, OAUTH_COOKIE_MAX_AGE_SECONDS } from "@/lib/oauth/state-cookie";
import { distributionFacade } from "@/modules/distribution/facade";
import { platformFacade } from "@/modules/platform/facade";

/**
 * 契約書 §7.4: Meta OAuth callback。
 * state 照合 → code → 短期→長期トークン交換 → GET /me/accounts でページ一覧を取得し、
 * ページ選択待ちとして一時 cookie (kmb_meta_pending) に保存 → /admin/channels のページ選択 UI へ。
 * (Instagram business account の解決・最終保存は /admin/channels の Server Action が担う)
 */
export async function GET(request: Request) {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }
  if (!isMetaOAuthConfigured()) {
    return NextResponse.redirect(new URL("/admin/channels?meta_error=disabled", request.url));
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const cookieStore = await cookies();
  const raw = cookieStore.get("kmb_meta_oauth")?.value ?? null;

  if (!code || !state || !raw) {
    const res = NextResponse.redirect(new URL("/admin/channels?meta_error=KMB-E201", request.url));
    res.cookies.delete("kmb_meta_oauth");
    return res;
  }

  const payload = decryptCookiePayload<{ state: string }>(raw);
  if (!payload || payload.state !== state) {
    const res = NextResponse.redirect(new URL("/admin/channels?meta_error=KMB-E201", request.url));
    res.cookies.delete("kmb_meta_oauth");
    return res;
  }

  const env = getEnv();
  const redirectUri = `${env.NEXT_PUBLIC_SITE_URL}/api/oauth/meta/callback`;
  const result = await distributionFacade.exchangeMetaCodeAndListPages({ code, redirectUri });

  if (!result.ok) {
    const res = NextResponse.redirect(new URL(`/admin/channels?meta_error=${result.code}`, request.url));
    res.cookies.delete("kmb_meta_oauth");
    return res;
  }

  const res = NextResponse.redirect(new URL("/admin/channels?meta_select=1", request.url));
  res.cookies.delete("kmb_meta_oauth");
  res.cookies.set(
    "kmb_meta_pending",
    encryptCookiePayload({ pages: result.value.pages, expiresAt: result.value.expiresAt }),
    {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS,
      path: "/",
    },
  );
  return res;
}
