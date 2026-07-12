import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Twilio Webhook 署名検証 (X-Twilio-Signature)。
 *
 * canonical: docs/design/crm-suite/04-telephony.md §1.3/§6.1 手順 4。
 * ★重要 (実装方針の変更 — オーケストレーターへ報告済み): 04-telephony.md は
 * `twilio.validateRequest` (twilio npm SDK) の利用を前提に書かれているが、本実装では
 * **twilio パッケージを一切追加・import しない** (依存追加禁止の運用判断)。
 * 代わりに Twilio 公式の署名アルゴリズムを node:crypto で直接実装する:
 *   signature = base64(HMAC-SHA1(url + sorted(params) の key+value 連結, authToken))
 * params はキー名の**辞書順ソート**、各エントリは "key" と "value" を区切り文字なしで
 * 連結し、それを全パラメータ分 url の後ろに繋げたものを HMAC-SHA1 の対象データとする。
 * 比較は crypto.timingSafeEqual (定数時間比較) — 単純な `===` はタイミング攻撃に
 * 弱いため使わない (最重要セキュリティ地雷)。
 *
 * 配置についての注記 (モジュール境界 ESLint との整合): 04-telephony.md §1.2 は
 * `src/modules/telephony/internal/twilio-signature.ts` を想定しているが、
 * eslint.config.mjs の restrictedModuleImportPatterns は「モジュールの internal 配下は
 * 所有モジュール外から import 禁止」を src/app/api 配下を含む全ファイルに適用する
 * (オーバーライドの対象は tests/telephony-*.test.ts と src/modules/telephony 配下のみで、
 * webhook route である src/app/api/telephony/{voice,status,recording-status}/route.ts は
 * 対象外のため)。webhook route は署名検証を facade を経由せず route 自身の責務として
 * 直接行う設計 (§6.1 手順 1-4 は facade 呼び出しより前)。そのため本ヘルパーは
 * モジュール非所属の共有インフラとして src/lib 配下に置く (src/lib/supabase 配下や
 * src/lib/env.ts と同型の判断)。
 */

/** HMAC-SHA1 署名を計算する (テスト用に authToken を明示的に受け取る純関数)。 */
export function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

/**
 * X-Twilio-Signature ヘッダを検証する。
 * - signatureHeader が null (ヘッダ欠落) は常に false。
 * - 長さが異なる場合は timingSafeEqual が例外を投げるため、長さ比較を先に行ってから
 *   定数時間比較に入る (署名文字列の長さそのものは秘匿情報ではないため安全 — Node.js
 *   crypto ドキュメント推奨パターン)。
 */
export function verifyTwilioSignature(
  authToken: string,
  signatureHeader: string | null,
  url: string,
  params: Record<string, string>,
): boolean {
  if (!signatureHeader) return false;

  const expected = computeTwilioSignature(authToken, url, params);
  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(signatureHeader, "utf8");

  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}
