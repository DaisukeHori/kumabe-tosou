/**
 * SNS API 呼び出し失敗の分類 (canonical: 設計書 §8.2 at-least-once + 人間照合モデル)。
 * X / Instagram の双方で共通:
 * - 確定エラー応答 (4xx/5xx の JSON エラーボディを受信できた) → "failed" (再開/リトライ可能)
 * - 応答不明 (timeout / ネットワーク断 — 投稿されたか判別不能) → "manual_required" (自動再開禁止・KMB-E506)
 */

export type PublishFailureKind = "failed" | "manual_required";

/** HTTP 応答を受信し、エラーボディを解析できた「確定エラー」を表す */
export class ConfirmedApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ConfirmedApiError";
  }
}

/**
 * fetch 由来の例外 (AbortError=timeout, TypeError=ネットワーク断) は「応答不明」。
 * ConfirmedApiError (HTTP 応答を受信できた) は「確定エラー」。
 * それ以外の未知の例外は安全側 (manual_required) に倒す —
 * 「投稿されていない」と誤って failed 扱いし二重投稿を招くより安全 (設計書 §8.2)。
 */
export function classifyPublishFailure(err: unknown): PublishFailureKind {
  if (err instanceof ConfirmedApiError) {
    return "failed";
  }
  if (typeof DOMException !== "undefined" && err instanceof DOMException && err.name === "AbortError") {
    return "manual_required"; // timeout
  }
  if (err instanceof TypeError) {
    return "manual_required"; // fetch のネットワーク断 (fetch failed 等)
  }
  return "manual_required";
}
