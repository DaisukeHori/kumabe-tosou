/**
 * NEXT_PUBLIC_SITE_URL を「末尾スラッシュなし」の正規形へ揃える共通ヘルパー。
 *
 * 背景 (telephony 障害): env に `https://example.com/` (末尾スラッシュ付き) を設定すると、
 * Twilio 署名検証 URL (`${SITE_URL}${pathname}`) と TwiML の callback URL
 * (`${SITE_URL}/api/telephony/...`) がともに `https://example.com//api/telephony/...` となり、
 * Twilio が実際に POST した URL (単一スラッシュ) と一致せず全 webhook が KMB-E801 (403) に
 * なる。webhook route (src/app/api/telephony/shared.ts) と telephony facade/twiml の双方が
 * 同じ正規化を通るよう、モジュール非所属の src/lib に置く (src/lib/telephony-signature.ts と
 * 同じ配置判断 — route からは modules/telephony/internal を import できないため)。
 */

/** 末尾のスラッシュを (連続していても) すべて除去する純関数。空文字はそのまま返す。 */
export function normalizeSiteBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}
