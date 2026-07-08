import { NextResponse } from "next/server";

import { getErrorInfo } from "@/modules/platform/errors";
import { platformFacade } from "@/modules/platform/facade";
import { aiStudioFacade } from "@/modules/ai-studio/facade";
import { zConfirmCleanReq } from "@/modules/ai-studio/contracts";

/**
 * 設計書 §5.3 stage 1.5 確定: POST /api/ai/clean/confirm (admin)。
 * zConfirmCleanReq {source_id, final_text} → ai_sources.cleaned_text を確定する。
 * final_text は人間が raw との差分を見て修正した後の確定テキスト
 * (Claude 整文結果をそのまま採用しても良いし、raw_text をそのまま渡しても良い)。
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
  const parsed = zConfirmCleanReq.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "KMB-E101", message: getErrorInfo("KMB-E101").message, issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = await aiStudioFacade.confirmCleanedText(parsed.data.source_id, parsed.data.final_text);
  if (!result.ok) {
    const info = getErrorInfo(result.code);
    return NextResponse.json({ code: result.code, message: info.message, detail: result.detail }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
