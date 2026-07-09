import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmedApiError } from "@/modules/distribution/internal/publish-error-classify";
import {
  DEFAULT_CHUNK_SIZE_BYTES,
  STATUS_POLL_MAX_ATTEMPTS,
  uploadMediaToX,
} from "@/modules/distribution/internal/x-media";

/**
 * canonical: docs/research/ai-studio-v2/sns-image-posting.md §2.2 (X media upload v2)。
 * 実 X API は叩かず、fetch を全面モックして INIT/APPEND/FINALIZE の契約と
 * チャンク分割境界・STATUS ポーリングを検証する。
 */

type Call = { url: string; method: string; body: unknown };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function textErrorResponse(status: number, text: string): Response {
  return new Response(text, { status });
}

let calls: Call[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  calls = [];
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function recordBody(init: RequestInit | undefined): Promise<unknown> {
  const body = init?.body;
  if (body instanceof FormData) {
    const entries: Record<string, unknown> = {};
    for (const [key, value] of body.entries()) {
      if (value instanceof Blob) {
        entries[key] = { byteLength: (await value.arrayBuffer()).byteLength };
      } else {
        entries[key] = value;
      }
    }
    return entries;
  }
  return body;
}

describe("uploadMediaToX: INIT → APPEND → FINALIZE の契約", () => {
  it("小さい画像 (1 チャンク) は initialize → append(segment_index=0) → finalize の順で呼ばれ、media id を返す", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: await recordBody(init) });
      if (url.endsWith("/2/media/upload/initialize")) {
        return jsonResponse(200, { data: { id: "media-123" } });
      }
      if (url.endsWith("/2/media/upload/media-123/append")) {
        return new Response(null, { status: 202 });
      }
      if (url.endsWith("/2/media/upload/media-123/finalize")) {
        return jsonResponse(200, { data: { id: "media-123" } });
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const bytes = Buffer.from("a".repeat(100));
    const mediaId = await uploadMediaToX({
      accessToken: "token-abc",
      bytes,
      mediaType: "image/jpeg",
      mediaCategory: "tweet_image",
    });

    expect(mediaId).toBe("media-123");
    expect(calls.map((c) => c.url)).toEqual([
      "https://api.x.com/2/media/upload/initialize",
      "https://api.x.com/2/media/upload/media-123/append",
      "https://api.x.com/2/media/upload/media-123/finalize",
    ]);

    const initBody = calls[0].body as Record<string, unknown>;
    expect(initBody.media_type).toBe("image/jpeg");
    expect(initBody.media_category).toBe("tweet_image");
    expect(initBody.total_bytes).toBe(String(bytes.length));

    const appendBody = calls[1].body as Record<string, unknown>;
    expect(appendBody.segment_index).toBe("0");
    expect((appendBody.media as { byteLength: number }).byteLength).toBe(bytes.length);
  });

  it("Authorization ヘッダに accessToken を Bearer で付与する", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = init?.headers as Record<string, string> | undefined;
      calls.push({ url, method: init?.method ?? "GET", body: headers?.Authorization });
      if (url.endsWith("/initialize")) return jsonResponse(200, { data: { id: "m1" } });
      if (url.endsWith("/append")) return new Response(null, { status: 202 });
      if (url.endsWith("/finalize")) return jsonResponse(200, { data: { id: "m1" } });
      throw new Error(`unexpected url: ${url}`);
    });

    await uploadMediaToX({
      accessToken: "secret-token",
      bytes: Buffer.from("x"),
      mediaType: "image/jpeg",
      mediaCategory: "tweet_image",
    });

    expect(calls.every((c) => c.body === "Bearer secret-token")).toBe(true);
  });
});

