import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApprovedDraft } from "@/modules/ai-studio/contracts";
import type { ChannelAccountRow, ChannelPostRow } from "@/modules/distribution/repository";

/**
 * canonical: docs/design/ai-studio-v2.md §7 (X 画像付き投稿) / §12 P0。
 * worker.ts の publishXPost (runPublishWorkerBatch 経由) を検証する。
 * repository / media facade / settings facade / ai-studio facade を vi.mock し、
 * X への実 HTTP 呼び出しのみ global.fetch モックで契約検証する
 * (実 X API は叩かない。tests/distribution-x-media.test.ts の契約テストと相補)。
 *
 * 検証観点:
 * - 従来の画像なしテキスト投稿は完全に非退行 (media 関連エンドポイントに一切触れず published)
 * - 画像付きツイートは INIT/APPEND/FINALIZE 成功時のみ tweet.media.media_ids に添付されて published
 * - 画像アップロード失敗 (JPEG レンディション取得失敗 / X media upload API エラー) は
 *   「画像なしで勝手に投稿しない」— tweet 投稿 (POST /2/tweets) 自体を試みず manual_required に遷移する。
 *   ただし 401 (invalid_token = トークン失効) は postTweet の 401 分岐と同一のチャネル失効経路
 *   (markChannelAccountExpired + flagScheduledPostsForExpiredChannel + markFailed(KMB-E503)) に
 *   統一する (tester 検証で裁定した設計判断)。403 (insufficient_scope = media.write 未認可) は
 *   引き続き manual_required + 再接続を促す detail。
 */

const OPS_LIMITS = { x_monthly_post_limit: 100_000 };

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    X_CLIENT_ID: undefined,
    X_CLIENT_SECRET: undefined,
    NEXT_PUBLIC_SITE_URL: "https://example.com",
  }),
}));

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({}) as unknown,
}));

vi.mock("@/modules/content/facade", () => ({
  contentFacade: { createBlogPostFromDraft: vi.fn() },
}));

const getJpegRenditionUrl = vi.fn();
vi.mock("@/modules/media/facade", () => ({
  mediaFacade: { getJpegRenditionUrl: (...args: unknown[]) => getJpegRenditionUrl(...args) },
}));

const settingsGet = vi.fn();
vi.mock("@/modules/settings/facade", () => ({
  settingsFacade: { get: (...args: unknown[]) => settingsGet(...args) },
}));

const getApprovedDraft = vi.fn();
vi.mock("@/modules/ai-studio/facade", () => ({
  aiStudioFacade: { getApprovedDraft: (...args: unknown[]) => getApprovedDraft(...args) },
}));

const claimDueScheduledPosts = vi.fn();
const getChannelAccount = vi.fn();
const vaultReadSecret = vi.fn();
const updateXThreadProgress = vi.fn();
const markPublished = vi.fn();
const markFailed = vi.fn();
const markManualRequired = vi.fn();
const markChannelAccountExpired = vi.fn();
const flagScheduledPostsForExpiredChannel = vi.fn();
const getMonthlyXCostCentsSum = vi.fn();

vi.mock("@/modules/distribution/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/distribution/repository")>();
  return {
    ...actual,
    claimDueScheduledPosts: (...args: unknown[]) => claimDueScheduledPosts(...args),
    getChannelAccount: (...args: unknown[]) => getChannelAccount(...args),
    vaultReadSecret: (...args: unknown[]) => vaultReadSecret(...args),
    updateXThreadProgress: (...args: unknown[]) => updateXThreadProgress(...args),
    markPublished: (...args: unknown[]) => markPublished(...args),
    markFailed: (...args: unknown[]) => markFailed(...args),
    markManualRequired: (...args: unknown[]) => markManualRequired(...args),
    markChannelAccountExpired: (...args: unknown[]) => markChannelAccountExpired(...args),
    flagScheduledPostsForExpiredChannel: (...args: unknown[]) => flagScheduledPostsForExpiredChannel(...args),
    getMonthlyXCostCentsSum: (...args: unknown[]) => getMonthlyXCostCentsSum(...args),
  };
});

