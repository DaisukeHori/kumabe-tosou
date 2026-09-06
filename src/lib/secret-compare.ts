import { createHash, timingSafeEqual } from "node:crypto";

/**
 * 共有シークレット (x-jobs-secret / x-revalidate-secret 等) の定数時間比較。
 *
 * `provided !== expected` の素朴な比較は、文字列比較が先頭から不一致位置で早期終了するため
 * 応答時間から 1 文字ずつ正解を推定される (timing attack) 余地がある。
 * crypto.timingSafeEqual は同じ長さの Buffer しか受け付けず、長さが違うと例外になる
 * (= 長さ情報が漏れる) ため、双方を sha256 で固定長 (32 byte) に潰してから比較する。
 *
 * expected が空/未設定なら常に false (呼び出し側は未設定時 503 を先に返す前提だが、
 * 誤って空文字と一致してしまう事故を二重に防ぐ)。
 */
export function secretEquals(
  provided: string | null | undefined,
  expected: string | undefined,
): boolean {
  if (typeof expected !== "string" || expected.length === 0) return false;
  if (typeof provided !== "string") return false;

  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}