describe("uploadMediaToX: チャンク分割境界", () => {
  it("指定チャンクサイズちょうどのバイト数は 1 チャンクで完結する", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: await recordBody(init) });
      if (url.endsWith("/initialize")) return jsonResponse(200, { data: { id: "m1" } });
      if (url.endsWith("/append")) return new Response(null, { status: 202 });
      if (url.endsWith("/finalize")) return jsonResponse(200, { data: { id: "m1" } });
      throw new Error(`unexpected url: ${url}`);
    });

    const bytes = Buffer.alloc(10, 1);
    await uploadMediaToX({
      accessToken: "t",
      bytes,
      mediaType: "image/jpeg",
      mediaCategory: "tweet_image",
      chunkSizeBytes: 10,
    });

    const appendCalls = calls.filter((c) => c.url.endsWith("/append"));
    expect(appendCalls).toHaveLength(1);
    expect((appendCalls[0].body as { segment_index: string }).segment_index).toBe("0");
  });

  it("チャンクサイズの倍数+端数は正しい個数・順序・境界のバイト列に分割される", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: await recordBody(init) });
      if (url.endsWith("/initialize")) return jsonResponse(200, { data: { id: "m1" } });
      if (url.endsWith("/append")) return new Response(null, { status: 202 });
      if (url.endsWith("/finalize")) return jsonResponse(200, { data: { id: "m1" } });
      throw new Error(`unexpected url: ${url}`);
    });

    // 25 バイトをチャンクサイズ 10 で分割 → 10 + 10 + 5 の 3 チャンク
    const bytes = Buffer.from(Array.from({ length: 25 }, (_, i) => i));
    await uploadMediaToX({
      accessToken: "t",
      bytes,
      mediaType: "image/jpeg",
      mediaCategory: "tweet_image",
      chunkSizeBytes: 10,
    });

    const appendCalls = calls.filter((c) => c.url.endsWith("/append"));
    expect(appendCalls).toHaveLength(3);
    expect(appendCalls.map((c) => (c.body as { segment_index: string }).segment_index)).toEqual(["0", "1", "2"]);
    expect((appendCalls[0].body as { media: { byteLength: number } }).media.byteLength).toBe(10);
    expect((appendCalls[1].body as { media: { byteLength: number } }).media.byteLength).toBe(10);
    expect((appendCalls[2].body as { media: { byteLength: number } }).media.byteLength).toBe(5);
  });

  it("既定 DEFAULT_CHUNK_SIZE_BYTES は画像上限 5MB を 1 チャンクで収める大きさ", () => {
    expect(DEFAULT_CHUNK_SIZE_BYTES).toBeGreaterThanOrEqual(4 * 1024 * 1024);
    expect(DEFAULT_CHUNK_SIZE_BYTES).toBeLessThan(5 * 1024 * 1024);
  });

  it("実際の画像上限 5MB (DEFAULT_CHUNK_SIZE_BYTES より大きい) は複数チャンクに正しく分割される", async () => {
    const appendSegmentIndexes: string[] = [];
    const appendByteLengths: number[] = [];

    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/initialize")) return jsonResponse(200, { data: { id: "m1" } });
      if (url.endsWith("/append")) {
        const form = init?.body as FormData;
        const segmentIndex = form.get("segment_index");
        const media = form.get("media") as Blob;
        appendSegmentIndexes.push(String(segmentIndex));
        appendByteLengths.push(media.size);
        return new Response(null, { status: 202 });
      }
      if (url.endsWith("/finalize")) return jsonResponse(200, { data: { id: "m1" } });
      throw new Error(`unexpected url: ${url}`);
    });

    // 5MB ちょうど (X の画像上限) は既定チャンクサイズ (4MB) より大きいため 2 チャンクに分割される
    const bytes = Buffer.alloc(5 * 1024 * 1024, 1);
    await uploadMediaToX({
      accessToken: "t",
      bytes,
      mediaType: "image/jpeg",
      mediaCategory: "tweet_image",
    });

    const expectedChunkCount = Math.ceil(bytes.length / DEFAULT_CHUNK_SIZE_BYTES);
    expect(expectedChunkCount).toBe(2);
    expect(appendSegmentIndexes).toEqual(["0", "1"]);
    expect(appendByteLengths[0]).toBe(DEFAULT_CHUNK_SIZE_BYTES);
    expect(appendByteLengths[1]).toBe(bytes.length - DEFAULT_CHUNK_SIZE_BYTES);
  });
});