import { runPublishWorkerBatch } from "@/modules/distribution/internal/worker";

const ACCOUNT: ChannelAccountRow = {
  channel: "x",
  account_label: "@tester",
  auth_status: "connected",
  vault_secret_name: "sns_x_oauth",
  meta: { user_id: "u1", username: "tester", token_expires_at: new Date(Date.now() + 3_600_000).toISOString() },
  connected_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  token_refresh_lease_expires_at: null,
};

function basePost(overrides: Partial<ChannelPostRow> = {}): ChannelPostRow {
  return {
    id: "post-1",
    draft_id: "draft-1",
    channel: "x",
    status: "publishing",
    scheduled_at: new Date().toISOString(),
    published_at: null,
    external_id: null,
    external_url: null,
    tweet_count: 1,
    url_count: 0,
    estimated_cost_cents: 2,
    attempt_count: 1,
    last_error_code: null,
    last_error_detail: null,
    idempotency_key: "idem-1",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function draftWithThread(thread: { text: string; media_id: string | null }[]): ApprovedDraft {
  return {
    draft_id: "draft-1",
    channel: "x",
    content: { thread } as unknown as ApprovedDraft["content"],
    approved_at: new Date().toISOString(),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
let fetchCalls: { url: string; method: string; body: unknown }[];

async function recordBody(init: RequestInit | undefined): Promise<unknown> {
  const body = init?.body;
  if (body instanceof FormData) {
    const entries: Record<string, unknown> = {};
    for (const [key] of body.entries()) entries[key] = true;
    return entries;
  }
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
  return body;
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchCalls = [];
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  settingsGet.mockResolvedValue({ ok: true, value: OPS_LIMITS });
  getMonthlyXCostCentsSum.mockResolvedValue({ ok: true, value: 0 });
  getChannelAccount.mockResolvedValue({ ok: true, value: ACCOUNT });
  vaultReadSecret.mockResolvedValue({
    ok: true,
    value: JSON.stringify({
      access_token: "access-token-1",
      refresh_token: "refresh-token-1",
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    }),
  });
  markPublished.mockResolvedValue({ ok: true, value: undefined });
  markFailed.mockResolvedValue({ ok: true, value: undefined });
  markManualRequired.mockResolvedValue({ ok: true, value: undefined });
  updateXThreadProgress.mockResolvedValue({ ok: true, value: undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("publishXPost (runPublishWorkerBatch) 経由: 画像なしテキスト投稿の非退行", () => {
  it("media_id が無いツイートは従来どおり media 関連エンドポイントに一切触れず published になる", async () => {
    const post = basePost();
    claimDueScheduledPosts.mockResolvedValue({ ok: true, value: [post] });
    getApprovedDraft.mockResolvedValue({ ok: true, value: draftWithThread([{ text: "hello", media_id: null }]) });

    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, method: init?.method ?? "GET", body: await recordBody(init) });
      if (url.endsWith("/2/tweets")) {
        return new Response(JSON.stringify({ data: { id: "tweet-1" } }), { status: 200 });
      }
      throw new Error(`unexpected url in text-only test: ${url}`);
    });

    const result = await runPublishWorkerBatch();
    expect(result.processed).toBe(1);

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("https://api.twitter.com/2/tweets");
    expect((fetchCalls[0].body as { media?: unknown }).media).toBeUndefined();

    expect(markPublished).toHaveBeenCalledTimes(1);
    expect(markManualRequired).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
    expect(getJpegRenditionUrl).not.toHaveBeenCalled();
  });
});

describe("publishXPost: 画像付きツイートの成功パス", () => {
  it("INIT/APPEND/FINALIZE 成功 → media_ids がツイート payload に添付されて published", async () => {
    const post = basePost();
    claimDueScheduledPosts.mockResolvedValue({ ok: true, value: [post] });
    getApprovedDraft.mockResolvedValue({
      ok: true,
      value: draftWithThread([{ text: "画像つき", media_id: "media-uuid-1" }]),
    });
    getJpegRenditionUrl.mockResolvedValue({ ok: true, value: "https://storage.example.com/rendition.jpg" });

    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, method: init?.method ?? "GET", body: await recordBody(init) });
      if (url === "https://storage.example.com/rendition.jpg") {
        return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
      }
      if (url.endsWith("/2/media/upload/initialize")) {
        return new Response(JSON.stringify({ data: { id: "x-media-1" } }), { status: 200 });
      }
      if (url.endsWith("/2/media/upload/x-media-1/append")) {
        return new Response(null, { status: 202 });
      }
      if (url.endsWith("/2/media/upload/x-media-1/finalize")) {
        return new Response(JSON.stringify({ data: { id: "x-media-1" } }), { status: 200 });
      }
      if (url.endsWith("/2/tweets")) {
        return new Response(JSON.stringify({ data: { id: "tweet-1" } }), { status: 200 });
      }
      throw new Error(`unexpected url in success-path test: ${url}`);
    });

    const result = await runPublishWorkerBatch();
    expect(result.processed).toBe(1);

    const tweetCall = fetchCalls.find((c) => c.url.endsWith("/2/tweets"));
    expect(tweetCall).toBeDefined();
    expect((tweetCall!.body as { media?: { media_ids: string[] } }).media?.media_ids).toEqual(["x-media-1"]);

    expect(markPublished).toHaveBeenCalledTimes(1);
    expect(markManualRequired).not.toHaveBeenCalled();
  });
});

