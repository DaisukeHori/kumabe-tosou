import { after, NextResponse } from "next/server";

import { isJobsSecretConfigured } from "@/lib/env";

/**
 * 契約書 §7.2 / 00-overview.md §3.6: pg_cron → net.http_post → 本エンドポイント
 * (shared secret ヘッダ x-jobs-secret)。即 202 応答し、next/server の after() で本体を
 * 実行する (pg_net の数秒 timeout に依存しない)。
 * ドメインイベント: calendar.maintenance.due (カレンダー同期の保守処理 — 失効
 * syncToken/deltaLink の再取得や孤立ブロックの整理。03-scheduling が canonical)。
 * TODO(scheduling フェーズ): SchedulingFacade 実装後に after() 内から呼び出す
 * (現時点では scheduling facade 未実装のため import せず no-op — 依存方向を汚さない)。
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
      // TODO(scheduling フェーズ): runCalendarMaintenanceBatch() 相当を呼び出す。
    } catch (err) {
      console.error(
        "KMB-E901: /api/jobs/calendar-maintenance の after() 実行で例外が発生しました",
        err instanceof Error ? err.message : String(err),
      );
    }
  });

  return NextResponse.json({ accepted: true }, { status: 202 });
}
