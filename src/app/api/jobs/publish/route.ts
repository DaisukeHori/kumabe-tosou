import { after, NextResponse } from "next/server";

import { isJobsSecretConfigured } from "@/lib/env";
import { runPublishWorkerBatch } from "@/modules/distribution/facade";

/**
 * 契約書 §7.2: pg_cron (毎分) → net.http_post → 本エンドポイント (shared secret ヘッダ x-jobs-secret)。
 * 即 202 応答し、next/server の after() で本体を実行する (pg_net の数秒 timeout に依存しない。
 * 設計書 §7.5)。1 回の起動で最大 5 件処理 (X rate limit 保護)。
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
      const result = await runPublishWorkerBatch();
      console.log(`/api/jobs/publish: ${result.processed} 件処理しました`);
    } catch (err) {
      console.error(
        "KMB-E901: /api/jobs/publish の after() 実行で例外が発生しました",
        err instanceof Error ? err.message : String(err),
      );
    }
  });

  return NextResponse.json({ accepted: true }, { status: 202 });
}
