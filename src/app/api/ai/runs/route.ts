import { NextResponse } from "next/server";

import { distributionFacade } from "@/modules/distribution/facade";
import { getErrorInfo } from "@/modules/platform/errors";
import { platformFacade } from "@/modules/platform/facade";
import { aiStudioFacade } from "@/modules/ai-studio/facade";
import { zStartRunReq } from "@/modules/ai-studio/contracts";

/**
 * 設計書 §3.5 / §7.1: POST /api/ai/runs (admin)。
 * zStartRunReq {source_id, channels, research} → ai_runs INSERT (status=pending)。
 *
 * Issue #20: 「ai-studio モジュールは distribution モジュールに依存できない」制約 (module-
 * contracts.md §2 の依存方向ルール) から、DistributionFacade.getStyleProfiles() (4チャネル
 * 全件の文体プロファイル) を本 route handler (app 層) が取得し、AiStudioFacade.startRun の
 * 引数として渡す合成パターンで解決する (契約書 §5 DistributionFacade.getStyleProfiles の
 * コメントに明記された解消策。Wave2-E で BRAND_SYSTEM_PROMPT 側にハードコードしていた
 * 暫定回避策 [ai-studio/internal/prompts.ts の旧 DEFAULT_STYLE_PROFILES] を解消する)。
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
  const parsed = zStartRunReq.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "KMB-E101", message: getErrorInfo("KMB-E101").message, issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const styleProfilesResult = await distributionFacade.getStyleProfiles();
  if (!styleProfilesResult.ok) {
    const info = getErrorInfo(styleProfilesResult.code);
    return NextResponse.json(
      { code: styleProfilesResult.code, message: info.message, detail: styleProfilesResult.detail },
      { status: 400 },
    );
  }

  const result = await aiStudioFacade.startRun(
    parsed.data.source_id,
    parsed.data.channels,
    parsed.data.research,
    styleProfilesResult.value,
  );
  if (!result.ok) {
    const info = getErrorInfo(result.code);
    return NextResponse.json({ code: result.code, message: info.message, detail: result.detail }, { status: 400 });
  }
  return NextResponse.json(result.value);
}
