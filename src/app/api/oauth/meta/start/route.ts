import { NextResponse } from "next/server";

import { getEnv, isMetaOAuthConfigured } from "@/lib/env";
import { generateState } from "@/lib/oauth/pkce";
import { encryptCookiePayload, OAUTH_COOKIE_MAX_AGE_SECONDS } from "@/lib/oauth/state-cookie";
import { getErrorInfo } from "@/modules/platform/errors";
import { platformFacade } from "@/modules/platform/facade";

/**
 * 契約書 §7.4: Instagram (Meta) OAuth 接続開始。
 * scope: instagram_business_basic, instagram_business_content_publish, pages_show_list。
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

  if (!isMetaOAuthConfigured()) {
    return NextResponse.json(
      { code: "KMB-E901", message: "Meta OAuth が設定されていません (env 未設定 or OAUTH_ENABLED=false)" },
      { status: 503 },
    );
  }

  const env = getEnv();
  const state = generateState();
  const redirectUri = `${env.NEXT_PUBLIC_SITE_URL}/api/oauth/meta/callback`;

  const authorizeUrl = new URL("https://www.facebook.com/v21.0/dialog/oauth");
  authorizeUrl.searchParams.set("client_id", env.META_APP_ID as string);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set(
    "scope",
    "instagram_business_basic,instagram_business_content_publish,pages_show_list",
  );

  const res = NextResponse.redirect(authorizeUrl.toString());
  res.cookies.set("kmb_meta_oauth", encryptCookiePayload({ state }), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: OAUTH_COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
  return res;
}
