import { NextResponse } from "next/server";

import { getErrorInfo } from "@/modules/platform/errors";
import { platformFacade } from "@/modules/platform/facade";
import { aiStudioFacade } from "@/modules/ai-studio/facade";
import { zCleanReq } from "@/modules/ai-studio/contracts";

/**
 * 設計書 §7.1 stage 1.5 / §3.5: POST /api/ai/clean (admin)。
 * zCleanReq {source_id} → zCleanedTranscript を返す (Claude 整文)。
 *
 * meaning_preserved=false (KMB-E406 相当) でも HTTP 応答は 200 のまま返す。
 * これは Claude 呼び出し自体の失敗ではなく「整文結果を自動採用してよいかの
 * 自己検証」であり、raw との差分表示画面 (§5.3 stage 1.5) で人間が判断する
 * 材料として corrections / meaning_preserved をそのままクライアントに渡す設計
 * (設計書 §9 KMB-E406「raw_text のまま人間修正へフォールバック」を UI 側の
 * 挙動として実装。detail.code で E406 を明示し、クライアントが警告表示する)。
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
  const parsed = zCleanReq.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "KMB-E101", message: getErrorInfo("KMB-E101").message, issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = await aiStudioFacade.cleanSource(parsed.data.source_id);
  if (!result.ok) {
    const info = getErrorInfo(result.code);
    return NextResponse.json({ code: result.code, message: info.message, detail: result.detail }, { status: 400 });
  }

  const body: {
    cleaned_text: string;
    corrections: unknown;
    meaning_preserved: boolean;
    raw_text: string;
    warning_code?: "KMB-E406";
  } = { ...result.value };
  if (!result.value.meaning_preserved) {
    body.warning_code = "KMB-E406";
  }
  return NextResponse.json(body);
}
