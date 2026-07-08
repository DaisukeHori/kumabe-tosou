import { describe, expect, it } from "vitest";

import { ConfirmedApiError, classifyPublishFailure } from "@/modules/distribution/internal/publish-error-classify";

/**
 * canonical: 設計書 §8.2 (at-least-once + 人間照合モデル)。
 * 「確定エラー応答 → failed (KMB-E504)」 / 「応答不明 (timeout/ネットワーク断) → manual_required (KMB-E506)」
 */
describe("classifyPublishFailure: E506 (manual_required) 分岐", () => {
  it("AbortError (timeout シミュレート) は manual_required", () => {
    const err = new DOMException("The operation was aborted", "AbortError");
    expect(classifyPublishFailure(err)).toBe("manual_required");
  });

  it("TypeError (fetch のネットワーク断) は manual_required", () => {
    const err = new TypeError("fetch failed");
    expect(classifyPublishFailure(err)).toBe("manual_required");
  });

  it("未知の例外は安全側 (manual_required) に倒す", () => {
    expect(classifyPublishFailure(new Error("unexpected"))).toBe("manual_required");
    expect(classifyPublishFailure("string thrown")).toBe("manual_required");
    expect(classifyPublishFailure(undefined)).toBe("manual_required");
  });
});

describe("classifyPublishFailure: failed (確定エラー) 分岐", () => {
  it("ConfirmedApiError (HTTP 応答を受信できた 4xx/5xx) は failed", () => {
    const err = new ConfirmedApiError("X API エラー", 429);
    expect(classifyPublishFailure(err)).toBe("failed");
  });

  it("ConfirmedApiError は status を保持する", () => {
    const err = new ConfirmedApiError("Instagram エラー", 500);
    expect(err.status).toBe(500);
    expect(err.name).toBe("ConfirmedApiError");
  });
});
