import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONTAINER_STATUS_MAX_ATTEMPTS,
  containerStatusDelayMs,
  createMediaContainer,
  InstagramContainerNotReadyError,
  InstagramGraphApiError,
  isInstagramTokenExpiredError,
  waitForContainerReady,
} from "@/modules/distribution/internal/instagram-api";
import { ConfirmedApiError } from "@/modules/distribution/internal/publish-error-classify";

/**
 * canonical: cms-ai-pipeline.md §8.1 / §8.2 (Instagram Graph API)。実 Graph API は叩かず fetch を
 * 全面モックする。2026-09-06 監査修正 #4 (トークン失効判定) / #5 (コンテナ状態確認)。
 */

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function graphError(status: number, error: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error }), { status, headers: { "content-type": "application/json" } });
}

describe("graphFetch: エラーボディの error.code / error.type を保持する (#4)", () => {
  it("400 + code 190 (OAuthException) は InstagramGraphApiError として code/type を持ち、失効と判定される", async () => {
    fetchMock.mockResolvedValue(
      graphError(400, { message: "Error validating access token", type: "OAuthException", code: 190, error_subcode: 463 }),
    );

    const err = await createMediaContainer("ig-1", "tok", { imageUrl: "https://x/y.jpg" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InstagramGraphApiError);
    const e = err as InstagramGraphApiError;
    expect(e.status).toBe(400);
    expect(e.graphCode).toBe(190);
    expect(e.graphType).toBe("OAuthException");
    expect(e.graphSubcode).toBe(463);
    expect(isInstagramTokenExpiredError(e)).toBe(true);
    // ConfirmedApiError のサブクラスなので classifyPublishFailure 側の「確定エラー」扱いは維持される
    expect(e).toBeInstanceOf(ConfirmedApiError);
  });

  it("type=OAuthException (code 190 以外) も失効経路に流す", async () => {
    fetchMock.mockResolvedValue(graphError(400, { message: "x", type: "OAuthException", code: 102 }));
    const err = await createMediaContainer("ig-1", "tok", { imageUrl: "https://x/y.jpg" }).catch((e: unknown) => e);
    expect(isInstagramTokenExpiredError(err)).toBe(true);
  });

  it("HTTP 401 は従来どおり失効。それ以外 (400 + code 100 の GraphMethodException) は失効ではない", async () => {
    fetchMock.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    const e401 = await createMediaContainer("ig-1", "tok", { imageUrl: "https://x/y.jpg" }).catch((e: unknown) => e);
    expect(isInstagramTokenExpiredError(e401)).toBe(true);

    fetchMock.mockResolvedValueOnce(graphError(400, { message: "Invalid parameter", type: "GraphMethodException", code: 100 }));
    const e100 = await createMediaContainer("ig-1", "tok", { imageUrl: "https://x/y.jpg" }).catch((e: unknown) => e);
    expect(e100).toBeInstanceOf(InstagramGraphApiError);
    expect(isInstagramTokenExpiredError(e100)).toBe(false);
  });

  it("JSON でないエラーボディでも落ちず code/type は null になる", async () => {
    fetchMock.mockResolvedValue(new Response("<html>502</html>", { status: 502 }));
    const err = await createMediaContainer("ig-1", "tok", { imageUrl: "https://x/y.jpg" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InstagramGraphApiError);
    expect((err as InstagramGraphApiError).graphCode).toBeNull();
    expect(isInstagramTokenExpiredError(err)).toBe(false);
  });
});

describe("waitForContainerReady: publish 前の status_code ポーリング (#5)", () => {
  function statusSequence(codes: string[]) {
    let i = 0;
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(init?.method ?? "GET").toBe("GET");
      expect(url.pathname.endsWith("/creation-1")).toBe(true);
      expect(url.searchParams.get("fields")).toBe("status_code,status");
      expect(url.searchParams.get("access_token")).toBe("tok");
      const code = codes[Math.min(i, codes.length - 1)];
      i += 1;
      return new Response(JSON.stringify({ status_code: code, status: `Status: ${code}` }), { status: 200 });
    });
  }

  it("IN_PROGRESS → IN_PROGRESS → FINISHED: バックオフ (1s, 2s) を挟んで 3 回目で戻る", async () => {
    statusSequence(["IN_PROGRESS", "IN_PROGRESS", "FINISHED"]);
    const sleeps: number[] = [];
    await waitForContainerReady("tok", "creation-1", { sleep: async (ms) => void sleeps.push(ms) });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([containerStatusDelayMs(0), containerStatusDelayMs(1)]);
    expect(sleeps).toEqual([1_000, 2_000]);
  });

  it("ERROR は ConfirmedApiError (確定失敗 → worker は failed) を投げ、それ以上ポーリングしない", async () => {
    statusSequence(["IN_PROGRESS", "ERROR"]);
    const sleeps: number[] = [];
    const err = await waitForContainerReady("tok", "creation-1", { sleep: async (ms) => void sleeps.push(ms) }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ConfirmedApiError);
    expect(err).not.toBeInstanceOf(InstagramContainerNotReadyError);
    expect(String((err as Error).message)).toContain("ERROR");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("上限回数まで IN_PROGRESS のままなら InstagramContainerNotReadyError (worker は manual_required)", async () => {
    statusSequence(["IN_PROGRESS"]);
    const sleeps: number[] = [];
    const err = await waitForContainerReady("tok", "creation-1", { sleep: async (ms) => void sleeps.push(ms) }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(InstagramContainerNotReadyError);
    expect((err as InstagramContainerNotReadyError).creationId).toBe("creation-1");
    expect((err as InstagramContainerNotReadyError).lastStatusCode).toBe("IN_PROGRESS");
    expect(fetchMock).toHaveBeenCalledTimes(CONTAINER_STATUS_MAX_ATTEMPTS);
    // 最終試行の後は待たない
    expect(sleeps).toHaveLength(CONTAINER_STATUS_MAX_ATTEMPTS - 1);
    // バックオフは上限 8 秒でクリップされる
    expect(Math.max(...sleeps)).toBe(8_000);
  });

  it("maxAttempts は上書きできる (短縮用)", async () => {
    statusSequence(["IN_PROGRESS"]);
    await expect(
      waitForContainerReady("tok", "creation-1", { maxAttempts: 2, sleep: async () => undefined }),
    ).rejects.toBeInstanceOf(InstagramContainerNotReadyError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
