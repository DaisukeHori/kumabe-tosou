import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { getEnv, isRevalidateSecretConfigured } from "@/lib/env";
import { zRevalidateReq } from "@/modules/platform/contracts";

/**
 * 予約公開の revalidate webhook (cms-ai-pipeline.md §3.5 / §6.1)。
 * pg_cron (毎分) が published_at 到来分を検知して secret 付き POST する想定
 * (`content.scheduled_publish_due` イベント。module-contracts.md §6)。
 *
 * 認可: 共有シークレット (x-revalidate-secret ヘッダ)。REVALIDATE_SECRET が未設定の場合は
 * エンドポイント自体を無効化する (.env.example の記載通り。誰も知り得ない値と比較して
 * 常に不一致にする実装だと「たまたま空文字を送った場合に通る」等の事故を招くため、
 * 未設定を明示的に 503 で表現する)。
 */
export async function POST(request: Request) {
  if (!isRevalidateSecretConfigured()) {
    return NextResponse.json(
      { error: "REVALIDATE_SECRET が未設定のため、このエンドポイントは無効化されています。" },
      { status: 503 },
    );
  }

  const providedSecret = request.headers.get("x-revalidate-secret");
  const env = getEnv();
  if (!providedSecret || providedSecret !== env.REVALIDATE_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = zRevalidateReq.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  for (const tag of parsed.data.tags) {
    revalidateTag(tag);
  }

  return NextResponse.json({ revalidated: parsed.data.tags });
}
