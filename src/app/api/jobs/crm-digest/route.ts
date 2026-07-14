import { after, NextResponse } from "next/server";

import { isJobsSecretConfigured } from "@/lib/env";
import { crmFacade, isDigestEmpty } from "@/modules/crm/facade";
import { createSalesFacade } from "@/modules/sales/facade";

/**
 * 契約書 §7.2 / 00-overview.md §3.6: pg_cron → net.http_post → 本エンドポイント
 * (shared secret ヘッダ x-jobs-secret)。即 202 応答し、next/server の after() で本体を
 * 実行する (pg_net の数秒 timeout に依存しない)。
 * ドメインイベント: crm.digest.due (期限切れ見積の失効処理・未入金請求書等のダイジェスト
 * 通知。07-contracts-delta §D9 が配線所掌 — route 骨格 = crm フェーズ / 配線有効化 =
 * sales フェーズ、との裁定に従う)。
 * 01-crm.md §7.2 手順 + #51 (sales 配線有効化) どおり:
 *   a'. markExpiredQuotes({mode:'service'}) — collectDigest の前に有効期限切れ見積を expired 化
 *      (失敗しても catch して console.error のみ、以降の digest 収集は継続する — markExpiredQuotes
 *      が落ちても crm タスク側のダイジェストは送りたいため)
 *   a. collectDigest({mode:'service'}) — CrmDigest.sales は crmFacade 内では常に null 固定のまま
 *      (crmFacade が SalesFacade を import/参照する設計にはしない — 01-crm §7.2 手順 a の
 *      「crm→sales 依存を作らない」既存設計判断を維持)
 *   a''. getSalesDigest({mode:'service'}) — route (app 層) が両 facade を import して事後マージする
 *      (crm→sales の逆依存を作らずに済む唯一の合成点。失敗時は digest.sales を null のまま
 *      graceful degrade — crm タスク側のダイジェストは送信を継続する)
 *   b. 全リスト空 (sales 含む — isDigestEmpty が #51 で sales 対応済み) なら送信スキップ
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
      const expired = await createSalesFacade().markExpiredQuotes({ mode: "service" });
      if (!expired.ok) {
        console.error(
          "KMB-E901: /api/jobs/crm-digest の markExpiredQuotes に失敗しました",
          expired.code,
          expired.detail,
        );
        // 失敗しても digest 収集自体は続ける (markExpiredQuotes 失敗 ≠ digest 送信不能)。
      }

      const digest = await crmFacade.collectDigest({ mode: "service" });
      if (!digest.ok) {
        console.error("KMB-E901: /api/jobs/crm-digest の collectDigest に失敗しました", digest.code, digest.detail);
        return;
      }

      const salesDigest = await createSalesFacade().getSalesDigest({ mode: "service" });
      if (salesDigest.ok) {
        digest.value.sales = salesDigest.value;
      } else {
        console.error(
          "KMB-E901: /api/jobs/crm-digest の getSalesDigest に失敗しました (digest.sales は null のまま送信を継続します)",
          salesDigest.code,
          salesDigest.detail,
        );
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