describe("publishXPost: 画像アップロード失敗時は manual_required に落ちる (画像なしで勝手に投稿しない)", () => {
  it("JPEG レンディション取得失敗 (media facade が ok:false) はツイート投稿を試みず manual_required", async () => {
    const post = basePost();
    claimDueScheduledPosts.mockResolvedValue({ ok: true, value: [post] });
    getApprovedDraft.mockResolvedValue({
      ok: true,
      value: draftWithThread([{ text: "画像つき", media_id: "media-uuid-missing" }]),
    });
    getJpegRenditionUrl.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "media が見つかりません" });

    fetchMock.mockImplementation(async (input: string | URL) => {
      throw new Error(`X API は呼ばれてはいけない: ${String(input)}`);
    });

    const result = await runPublishWorkerBatch();
    expect(result.processed).toBe(1);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(markManualRequired).toHaveBeenCalledTimes(1);
    const call = markManualRequired.mock.calls[0];
    expect(call[2]).toMatchObject({ code: "KMB-E501" });
    expect(String(call[2].detail)).toContain("media-uuid-missing");
    expect(markPublished).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
  });

  it("X media upload (INIT) が 403 (media.write scope 未認可) を返すとツイート投稿せず manual_required", async () => {
    const post = basePost();
    claimDueScheduledPosts.mockResolvedValue({ ok: true, value: [post] });
    getApprovedDraft.mockResolvedValue({
      ok: true,
      value: draftWithThread([{ text: "画像つき", media_id: "media-uuid-1" }]),
    });
    getJpegRenditionUrl.mockResolvedValue({ ok: true, value: "https://storage.example.com/rendition.jpg" });

    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, method: init?.method ?? "GET", body: await recordBody(init) });
      if (url === "https://storage.example.com/rendition.jpg") {
        return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
      }
      if (url.endsWith("/2/media/upload/initialize")) {
        return new Response("insufficient scope: media.write", { status: 403 });
      }
      if (url.endsWith("/2/tweets")) {
        throw new Error("画像アップロード失敗時は tweet 投稿してはいけない");
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const result = await runPublishWorkerBatch();
    expect(result.processed).toBe(1);

    expect(fetchCalls.some((c) => c.url.endsWith("/2/tweets"))).toBe(false);
    expect(markManualRequired).toHaveBeenCalledTimes(1);
    const call = markManualRequired.mock.calls[0];
    expect(call[2]).toMatchObject({ code: "KMB-E501" });
    expect(String(call[2].detail)).toContain("media.write");
    expect(markPublished).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
  });

  it("スレッド 2 件目で画像失敗した場合、1 件目は投稿済みのまま (progress 保存済み) manual_required で停止する", async () => {
    const post = basePost({ tweet_count: 2 });
    claimDueScheduledPosts.mockResolvedValue({ ok: true, value: [post] });
    getApprovedDraft.mockResolvedValue({
      ok: true,
      value: draftWithThread([
        { text: "1件目 (画像なし)", media_id: null },
        { text: "2件目 (画像あり)", media_id: "media-uuid-2" },
      ]),
    });
    getJpegRenditionUrl.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "取得失敗" });

    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, method: init?.method ?? "GET", body: await recordBody(init) });
      if (url.endsWith("/2/tweets")) {
        return new Response(JSON.stringify({ data: { id: "tweet-1" } }), { status: 200 });
      }
      throw new Error(`unexpected url: ${url}`);
    });

    const result = await runPublishWorkerBatch();
    expect(result.processed).toBe(1);

    // 1 件目 (画像なし) は投稿されている
    expect(fetchCalls.filter((c) => c.url.endsWith("/2/tweets"))).toHaveLength(1);
    expect(updateXThreadProgress).toHaveBeenCalledTimes(1);

    // 2 件目の画像失敗で manual_required (published/failed は呼ばれない)
    expect(markManualRequired).toHaveBeenCalledTimes(1);
    expect(markPublished).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
  });
});

