import { NextResponse } from "next/server";

import { getErrorInfo } from "@/modules/platform/errors";
import { platformFacade } from "@/modules/platform/facade";
import { aiStudioFacade } from "@/modules/ai-studio/facade";
import { zTranscribeReq } from "@/modules/ai-studio/contracts";

/**
 * 設計書 §7.1 stage 1 / §7.3: POST /api/transcribe (admin)。
 * zTranscribeReq {source_id} → OpenAI gpt-4o-transcribe で ai_sources.raw_text を埋める。
 * audio_storage_path は POST /api/ai/sources (input_type='audio') で事前に確定済みであること前提。
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
  const parsed = zTranscribeReq.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "KMB-E101", message: getErrorInfo("KMB-E101").message, issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = await aiStudioFacade.transcribeSource(parsed.data.source_id);
  if (!result.ok) {
    const info = getErrorInfo(result.code);
    return NextResponse.json({ code: result.code, message: info.message, detail: result.detail }, { status: 400 });
  }
  return NextResponse.json({ raw_text: result.value.raw_text });
}
