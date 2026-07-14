import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getEnv, isMsCalendarConfigured } from "@/lib/env";
import { decryptCookiePayload } from "@/lib/oauth/state-cookie";
import { platformFacade } from "@/modules/platform/facade";
import { createSchedulingFacade } from "@/modules/scheduling/facade";

/**
 * 03-scheduling.md §8.2: Microsoft カレンダー OAuth callback。
 * google-calendar/callback (#54) と同型構成。state 照合 (不一致は KMB-E720) →
 * schedulingFacade.completeMsCalendarOAuthCallback (facade 経由) に委譲する —
 * route はビジネスロジックを持たない。
 */
export const dynamic = "force-dynamic";

const schedulingFacade = createSchedulingFacade();

export async function GET(request: Request) {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) {
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }
  if (!isMsCalendarConfigured()) {
    return NextResponse.redirect(new URL("/admin/calendar/connections?cal_error=disabled", request.url));
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const cookieStore = await cookies();
  const raw = cookieStore.get("kmb_mscal_oauth")?.value ?? null;

  if (!code || !state || !raw) {
    const res = NextResponse.redirect(new URL("/admin/calendar/connections?cal_error=KMB-E720", request.url));
    res.cookies.delete("kmb_mscal_oauth");
    return res;
  }

  const payload = decryptCookiePayload<{ state: string; codeVerifier: string }>(raw);
  if (!payload || payload.state !== state) {
    const res = NextResponse.redirect(new URL("/admin/calendar/connections?cal_error=KMB-E720", request.url));
    res.cookies.delete("kmb_mscal_oauth");
    return res;
  }

  const env = getEnv();
  const redirectUri = `${env.NEXT_PUBLIC_SITE_URL}/api/oauth/ms-calendar/callback`;
  const result = await schedulingFacade.completeMsCalendarOAuthCallback({
    code,
    codeVerifier: payload.codeVerifier,
    redirectUri,
  });

  const res = result.ok
    ? NextResponse.redirect(new URL("/admin/calendar/connections?cal_connected=microsoft", request.url))
    : NextResponse.redirect(new URL(`/admin/calendar/connections?cal_error=${result.code}`, request.url));
  res.cookies.delete("kmb_mscal_oauth");
  return res;
}
