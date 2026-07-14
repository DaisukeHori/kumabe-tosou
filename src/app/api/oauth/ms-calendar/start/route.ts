import { NextResponse } from "next/server";

import { getEnv, isMsCalendarConfigured } from "@/lib/env";
import { computeCodeChallenge, generateCodeVerifier, generateState } from "@/lib/oauth/pkce";
import { encryptCookiePayload, OAUTH_COOKIE_MAX_AGE_SECONDS } from "@/lib/oauth/state-cookie";
import { getErrorInfo } from "@/modules/platform/errors";
import { platformFacade } from "@/modules/platform/facade";

/**
 * 03-scheduling.md §8.2: Microsoft カレンダー (Graph) OAuth 2.0 (PKCE) 接続開始。
 * google-calendar/start (#54) と同型構成。差分は authority (login.microsoftonline.com/common) と
 * scope (offline_access Calendars.ReadWrite User.Read — §1.4 Microsoft スコープ選定根拠)。
 * Google の access_type=offline & prompt=consent に相当する指定は不要
 * (offline_access スコープを要求するだけで refresh_token が発行される — OAuth 2.0 v2 エンドポイントの仕様)。
 * state / code_verifier は暗号化 httpOnly cookie (TTL 10 分、'kmb_mscal_oauth') に保存する。
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) {
    const info = getErrorInfo(admin.code);
    return NextResponse.json(
      { code: admin.code, message: info.message },
      { status: admin.code === "KMB-E201" ? 401 : 403 },
    );
  }

  if (!isMsCalendarConfigured()) {
    return NextResponse.json(
      { code: "KMB-E901", message: "Microsoft カレンダー連携が設定されていません (env 未設定 or OAUTH_ENABLED=false)" },
      { status: 503 },
    );
  }

  const env = getEnv();
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = computeCodeChallenge(codeVerifier);
  const redirectUri = `${env.NEXT_PUBLIC_SITE_URL}/api/oauth/ms-calendar/callback`;

  const authorizeUrl = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", env.MS_CALENDAR_CLIENT_ID as string);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "offline_access Calendars.ReadWrite User.Read");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  const res = NextResponse.redirect(authorizeUrl.toString());
  res.cookies.set("kmb_mscal_oauth", encryptCookiePayload({ state, codeVerifier }), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
  return res;
}
