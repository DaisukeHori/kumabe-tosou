import { afterEach, describe, expect, it, vi } from "vitest";

import { callGeminiImage, isGeminiImageModelName } from "@/modules/ai-providers/internal/gemini";

/**
 * canonical: docs/research/ai-studio-v2/gemini-image.md §4 (複数枚生成は公式パラメータが
 * 存在しないため並列 N リクエストで代替する)。
 *
 * tester 検証 (MEDIUM) 対応: 従来 (v1) は Promise.all + all-or-nothing (1 件でも失敗すると
 * 成功済みの画像も含めて全体を失敗として捨てる) だったが、Gemini 側では成功した分が既に
 * 生成・課金対象になっている可能性があるため、実コストが ai_usage_log に記録されない
 * 欠落バグがあった。v2 では各リクエストを独立に判定し、**成功分の画像は必ず返す**
 * (failedCount で欠落数を可視化)。全滅 (images が 0 件) の場合のみ ok:false とし、
 * この場合に限りルータが次のキーへフォールバックする (部分成功時は再試行しない)。
 * 本テストは v1 の期待値を新仕様 (v2) に反転させたもの。
 */
describe("callGeminiImage: 並列 N リクエストの部分失敗ハンドリング (v2: 部分成功を許容)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function jsonResponse(body: unknown, ok = true, status = 200) {
    return {
      ok,
      status,
      statusText: ok ? "OK" : "Error",
      json: async () => body,
      headers: { get: () => null },
    } as unknown as Response;
  }

  function imageCandidateBody(dataBase64: string) {
    return {
      candidates: [
        { content: { parts: [{ inlineData: { mimeType: "image/png", data: dataBase64 } }] } },
      ],
    };
  }

  function noImageCandidateBody() {
    return { candidates: [{ content: { parts: [{ text: "no image generated" }] } }] };
  }

  it("4 件中 3 件成功・1 件失敗 (429) の場合、成功した 3 件を返し failedCount=1 とする (部分成功)", async () => {
    let call = 0;
    global.fetch = vi.fn(async () => {
      call += 1;
      if (call === 4) {
        return jsonResponse({ error: { message: "rate limited" } }, false, 429);
      }
      return jsonResponse(imageCandidateBody(`image-data-${call}`));
    }) as unknown as typeof fetch;

    const result = await callGeminiImage({
      apiKey: "test-key",
      model: "gemini-3.1-flash-image",
      prompt: "a cat",
      n: 4,
    });

    // 成功していた 3 件の画像データは呼び出し元にそのまま届く (握りつぶさない)。
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.images).toHaveLength(3);
    expect(result.value.failedCount).toBe(1);
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it("全件失敗 (429) の場合のみ ok:false になる (この場合だけルータが次のキーへフォールバックする)", async () => {
    global.fetch = vi.fn(async () =>
      jsonResponse({ error: { message: "rate limited" } }, false, 429),
    ) as unknown as typeof fetch;

    const result = await callGeminiImage({
      apiKey: "test-key",
      model: "gemini-3.1-flash-image",
      prompt: "a cat",
      n: 4,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("rate_limit");
  });

  it("全件成功時は n 件の画像を返し failedCount=0", async () => {
    let call = 0;
    global.fetch = vi.fn(async () => {
      call += 1;
      return jsonResponse(imageCandidateBody(`image-data-${call}`));
    }) as unknown as typeof fetch;

    const result = await callGeminiImage({
      apiKey: "test-key",
      model: "gemini-3.1-flash-image",
      prompt: "a cat",
      n: 4,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.images).toHaveLength(4);
    expect(result.value.failedCount).toBe(0);
  });

  it("画像パートが無い候補が一部ある場合は failedCount に計上しつつ成功分は返す (images.length + failedCount === n)", async () => {
    let call = 0;
    global.fetch = vi.fn(async () => {
      call += 1;
      // 4 件中 2 件のみ画像パート有り、残り 2 件は画像なし応答 (HTTP 自体は 200)。
      return call % 2 === 0 ? jsonResponse(imageCandidateBody(`image-data-${call}`)) : jsonResponse(noImageCandidateBody());
    }) as unknown as typeof fetch;

    const result = await callGeminiImage({
      apiKey: "test-key",
      model: "gemini-3.1-flash-image",
      prompt: "a cat",
      n: 4,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.images).toHaveLength(2);
    expect(result.value.failedCount).toBe(2);
  });

  it("LOW (tester 検証): 画像パートが 1 枚も無い (全滅) 場合は ok:false (E408 相当) になる", async () => {
    global.fetch = vi.fn(async () => jsonResponse(noImageCandidateBody())) as unknown as typeof fetch;

    const result = await callGeminiImage({
      apiKey: "test-key",
      model: "gemini-3.1-flash-image",
      prompt: "a cat",
      n: 2,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe("プロバイダが画像を返しませんでした");
  });
});

describe("isGeminiImageModelName", () => {
  it("-image サフィックスは画像モデル判定", () => {
    expect(isGeminiImageModelName("gemini-3.1-flash-image")).toBe(true);
  });
  it("imagen- プレフィックスは画像モデル判定", () => {
    expect(isGeminiImageModelName("imagen-3.0-generate-002")).toBe(true);
  });
  it("通常のテキストモデルは false", () => {
    expect(isGeminiImageModelName("gemini-2.5-flash")).toBe(false);
  });
});
