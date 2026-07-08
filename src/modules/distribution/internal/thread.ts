import type { XExternalRef } from "../contracts";

/**
 * X スレッド投稿の再開ロジック (canonical: 設計書 §8.4 スレッド分割規約 / 契約書 §7.2 予約投稿シーケンス)。
 * last_completed_index = -1 は「未投稿」。途中失敗からの再開は index+1 から。
 * 「投稿は先頭から順に、前ツイートの id を in_reply_to_tweet_id に指定。途中失敗時はそこで停止し、
 *  投稿済み id 群を external_id (JSON) に記録して failed へ」の状態計算を担う純関数群。
 */

export function initialExternalRef(): XExternalRef {
  return { tweet_ids: [], last_completed_index: -1 };
}

/** 次に投稿すべきスレッド内 index (0-based)。全件完了済みなら thread.length と一致する */
export function nextThreadIndex(ref: XExternalRef): number {
  return ref.last_completed_index + 1;
}

/** 直前ツイートの id (in_reply_to_tweet_id)。先頭ツイート (index=0) は null */
export function previousTweetId(ref: XExternalRef, index: number): string | null {
  if (index <= 0) return null;
  return ref.tweet_ids[index - 1] ?? null;
}

/** 1 件投稿成功後の externalRef 更新 (UPDATE の入力値として使う) */
export function appendCompletedTweet(ref: XExternalRef, tweetId: string): XExternalRef {
  return {
    tweet_ids: [...ref.tweet_ids, tweetId],
    last_completed_index: ref.last_completed_index + 1,
  };
}

/** スレッド全件が投稿完了しているか */
export function isThreadComplete(ref: XExternalRef, threadLength: number): boolean {
  return ref.last_completed_index >= threadLength - 1;
}
