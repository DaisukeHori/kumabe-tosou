import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getEnv, isXOAuthConfigured } from "@/lib/env";
import { decryptCookiePayload } from "@/lib/oauth/state-cookie";
import { distributionFacade } from "@/modules/distribution/facade";
import { platformFacade } from "@/modules/platform/facade";

/**
 * 契約書 §7.3: X OAuth callback。
 * state 照合 (不一致は KMB-E501) → code + verifier でトークン交換 → Vault 保存 →
 * channel_accounts UPSERT → /admin/channels へリダイレクト。
 */
export async function GET(request: Request) {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }
  if (!isXOAuthConfigured()) {
    return NextResponse.redirect(new URL("/admin/channels?x_error=disabled", request.url));
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const cookieStore = await cookies();
  const raw = cookieStore.get("kmb_x_oauth")?.value ?? null;

  if (!code || !state || !raw) {
    const res = NextResponse.redirect(new URL("/admin/channels?x_error=KMB-E501", request.url));
    res.cookies.delete("kmb_x_oauth");
    return res;
  }

  const payload = decryptCookiePayload<{ state: string; codeVerifier: string }>(raw);
  if (!payload || payload.state !== state) {
    const res = NextResponse.redirect(new URL("/admin/channels?x_error=KMB-E501", request.url));
    res.cookies.delete("kmb_x_oauth");
    return res;
  }

  const env = getEnv();
  const redirectUri = `${env.NEXT_PUBLIC_SITE_URL}/api/oauth/x/callback`;
  const result = await distributionFacade.completeXOAuthCallback({
    code,
    codeVerifier: payload.codeVerifier,
    redirectUri,
  });

  const res = result.ok
    ? NextResponse.redirect(new URL("/admin/channels?x_connected=1", request.url))
    : NextResponse.redirect(new URL(`/admin/channels?x_error=${result.code}`, request.url));
  res.cookies.delete("kmb_x_oauth");
  return res;
}
