import { NextResponse } from "next/server";

import { getEnv, isGoogleCalendarConfigured } from "@/lib/env";
import { computeCodeChallenge, generateCodeVerifier, generateState } from "@/lib/oauth/pkce";
import { encryptCookiePayload, OAUTH_COOKIE_MAX_AGE_SECONDS } from "@/lib/oauth/state-cookie";
import { getErrorInfo } from "@/modules/platform/errors";
import { platformFacade } from "@/modules/platform/facade";

/**
 * 03-scheduling.md §8.2: Google カレンダー OAuth 2.0 (PKCE) 接続開始。
 * scope: openid email (account_email 取得用 — id_token の email claim から。userinfo/calendarList
 * は呼ばない) + calendar.app.created (アプリ作成カレンダーのみ管理) + calendar.freebusy
 * (主カレンダーの busy 帯表示用)。access_type=offline & prompt=consent で refresh_token を
 * 確実に得る (§8.2 手順4)。state / code_verifier は暗号化 httpOnly cookie (TTL 10 分) に保存する
 * (X OAuth (`/api/oauth/x/start`) と同型の構成)。
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

  if (!isGoogleCalendarConfigured()) {
    return NextResponse.json(
      { code: "KMB-E901", message: "Google カレンダー連携が設定されていません (env 未設定 or OAUTH_ENABLED=false)" },
      { status: 503 },
    );
  }

  const env = getEnv();
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = computeCodeChallenge(codeVerifier);
  const redirectUri = `${env.NEXT_PUBLIC_SITE_URL}/api/oauth/google-calendar/callback`;

  const authorizeUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", env.GOOGLE_CALENDAR_CLIENT_ID as string);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set(
    "scope",
    "openid email https://www.googleapis.com/auth/calendar.app.created https://www.googleapis.com/auth/calendar.freebusy",
  );
  authorizeUrl.searchParams.set("access_type", "offline");
  authorizeUrl.searchParams.set("prompt", "consent");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  const res = NextResponse.redirect(authorizeUrl.toString());
  res.cookies.set("kmb_gcal_oauth", encryptCookiePayload({ state, codeVerifier }), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
  return res;
}