describe("uploadMediaToX: STATUS ポーリング", () => {
  function mockWithProcessing(states: string[]) {
    let statusCallIndex = 0;
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: await recordBody(init) });
      if (url.endsWith("/initialize")) return jsonResponse(200, { data: { id: "m1" } });
      if (url.endsWith("/append")) return new Response(null, { status: 202 });
      if (url.endsWith("/finalize")) {
        return jsonResponse(200, {
          data: { id: "m1", processing_info: { state: states[0], check_after_secs: 0 } },
        });
      }
      if (url.includes("command=STATUS")) {
        statusCallIndex += 1;
        const state = states[statusCallIndex] ?? states[states.length - 1];
        return jsonResponse(200, { data: { id: "m1", processing_info: { state, check_after_secs: 0 } } });
      }
      throw new Error(`unexpected url: ${url}`);
    });
  }

  it("pending → in_progress → succeeded と遷移したら成功で media id を返す", async () => {
    mockWithProcessing(["pending", "in_progress", "succeeded"]);

    const mediaId = await uploadMediaToX({
      accessToken: "t",
      bytes: Buffer.from("x"),
      mediaType: "image/gif",
      mediaCategory: "tweet_gif",
    });

    expect(mediaId).toBe("m1");
    const statusCalls = calls.filter((c) => c.url.includes("command=STATUS"));
    expect(statusCalls.length).toBeGreaterThanOrEqual(2);
    expect(statusCalls[0].url).toContain("media_id=m1");
  });

  it("state=failed は ConfirmedApiError を送出する", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", body: await recordBody(init) });
      if (url.endsWith("/initialize")) return jsonResponse(200, { data: { id: "m1" } });
      if (url.endsWith("/append")) return new Response(null, { status: 202 });
      if (url.endsWith("/finalize")) {
        return jsonResponse(200, {
          data: { id: "m1", processing_info: { state: "failed", check_after_secs: 0, error: { message: "bad" } } },
        });
      }
      throw new Error(`unexpected url: ${url}`);
    });

    await expect(
      uploadMediaToX({
        accessToken: "t",
        bytes: Buffer.from("x"),
        mediaType: "video/mp4",
        mediaCategory: "tweet_video",
      }),
    ).rejects.toThrow(/失敗/);
  });

  it("state が succeeded に到達せず STATUS_POLL_MAX_ATTEMPTS を超えるとタイムアウト例外", async () => {
    mockWithProcessing(["in_progress", ...Array(STATUS_POLL_MAX_ATTEMPTS + 2).fill("in_progress")]);

    await expect(
      uploadMediaToX({
        accessToken: "t",
        bytes: Buffer.from("x"),
        mediaType: "video/mp4",
        mediaCategory: "tweet_video",
      }),
    ).rejects.toThrow(/タイムアウト/);
  });
});

describe("uploadMediaToX: エラー分類 (ConfirmedApiError)", () => {
  it("initialize が 403 (media.write scope 未認可) を返すと ConfirmedApiError(status=403)", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/initialize")) return textErrorResponse(403, "insufficient scope");
      throw new Error(`unexpected url: ${url}`);
    });

    await expect(
      uploadMediaToX({
        accessToken: "t",
        bytes: Buffer.from("x"),
        mediaType: "image/jpeg",
        mediaCategory: "tweet_image",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("append が 500 を返すと ConfirmedApiError(status=500) で中断する (finalize は呼ばれない)", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      calls.push({ url, method: "POST", body: null });
      if (url.endsWith("/initialize")) return jsonResponse(200, { data: { id: "m1" } });
      if (url.endsWith("/append")) return textErrorResponse(500, "server error");
      if (url.endsWith("/finalize")) throw new Error("finalize は呼ばれてはいけない");
      throw new Error(`unexpected url: ${url}`);
    });

    let caught: unknown;
    try {
      await uploadMediaToX({
        accessToken: "t",
        bytes: Buffer.from("x"),
        mediaType: "image/jpeg",
        mediaCategory: "tweet_image",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfirmedApiError);
    expect((caught as ConfirmedApiError).status).toBe(500);
    expect(calls.some((c) => c.url.endsWith("/finalize"))).toBe(false);
  });

  it("initialize が media id を含まない応答を返すと ConfirmedApiError", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/initialize")) return jsonResponse(200, { data: {} });
      throw new Error(`unexpected url: ${url}`);
    });

    await expect(
      uploadMediaToX({
        accessToken: "t",
        bytes: Buffer.from("x"),
        mediaType: "image/jpeg",
        mediaCategory: "tweet_image",
      }),
    ).rejects.toBeInstanceOf(ConfirmedApiError);
  });
});
