import { after, NextResponse } from "next/server";

import { isJobsSecretConfigured } from "@/lib/env";
import { createSchedulingFacade } from "@/modules/scheduling/facade";

/**
 * 契約書 §7.2 / 00-overview.md §3.6: pg_cron → net.http_post → 本エンドポイント
 * (shared secret ヘッダ x-jobs-secret)。即 202 応答し、next/server の after() で本体を
 * 実行する (pg_net の数秒 timeout に依存しない)。
 * ドメインイベント: calendar.sync.due (Google/Microsoft カレンダー双方向同期 — polling 主軸
 * の syncToken/deltaLink 取得。03-scheduling §9.1 が canonical)。
 * runCalendarSync は provider 単位の業務エラー (E720〜E725) を connection/link に記録し
 * ok:true を維持する設計 (§6.1) — ここで !result.ok になるのはインフラ異常のみ。
 */
export const maxDuration = 60;

const schedulingFacade = createSchedulingFacade();

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
      const result = await schedulingFacade.runCalendarSync({ mode: "service" });
      if (!result.ok) {
        console.error("KMB-E901: /api/jobs/calendar-sync の runCalendarSync に失敗しました", result.code, result.detail);
        return;
      }
      console.log(`/api/jobs/calendar-sync: ${JSON.stringify(result.value)}`);
    } catch (err) {
      console.error(
        "KMB-E901: /api/jobs/calendar-sync の after() 実行で例外が発生しました",
        err instanceof Error ? err.message : String(err),
      );
    }
  });

  return NextResponse.json({ accepted: true }, { status: 202 });
}
