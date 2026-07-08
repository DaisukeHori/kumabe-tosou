import { NextResponse } from "next/server";

import { getErrorInfo } from "@/modules/platform/errors";
import { platformFacade } from "@/modules/platform/facade";
import { aiStudioFacade } from "@/modules/ai-studio/facade";
import { zRegenerateReq } from "@/modules/ai-studio/contracts";

/**
 * 設計書 §3.5 / §5.3: POST /api/ai/drafts/{id}/regenerate (admin)。
 * zRegenerateReq {instruction} → 該当チャネルのみ Claude で再生成し、
 * draft_revisions に ai 版として積む (§5.3「再生成」)。
 */
export const maxDuration = 120;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) {
    const info = getErrorInfo(admin.code);
    return NextResponse.json(
      { code: admin.code, message: info.message },
      { status: admin.code === "KMB-E201" ? 401 : 403 },
    );
  }

  const { id } = await params;
  const json = await request.json().catch(() => null);
  const parsed = zRegenerateReq.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "KMB-E101", message: getErrorInfo("KMB-E101").message, issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = await aiStudioFacade.regenerateDraft(id, parsed.data.instruction);
  if (!result.ok) {
    const info = getErrorInfo(result.code);
    return NextResponse.json({ code: result.code, message: info.message, detail: result.detail }, { status: 400 });
  }
  return NextResponse.json(result.value);
}
