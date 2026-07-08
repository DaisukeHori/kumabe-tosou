import { NextResponse } from "next/server";

import { getEnv, isXOAuthConfigured } from "@/lib/env";
import { computeCodeChallenge, generateCodeVerifier, generateState } from "@/lib/oauth/pkce";
import { encryptCookiePayload, OAUTH_COOKIE_MAX_AGE_SECONDS } from "@/lib/oauth/state-cookie";
import { getErrorInfo } from "@/modules/platform/errors";
import { platformFacade } from "@/modules/platform/facade";

/**
 * 契約書 §7.3: X OAuth 2.0 (PKCE) 接続開始。
 * scope: tweet.read tweet.write users.read offline.access (offline.access が refresh token 発行条件)。
 * state / code_verifier は暗号化 httpOnly cookie (TTL 10 分, SameSite=Lax) に保存する。
 */
export async function GET() {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) {
    const info = getErrorInfo(admin.code);
    return NextResponse.json(
      { code: admin.code, message: info.message },
      { status: admin.code === "KMB-E201" ? 401 : 403 },
    );
  }

  if (!isXOAuthConfigured()) {
    return NextResponse.json(
      { code: "KMB-E901", message: "X OAuth が設定されていません (env 未設定 or OAUTH_ENABLED=false)" },
      { status: 503 },
    );
  }

  const env = getEnv();
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = computeCodeChallenge(codeVerifier);
  const redirectUri = `${env.NEXT_PUBLIC_SITE_URL}/api/oauth/x/callback`;

  const authorizeUrl = new URL("https://x.com/i/oauth2/authorize");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", env.X_CLIENT_ID as string);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "tweet.read tweet.write users.read offline.access");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  const res = NextResponse.redirect(authorizeUrl.toString());
  res.cookies.set("kmb_x_oauth", encryptCookiePayload({ state, codeVerifier }), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
  return res;
}
