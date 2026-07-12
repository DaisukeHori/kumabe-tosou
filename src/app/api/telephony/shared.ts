import "server-only";

import { getEnv, isTelephonyConfigured } from "@/lib/env";
import { verifyTwilioSignature } from "@/lib/telephony-signature";

/**
 * telephony webhook 3 本 (voice/status/recording-status) 共通の前処理。
 * canonical: docs/design/crm-suite/04-telephony.md §6.1 手順 1-4
 * (「契約 parse の共通則: status/recording-status も同一」— §6.1 の注記どおり 3 route 共通)。
 *
 * 本ファイルは route.ts ではない (Next.js App Router は厳密なファイル名 "route.ts"/"route.js"
 * のみをルートとして扱うため、この名前の同居ファイルはルーティングに一切影響しない)。
 * `src/modules/telephony/internal/**` を import できないモジュール境界 ESLint の制約下で
 * 3 route 間の重複 (署名検証・body parse) を避けるための共有コード置き場
 * (src/lib/telephony-signature.ts と同じ理由 — 同ファイルの冒頭コメント参照)。
 */

export type VerifiedTelephonyWebhook =
  | { ok: true; params: Record<string, string> }
  | { ok: false; status: number; code: string };

/**
 * 04-telephony.md §6.1 手順 1-4:
 * 1. isTelephonyConfigured() でなければ 503 (KMB-E802)
 * 2. rawBody を URLSearchParams で parse (空値パラメータも脱落させない)
 * 3. 検証 URL = `${NEXT_PUBLIC_SITE_URL}${pathname}${search}` の固定組み立て
 *    (request.url は Vercel プロキシで http/内部ホストになり得るため生の pathname/search
 *    部分のみ抜き出し、ホスト部は必ず env から組み立てる)
 * 4. 署名不一致 → 403 (KMB-E801。console.error のみ・body なし)
 */
export async function verifyTelephonyWebhook(request: Request): Promise<VerifiedTelephonyWebhook> {
  if (!isTelephonyConfigured()) {
    return { ok: false, status: 503, code: "KMB-E802" };
  }

  const rawBody = await request.text();
  const searchParams = new URLSearchParams(rawBody);
  const params: Record<string, string> = {};
  for (const [key, value] of searchParams.entries()) {
    params[key] = value;
  }

  const requestUrl = new URL(request.url);
  const verificationUrl = `${getEnv().NEXT_PUBLIC_SITE_URL}${requestUrl.pathname}${requestUrl.search}`;
  const signatureHeader = request.headers.get("X-Twilio-Signature");
  // isTelephonyConfigured() が true を返した直後のため TWILIO_AUTH_TOKEN は必ず設定済みだが、
  // 型上は string | undefined のため念のため確認する (as で潰さない)。
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken || !verifyTwilioSignature(authToken, signatureHeader, verificationUrl, params)) {
    console.error(`KMB-E801: Twilio 署名検証に失敗しました (${requestUrl.pathname})`);
    return { ok: false, status: 403, code: "KMB-E801" };
  }

  return { ok: true, params };
}

/**
 * 契約キーのみを pick し、欠落キーは null 補完する (§6.1 手順 5 の共通則)。
 * 実 Twilio POST は AccountSid/ApiVersion/Direction/RecordingSource 等 10+ の
 * 未契約パラメータを含むため、`.strict()` 契約に生 Record をそのまま渡すと
 * unrecognized_keys で全 webhook が KMB-E803 になる (地雷)。
 */
export function pickWithNullFill(
  raw: Record<string, string>,
  keys: readonly string[],
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const key of keys) {
    out[key] = key in raw ? raw[key] : null;
  }
  return out;
}
