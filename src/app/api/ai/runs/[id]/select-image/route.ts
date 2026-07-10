import { NextResponse } from "next/server";

import { getErrorInfo } from "@/modules/platform/errors";
import { platformFacade } from "@/modules/platform/facade";
import { aiStudioFacade } from "@/modules/ai-studio/facade";
import { zSelectImageReq } from "@/modules/ai-studio/contracts";

/**
 * P4 (ai-studio-v2.md §7): POST /api/ai/runs/{id}/select-image (admin)。
 * image_generation ステージが生成した候補 4 枚から 1 枚を選ぶ (media_id=null は skip)。
 * 選択時は x (thread[0].media_id) / instagram (media_ids) の channel_drafts.content を
 * human revision として更新する (facade.selectRunImage 内で実施)。
 */
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
  const parsed = zSelectImageReq.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "KMB-E101", message: getErrorInfo("KMB-E101").message, issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = await aiStudioFacade.selectRunImage(id, parsed.data.media_id);
  if (!result.ok) {
    const info = getErrorInfo(result.code);
    return NextResponse.json({ code: result.code, message: info.message, detail: result.detail }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
