import { NextResponse } from "next/server";

import { captureRouteScreenshot } from "@/lib/screenshot/capture";
import { zScreenshotRequest } from "@/lib/screenshot/route-key";
import { getErrorInfo } from "@/modules/platform/errors";
import { platformFacade } from "@/modules/platform/facade";

/**
 * フルページスクショ Route Handler (canonical: docs/design/ai-studio-v2.md §5 / §11)。
 * POST { routeKey } → 自サイトの公開ルートを fullPage 撮影 → webp base64 + Storage パスを返す。
 * SSRF 対策: URL を直接受け取らず、routeKey (EDITABLE_ROUTES のキー) のみを受理する
 * (実際の検証・URL 組み立ては zScreenshotRequest / captureRouteScreenshot に委譲)。
 * requireAdmin を先頭で必ず呼ぶ (§11「生成系 Server Action / Route Handler はすべて
 * requireAdmin 先頭」)。
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
  const parsed = zScreenshotRequest.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { code: "KMB-E101", message: getErrorInfo("KMB-E101").message, issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const result = await captureRouteScreenshot(parsed.data.routeKey);
  if (!result.ok) {
    const info = getErrorInfo(result.code);
    return NextResponse.json({ code: result.code, message: info.message, detail: result.detail }, { status: 400 });
  }

  return NextResponse.json({
    dataBase64: result.value.dataBase64,
    mimeType: result.value.mimeType,
    storagePath: result.value.storagePath,
  });
}
