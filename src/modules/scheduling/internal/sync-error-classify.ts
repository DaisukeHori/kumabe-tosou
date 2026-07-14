// scheduling/internal/sync-error-classify.ts
// canonical: docs/design/crm-suite/03-scheduling.md §8.4 (エラー分類表) / §8.5 (KMB-E722/E725)。
// 参照実装: distribution/internal/publish-error-classify.ts (同型パターンの複製)。
//
// push/pull 時の HTTP エラー・例外を純関数で分類する。404 の「カレンダー404 かどうか」の
// 区別 (P20) はこの関数だけでは判定できない (追加の API 呼び出しが要る) ため、
// sync-engine.ts が classifySyncError の結果 kind:"not_found" を受けて別途判定する。
import { AuthExpiredError, ConfirmedApiError, ConflictError, GoneError } from "./provider";

export type SyncErrorClassification =
  | { kind: "conflict" } // 412/409 → KMB-E721
  | { kind: "not_found" } // 404 (または 410) → カレンダー404/イベント404 の 2 分岐は呼び出し側の責務
  | { kind: "auth_expired" } // 401 → refresh 1 回 → 再試行の対象
  | { kind: "confirmed_error"; status: number } // その他 4xx/5xx (確定エラー) → push_attempts++
  | { kind: "unknown" }; // timeout / ネットワーク断 (結果不明) → KMB-E724。自動再開禁止

/**
 * 確定エラー (HTTP 応答を受信できた) を分類する。
 * 未知の例外は安全側 ("unknown" = 結果不明) に倒す — 「実際には書けていたのに failed 扱いにして
 * 二重書込を招く」より、「実際には失敗していたのに手動照合を要求する」方が安全 (§8.2 と同じ思想)。
 */
export function classifySyncError(err: unknown): SyncErrorClassification {
  if (err instanceof ConflictError) return { kind: "conflict" };
  if (err instanceof GoneError) return { kind: "not_found" }; // 410 も「もう存在しない」として同系統に倒す
  if (err instanceof AuthExpiredError) return { kind: "auth_expired" };
  if (err instanceof ConfirmedApiError) {
    if (err.status === 404) return { kind: "not_found" };
    if (err.status === 401) return { kind: "auth_expired" };
    if (err.status === 412 || err.status === 409) return { kind: "conflict" };
    return { kind: "confirmed_error", status: err.status };
  }
  if (typeof DOMException !== "undefined" && err instanceof DOMException && err.name === "AbortError") {
    return { kind: "unknown" }; // timeout (AbortSignal.timeout)
  }
  if (err instanceof TypeError) {
    return { kind: "unknown" }; // fetch のネットワーク断 (fetch failed 等)
  }
  return { kind: "unknown" };
}
