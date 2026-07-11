import { after, NextResponse } from "next/server";

import { isJobsSecretConfigured } from "@/lib/env";
import { crmFacade, isDigestEmpty } from "@/modules/crm/facade";

/**
 * 契約書 §7.2 / 00-overview.md §3.6: pg_cron → net.http_post → 本エンドポイント
 * (shared secret ヘッダ x-jobs-secret)。即 202 応答し、next/server の after() で本体を
 * 実行する (pg_net の数秒 timeout に依存しない)。
 * ドメインイベント: crm.digest.due (期限切れ見積の失効処理・未入金請求書等のダイジェスト
 * 通知。07-contracts-delta §D9 が配線所掌 — route 骨格 = crm フェーズ / 配線有効化 =
 * sales フェーズ、との裁定に従う)。
 * 01-crm.md §7.2 手順どおり:
 *   a. collectDigest({mode:'service'}) — CrmDigest.sales は v1 常に null 固定
 *      (SalesFacade を import/参照しない — #51 が実配線するまでの意図的な骨格)
 *   b. 全リスト空なら送信スキップ
 *   c. sendDailyDigest(digest, {mode:'service'})
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
      const digest = await crmFacade.collectDigest({ mode: "service" });
      if (!digest.ok) {
        console.error("KMB-E901: /api/jobs/crm-digest の collectDigest に失敗しました", digest.code, digest.detail);
        return;
      }

      if (isDigestEmpty(digest.value)) {
        return; // 空メールを毎朝送らない (§7.2 手順 b)
      }

      const sent = await crmFacade.sendDailyDigest(digest.value, { mode: "service" });
      if (!sent.ok) {
        console.error("KMB-E901: /api/jobs/crm-digest の sendDailyDigest に失敗しました", sent.code, sent.detail);
      }
    } catch (err) {
      console.error(
        "KMB-E901: /api/jobs/crm-digest の after() 実行で例外が発生しました",
        err instanceof Error ? err.message : String(err),
      );
    }
  });

  return NextResponse.json({ accepted: true }, { status: 202 });
}
