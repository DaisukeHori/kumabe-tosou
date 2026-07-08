import { describe, expect, it } from "vitest";

import {
  appendCompletedTweet,
  initialExternalRef,
  isThreadComplete,
  nextThreadIndex,
  previousTweetId,
} from "@/modules/distribution/internal/thread";

/**
 * canonical: 設計書 §8.4 (X スレッド分割規約) / 契約書 §7.2 (途中失敗からの再開)。
 */
describe("X スレッド再開ロジック (last_completed_index)", () => {
  it("初期状態は未投稿 (last_completed_index=-1) で次の index は 0", () => {
    const ref = initialExternalRef();
    expect(ref.last_completed_index).toBe(-1);
    expect(nextThreadIndex(ref)).toBe(0);
  });

  it("先頭ツイート (index=0) の in_reply_to は null", () => {
    const ref = initialExternalRef();
    expect(previousTweetId(ref, 0)).toBeNull();
  });

  it("1 件投稿成功後は index が進み、次の in_reply_to は直前の tweet id", () => {
    let ref = initialExternalRef();
    ref = appendCompletedTweet(ref, "1000000000000000001");
    expect(ref.last_completed_index).toBe(0);
    expect(ref.tweet_ids).toEqual(["1000000000000000001"]);
    expect(nextThreadIndex(ref)).toBe(1);
    expect(previousTweetId(ref, 1)).toBe("1000000000000000001");
  });

  it("途中失敗からの再開: 3件中1件目のみ成功した状態から再開すると index=1 から再開する", () => {
    const partialRef = { tweet_ids: ["111"], last_completed_index: 0 };
    expect(nextThreadIndex(partialRef)).toBe(1);
    expect(previousTweetId(partialRef, 1)).toBe("111");
    expect(isThreadComplete(partialRef, 3)).toBe(false);
  });

  it("スレッド全件投稿完了を正しく判定する", () => {
    const ref = { tweet_ids: ["1", "2", "3"], last_completed_index: 2 };
    expect(isThreadComplete(ref, 3)).toBe(true);
    expect(isThreadComplete(ref, 4)).toBe(false);
  });

  it("2 件連続で成功した場合の累積状態", () => {
    let ref = initialExternalRef();
    ref = appendCompletedTweet(ref, "a");
    ref = appendCompletedTweet(ref, "b");
    expect(ref).toEqual({ tweet_ids: ["a", "b"], last_completed_index: 1 });
    expect(previousTweetId(ref, 2)).toBe("b");
  });
});