describe("publishXPost: 画像アップロードの 401 (invalid_token) はチャネル失効経路に統一される", () => {
  it(
    "X media upload (INIT) が 401 を返すと postTweet の 401 分岐と同一の経路になる " +
      "(markChannelAccountExpired + flagScheduledPostsForExpiredChannel + markFailed(KMB-E503)。" +
      "manual_required にはしない — tester 検証で裁定した設計判断)",
    async () => {
      const post = basePost();
      claimDueScheduledPosts.mockResolvedValue({ ok: true, value: [post] });
      getApprovedDraft.mockResolvedValue({
        ok: true,
        value: draftWithThread([{ text: "画像つき", media_id: "media-uuid-1" }]),
      });
      getJpegRenditionUrl.mockResolvedValue({ ok: true, value: "https://storage.example.com/rendition.jpg" });

      fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
        const url = String(input);
        fetchCalls.push({ url, method: init?.method ?? "GET", body: await recordBody(init) });
        if (url === "https://storage.example.com/rendition.jpg") {
          return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
        }
        if (url.endsWith("/2/media/upload/initialize")) {
          return new Response("invalid_token", { status: 401 });
        }
        if (url.endsWith("/2/tweets")) {
          throw new Error("画像アップロード失敗時は tweet 投稿してはいけない");
        }
        throw new Error(`unexpected url: ${url}`);
      });

      const result = await runPublishWorkerBatch();
      expect(result.processed).toBe(1);

      expect(fetchCalls.some((c) => c.url.endsWith("/2/tweets"))).toBe(false);

      // postTweet の 401 分岐と同一の経路: channel expired 化 + scheduled 全件へフラグ + markFailed(E503)
      expect(markChannelAccountExpired).toHaveBeenCalledTimes(1);
      expect(markChannelAccountExpired).toHaveBeenCalledWith(expect.anything(), "x");
      expect(flagScheduledPostsForExpiredChannel).toHaveBeenCalledTimes(1);
      expect(flagScheduledPostsForExpiredChannel).toHaveBeenCalledWith(expect.anything(), "x");

      expect(markFailed).toHaveBeenCalledTimes(1);
      const call = markFailed.mock.calls[0];
      expect(call[2]).toMatchObject({ code: "KMB-E503" });
      expect(String(call[2].detail)).toContain("401");

      expect(markManualRequired).not.toHaveBeenCalled();
      expect(markPublished).not.toHaveBeenCalled();
    },
  );
});
