import { NextResponse } from "next/server";

import { zScheduleReq } from "@/modules/distribution/contracts";
import { distributionFacade } from "@/modules/distribution/facade";
import { getErrorInfo } from "@/modules/platform/errors";
import { platformFacade } from "@/modules/platform/facade";

/**
 * 設計書 §3.5 / 契約書 §4.7: POST /api/publish/schedule (admin セッション必須)。
 * zScheduleReq (draft 単位)。note は scheduled_at null 必須→即 manual_required、他は null 禁止。
 */
export async function POST(request: Request) {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) {
    const info = getErrorInfo(admin.code);
    return NextResponse.json(
      { code: admin.code, message: info.message },
      { status: admin.code === "KMB-E201" ? 401 : 403 },
    );
  }

  const json = await request.json().catch(() => null);
  const parsed = zScheduleReq.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "KMB-E101", message: getErrorInfo("KMB-E101").message, issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = await distributionFacade.schedulePosts(parsed.data.entries);
  if (!result.ok) {
    const status = result.code === "KMB-E505" ? 409 : result.code === "KMB-E101" ? 400 : 500;
    return NextResponse.json(
      { code: result.code, message: getErrorInfo(result.code).message, detail: result.detail },
      { status },
    );
  }

  return NextResponse.json({ post_ids: result.value.post_ids });
}
