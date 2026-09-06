import { NextResponse } from "next/server";

import { getEnv } from "@/lib/env";
import { isIntegrationConfigured, resolveIntegrationCredentials } from "@/lib/integration-credentials";
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

  if (!(await isIntegrationConfigured("meta"))) {
    return NextResponse.json(
      {
        code: "KMB-E901",
        message: "Instagram (Meta) の認証情報が未設定か、OAuth 接続が無効です (設定 > 外部連携 で登録してください)",
      },
      { status: 503 },
    );
  }

  const env = getEnv();
  const creds = await resolveIntegrationCredentials("meta");
  const state = generateState();
  const redirectUri = `${env.NEXT_PUBLIC_SITE_URL}/api/oauth/meta/callback`;

  const authorizeUrl = new URL("https://www.facebook.com/v21.0/dialog/oauth");
  authorizeUrl.searchParams.set("client_id", creds.publicId as string);
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
