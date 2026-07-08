import { NextResponse } from "next/server";

import { getErrorInfo } from "@/modules/platform/errors";
import { platformFacade } from "@/modules/platform/facade";
import { aiStudioFacade } from "@/modules/ai-studio/facade";
import { zCreateSourceReq } from "@/modules/ai-studio/contracts";

/**
 * 設計書 §3.5: POST /api/ai/sources (admin)。
 * zCreateSourceReq (契約書 §4.7) — input_type='text' の場合は raw_text 必須。
 * input_type='audio' の場合は raw_text=null で作成し、アップロード完了後に
 * /api/transcribe が raw_text を埋める (§7.1 stage 1)。
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
  const parsed = zCreateSourceReq.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "KMB-E101", message: getErrorInfo("KMB-E101").message, issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = await aiStudioFacade.createSource(parsed.data);
  if (!result.ok) {
    const info = getErrorInfo(result.code);
    return NextResponse.json({ code: result.code, message: info.message, detail: result.detail }, { status: 400 });
  }
  return NextResponse.json(result.value);
}
