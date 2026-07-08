import { NextResponse } from "next/server";

import { getErrorInfo } from "@/modules/platform/errors";
import { platformFacade } from "@/modules/platform/facade";
import { aiStudioFacade } from "@/modules/ai-studio/facade";

/**
 * 設計書 §3.5 / §7.1 / §7.6: POST /api/ai/runs/{id}/advance (admin)。
 * 「1 HTTP 呼び出し = 1 stage」。lease CAS → stage 実行 → 成果物 commit + status
 * 前進 + lease 解放 (同一 RPC)。lease が他プロセスに保持されている場合は 409。
 *
 * Vercel maxDuration: 各 stage 単体は §7.5 の見積り (extract 30-60s / research
 * 60-90s / draft 60-120s) に収まる想定だが、Claude の thinking (adaptive) や
 * web_search の再試行込みで長引く可能性を見込み、上限まで確保する。
 */
export const maxDuration = 300;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) {
    const info = getErrorInfo(admin.code);
    return NextResponse.json(
      { code: admin.code, message: info.message },
      { status: admin.code === "KMB-E201" ? 401 : 403 },
    );
  }

  const { id } = await params;
  const outcome = await aiStudioFacade.advanceRunDetailed(id);

  if (outcome.kind === "held") {
    return NextResponse.json(
      { message: "他のプロセスがこの run を処理中です。しばらく待って再試行してください。" },
      { status: 409 },
    );
  }
  if (outcome.kind === "not_found") {
    return NextResponse.json({ code: "KMB-E101", message: "run が見つかりません" }, { status: 404 });
  }
  if (outcome.kind === "error") {
    const info = getErrorInfo(outcome.code);
    return NextResponse.json(
      { code: outcome.code, message: info.message, detail: outcome.detail },
      { status: 400 },
    );
  }
  return NextResponse.json({ status: outcome.status });
}
