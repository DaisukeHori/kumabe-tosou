import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getEnv, isGoogleCalendarConfigured } from "@/lib/env";
import { decryptCookiePayload } from "@/lib/oauth/state-cookie";
import { platformFacade } from "@/modules/platform/facade";
import { createSchedulingFacade } from "@/modules/scheduling/facade";

/**
 * 03-scheduling.md §8.2: Google カレンダー OAuth callback。
 * state 照合 (不一致は KMB-E720) → コード交換・アプリ専用カレンダー準備・Vault 保存・
 * calendar_connections UPSERT は schedulingFacade.completeGoogleCalendarOAuthCallback (facade
 * 経由) に委譲する — route はビジネスロジックを持たない (distribution の x/callback と同型)。
 */
export const dynamic = "force-dynamic";

const schedulingFacade = createSchedulingFacade();

export async function GET(request: Request) {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }
  if (!isGoogleCalendarConfigured()) {
    return NextResponse.redirect(new URL("/admin/calendar/connections?cal_error=disabled", request.url));
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const cookieStore = await cookies();
  const raw = cookieStore.get("kmb_gcal_oauth")?.value ?? null;

  if (!code || !state || !raw) {
    const res = NextResponse.redirect(new URL("/admin/calendar/connections?cal_error=KMB-E720", request.url));
    res.cookies.delete("kmb_gcal_oauth");
    return res;
  }

  const payload = decryptCookiePayload<{ state: string; codeVerifier: string }>(raw);
  if (!payload || payload.state !== state) {
    const res = NextResponse.redirect(new URL("/admin/calendar/connections?cal_error=KMB-E720", request.url));
    res.cookies.delete("kmb_gcal_oauth");
    return res;
  }

  const env = getEnv();
  const redirectUri = `${env.NEXT_PUBLIC_SITE_URL}/api/oauth/google-calendar/callback`;
  const result = await schedulingFacade.completeGoogleCalendarOAuthCallback({
    code,
    codeVerifier: payload.codeVerifier,
    redirectUri,
  });

  const res = result.ok
    ? NextResponse.redirect(new URL("/admin/calendar/connections?cal_connected=google", request.url))
    : NextResponse.redirect(new URL(`/admin/calendar/connections?cal_error=${result.code}`, request.url));
  res.cookies.delete("kmb_gcal_oauth");
  return res;
}
