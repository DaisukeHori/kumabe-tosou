import { after, NextResponse } from "next/server";

import { isJobsSecretConfigured } from "@/lib/env";
import { cleanupAiDraftMedia } from "@/modules/ai-providers/facade";

/**
 * ai-studio-v2.md §4: 選択されなかった AI 生成画像 (tags: ai-draft, is_selected=false) を
 * 7 日経過 + 参照ゼロで自動削除する。契約書 §7.2 と同型の shared secret 認証
 * (pg_cron → net.http_post → 本エンドポイント。migration 20260710000016 が
 * 毎日 18:00 UTC に起床する)。/api/jobs/publish と同じく即 202 応答し、after() で本体を実行する。
 */
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!isJobsSecretConfigured()) {
    return NextResponse.json({ code: "KMB-E901", message: "JOBS_SECRET が未設定です" }, { status: 503 });
  }

  const provided = request.headers.get("x-jobs-secret");
  if (!provided || provided !== process.env.JOBS_SECRET) {
    return NextResponse.json({ code: "KMB-E201", message: "認証に失敗しました" }, { status: 401 });
  }

  after(async () => {
    try {
      const result = await cleanupAiDraftMedia();
      console.log(`/api/jobs/cleanup-ai-drafts: ${result.processed} 件削除しました (失敗 ${result.failed} 件)`);
    } catch (err) {
      console.error(
        "KMB-E901: /api/jobs/cleanup-ai-drafts の after() 実行で例外が発生しました",
        err instanceof Error ? err.message : String(err),
      );
    }
  });

  return NextResponse.json({ accepted: true }, { status: 202 });
}
