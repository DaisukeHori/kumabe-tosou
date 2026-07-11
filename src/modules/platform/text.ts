// twitter-text は CJS パッケージのため named import は実行時に壊れる (Wave2-E/F 双方で実証)。
// namespace import + next.config.ts の serverExternalPackages: ["twitter-text"] の
// 組み合わせが `next start` 実機検証済みの最終形 (Wave2-F)。
import * as twitterText from "twitter-text";

import { zTelE164 } from "./contracts";

/**
 * X (Twitter) の重み付き文字数。
 * 半角1 / 全角2 / URL は 23 字固定 / 上限は 280 (全角換算 140)。
 * 自作実装は禁止 — 公式 `twitter-text` の parseTweet().weightedLength を
 * 薄く包んだラッパのみ提供する (契約書 §4.4 / 設計書 §8.4)。
 *
 * 実装メモ (Wave2-E で発見・修正。オーケストレーターへ報告済み):
 * `import { parseTweet } from "twitter-text"` は @types/twitter-text の型定義
 * (named export 前提) では型チェックを通るが、実行時は twitter-text パッケージの
 * "module" (ESM) エントリが `export default {...}` のみで named export を
 * 持たないため、Next.js の webpack ビルドで
 * `Attempted import error: 'parseTweet' is not exported from 'twitter-text'`
 * が発生する (vitest 側は別のモジュール解決経路のため気づかれていなかった)。
 * default import + プロパティアクセスに変更することで両方の解決経路
 * (webpack の ESM 解決 / vitest の CJS 互換解決) で動作する。
 */
export function weightedTweetLength(text: string): number {
  return twitterText.parseTweet(text).weightedLength;
}

/**
 * 区切り文字 (半角/全角ハイフン・ダッシュ類・半角/全角スペース・半角/全角括弧) の除去対象。
 * '096-XXX-XXXX' のような表記ゆれ・全角混入を吸収するための正規化文字クラス
 * (zTelE164 / normalizeJpPhoneToE164 — module-contracts.md §4.1 のコメント仕様)。
 */
// 各コードポイントを \u エスケープで明示列挙する (裸の "-" を他の記号と隣接させると
// 意図しないレンジ指定に誤解釈される落とし穴があるため — 実測確認済み)。対象:
// U+0020 半角スペース / U+3000 全角スペース / U+0028,U+0029 半角括弧 /
// U+FF08,U+FF09 全角括弧 / U+002D 半角ハイフンマイナス / U+FF0D 全角ハイフンマイナス /
// U+2011 ノーブレークハイフン / U+2013 en dash / U+2014 em dash / U+2015 水平線 /
// U+2212 マイナス記号 / U+30FC 長音符 (ダッシュ表記の誤用に対応)
const PHONE_SEPARATOR_CHARS =
  /[\u0020\u3000\u0028\u0029\uFF08\uFF09\u002D\uFF0D\u2011\u2013\u2014\u2015\u2212\u30FC]/g;

/**
 * 日本国内表記の電話番号を E.164 (+81...) へ正規化する (platform/contracts.ts zTelE164 のコメント仕様、
 * canonical: docs/module-contracts.md §4.1 / docs/design/crm-suite/00-overview.md §3.5)。
 *
 * 手順:
 * ① 区切り文字 (ハイフン・空白・括弧、全角同等含む) を除去する
 * ② '+' 始まりの入力は E.164 形式検証のみで素通しする (Twilio Voice webhook の From は
 *    既に '+81...' で届く — ここを国内形式前提で実装すると全着信が番号非通知扱いになり
 *    顧客マッチが全滅する)
 * ③ '0[1-9]' 始まりの国内番号は市外局番の桁数に依存せず先頭 0 を除去して '+81' を付与する
 *    (総桁数 10〜11 桁を検証 — 固定電話 096/03/0965 等の 2〜5 桁市外局番も携帯 0X0 も同一規則)
 * ④ 上記以外 ('anonymous'・空文字・検証不合格) は null を返す (= 番号非通知扱い)
 */
export function normalizeJpPhoneToE164(input: string): string | null {
  const stripped = input.replace(PHONE_SEPARATOR_CHARS, "");
  if (stripped.length === 0) return null;

  if (stripped.startsWith("+")) {
    return zTelE164.safeParse(stripped).success ? stripped : null;
  }

  if (/^0[1-9]\d{8,9}$/.test(stripped)) {
    const e164 = `+81${stripped.slice(1)}`;
    return zTelE164.safeParse(e164).success ? e164 : null;
  }

  return null;
}
