import twitterText from "twitter-text";

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
