import { parseTweet } from "twitter-text";

/**
 * X (Twitter) の重み付き文字数。
 * 半角1 / 全角2 / URL は 23 字固定 / 上限は 280 (全角換算 140)。
 * 自作実装は禁止 — 公式 `twitter-text` の parseTweet().weightedLength を
 * 薄く包んだラッパのみ提供する (契約書 §4.4 / 設計書 §8.4)。
 */
export function weightedTweetLength(text: string): number {
  return parseTweet(text).weightedLength;
}
