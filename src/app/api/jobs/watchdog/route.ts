import { after, NextResponse } from "next/server";

import { isJobsSecretConfigured } from "@/lib/env";
import { runWatchdogSweep } from "@/modules/distribution/facade";

/**
 * 契約書 §7.2 / 設計書 §4.3・§7.6: pg_cron (5 分毎) 起床。
 * publishing のまま 10 分超停滞した channel_posts を manual_required (E506) に倒す。
 * ai_runs の lease 失効スイープは ai-studio 側の facade 実装完了後に自動的に有効化される
 * (現時点では best-effort no-op。オーケストレーターへ契約ギャップとして報告済み)。
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
      const result = await runWatchdogSweep();
      console.log(`/api/jobs/watchdog: ${result.manualRequiredCount} 件を manual_required に倒しました`);
    } catch (err) {
      console.error(
        "KMB-E901: /api/jobs/watchdog の after() 実行で例外が発生しました",
        err instanceof Error ? err.message : String(err),
      );
    }
  });

  return NextResponse.json({ accepted: true }, { status: 202 });
}
