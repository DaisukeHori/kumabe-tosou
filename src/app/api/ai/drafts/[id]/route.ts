import { NextResponse } from "next/server";

import { getErrorInfo } from "@/modules/platform/errors";
import { platformFacade } from "@/modules/platform/facade";
import { aiStudioFacade } from "@/modules/ai-studio/facade";
import { zEditDraftReq } from "@/modules/ai-studio/contracts";

/**
 * 設計書 §3.5: PATCH /api/ai/drafts/{id} (admin)。
 * zEditDraftReq {content: unknown} → draft.channel を DB から引いた後
 * CHANNEL_CONTENT_SCHEMAS[channel] で二段階 parse (facade.editDraft 内で実施)。
 * human revision として draft_revisions に積む。
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
  const parsed = zEditDraftReq.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "KMB-E101", message: getErrorInfo("KMB-E101").message, issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = await aiStudioFacade.editDraft(id, parsed.data.content);
  if (!result.ok) {
    const info = getErrorInfo(result.code);
    return NextResponse.json({ code: result.code, message: info.message, detail: result.detail }, { status: 400 });
  }
  return NextResponse.json(result.value);
}
