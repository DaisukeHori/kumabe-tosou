import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApprovedDraft } from "@/modules/ai-studio/contracts";
import type { ChannelAccountRow, ChannelPostRow } from "@/modules/distribution/repository";

/**
 * canonical: cms-ai-pipeline.md §8.1 / §8.2 (Instagram)。worker.ts の publishInstagramPost
 * (runPublishWorkerBatch 経由) を、repository / media facade / ai-studio bridge を vi.mock し、
 * Graph API への実 HTTP のみ fetch モックで検証する。2026-09-06 監査修正 #4 / #5。
 */

const { serviceClientBox } = vi.hoisted(() => ({
  serviceClientBox: {
    serviceClient: {
      from: (table: string) => {
        throw new Error(`fake service client: 未対応のテーブルへのアクセスです (${table})`);
      },
    },
  },
}));

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ NEXT_PUBLIC_SITE_URL: "https://example.com" }),
}));
// X の OAuth クライアント認証情報は DB (設定 > 外部連携) → env の順に解決される。このテストでは未設定にする
vi.mock("@/lib/integration-credentials", () => ({
  resolveIntegrationCredentials: async (provider: string) => ({ provider, publicId: null, secret: null, source: "none" }),
  isIntegrationConfigured: async () => false,
}));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => serviceClientBox.serviceClient as unknown,
}));
vi.mock("@/modules/content/facade", () => ({ contentFacade: { createBlogPostFromDraft: vi.fn() } }));

const getJpegRenditionUrl = vi.fn();
vi.mock("@/modules/media/facade", () => ({
  mediaFacade: { getJpegRenditionUrl: (...args: unknown[]) => getJpegRenditionUrl(...args) },
}));

const getApprovedDraft = vi.fn();
vi.mock("@/modules/distribution/internal/ai-studio-bridge", () => ({
  resolveAiStudioFacade: async () => ({ getApprovedDraft: (...args: unknown[]) => getApprovedDraft(...args) }),
  tryResolveAiStudioWatchdogSweep: async () => null,
}));

const claimDueScheduledPosts = vi.fn();
const getChannelAccount = vi.fn();
const vaultReadSecret = vi.fn();
const markPublished = vi.fn();
const markFailed = vi.fn();
const markManualRequired = vi.fn();
const markChannelAccountExpired = vi.fn();
const flagScheduledPostsForExpiredChannel = vi.fn();

vi.mock("@/modules/distribution/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/distribution/repository")>();
  return {
    ...actual,
    claimDueScheduledPosts: (...args: unknown[]) => claimDueScheduledPosts(...args),
    getChannelAccount: (...args: unknown[]) => getChannelAccount(...args),
    vaultReadSecret: (...args: unknown[]) => vaultReadSecret(...args),
    markPublished: (...args: unknown[]) => markPublished(...args),
    markFailed: (...args: unknown[]) => markFailed(...args),
    markManualRequired: (...args: unknown[]) => markManualRequired(...args),
    markChannelAccountExpired: (...args: unknown[]) => markChannelAccountExpired(...args),
    flagScheduledPostsForExpiredChannel: (...args: unknown[]) => flagScheduledPostsForExpiredChannel(...args),
  };
});

import { CONTAINER_STATUS_MAX_ATTEMPTS } from "@/modules/distribution/internal/instagram-api";
import { runPublishWorkerBatch } from "@/modules/distribution/internal/worker";

const IG_ACCOUNT: ChannelAccountRow = {
  channel: "instagram",
  account_label: "yamagishi",
  auth_status: "connected",
  vault_secret_name: "sns_instagram_token",
  meta: {
    ig_business_account_id: "ig-1",
    facebook_page_id: "page-1",
    username: "yamagishi",
    token_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  },
  connected_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  token_refresh_lease_expires_at: null,
};

function igPost(): ChannelPostRow {
  return {
    id: "post-1",
    draft_id: "draft-1",
    channel: "instagram",
    status: "publishing",
    scheduled_at: new Date().toISOString(),
    published_at: null,
    external_id: null,
    external_url: null,
    tweet_count: null,
    url_count: null,
    estimated_cost_cents: 0,
    attempt_count: 1,
    last_error_code: null,
    last_error_detail: null,
    note_draft_status: "none",
    note_draft_url: null,
    idempotency_key: "idem-1",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function igDraft(mediaIds: string[] = ["m1"]): ApprovedDraft {
  return {
    draft_id: "draft-1",
    run_id: "run-1",
    channel: "instagram",
    content: { caption: "キャプション", hashtags: ["塗装"], media_ids: mediaIds } as unknown as ApprovedDraft["content"],
    approved_at: new Date().toISOString(),
  };
}

type Call = { url: string; method: string };
let calls: Call[];
let fetchMock: ReturnType<typeof vi.fn>;

function graphError(status: number, error: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ error }), { status });
}

/** Graph API の標準的な応答を組み立てる。statusCodes はコンテナ状態確認の応答列。 */
function installGraphMock(opts: { statusCodes: string[]; publish?: () => Response; create?: () => Response }) {
  let statusIdx = 0;
  fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.includes("/ig-1/media_publish")) {
      return opts.publish ? opts.publish() : new Response(JSON.stringify({ id: "ig-media-1" }), { status: 200 });
    }
    if (url.includes("/ig-1/media")) {
      return opts.create ? opts.create() : new Response(JSON.stringify({ id: "creation-1" }), { status: 200 });
    }
    if (method === "GET" && url.includes("/creation-1?")) {
      const code = opts.statusCodes[Math.min(statusIdx, opts.statusCodes.length - 1)];
      statusIdx += 1;
      return new Response(JSON.stringify({ status_code: code }), { status: 200 });
    }
    throw new Error(`unexpected url: ${method} ${url}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  claimDueScheduledPosts.mockResolvedValue({ ok: true, value: [igPost()] });
  getApprovedDraft.mockResolvedValue({ ok: true, value: igDraft() });
  getChannelAccount.mockResolvedValue({ ok: true, value: IG_ACCOUNT });
  vaultReadSecret.mockResolvedValue({
    ok: true,
    value: JSON.stringify({ access_token: "ig-token", expires_at: new Date(Date.now() + 86_400_000).toISOString() }),
  });
  getJpegRenditionUrl.mockImplementation(async (id: string) => ({ ok: true, value: `https://s.example.com/${id}.jpg` }));
  markPublished.mockResolvedValue({ ok: true, value: undefined });
  markFailed.mockResolvedValue({ ok: true, value: undefined });
  markManualRequired.mockResolvedValue({ ok: true, value: undefined });
  markChannelAccountExpired.mockResolvedValue({ ok: true, value: undefined });
  flagScheduledPostsForExpiredChannel.mockResolvedValue({ ok: true, value: undefined });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("publishInstagramPost: コンテナ状態確認 (#5)", () => {
  it("作成 → status_code=FINISHED を確認してから media_publish → published", async () => {
    installGraphMock({ statusCodes: ["FINISHED"] });

    await runPublishWorkerBatch();

    const order = calls.map((c) => (c.url.includes("media_publish") ? "publish" : c.method === "GET" ? "status" : "create"));
    expect(order).toEqual(["create", "status", "publish"]);
    expect(markPublished).toHaveBeenCalledWith(expect.anything(), "post-1", { externalId: "ig-media-1", externalUrl: null });
    expect(markFailed).not.toHaveBeenCalled();
    expect(markManualRequired).not.toHaveBeenCalled();
  });

  it("IN_PROGRESS の間はバックオフして待ち、FINISHED になってから publish する", async () => {
    vi.useFakeTimers();
    installGraphMock({ statusCodes: ["IN_PROGRESS", "IN_PROGRESS", "FINISHED"] });

    const run = runPublishWorkerBatch();
    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 10);
    await run;

    expect(calls.filter((c) => c.method === "GET")).toHaveLength(3);
    expect(calls.some((c) => c.url.includes("media_publish"))).toBe(true);
    expect(markPublished).toHaveBeenCalledTimes(1);
  });

  it("status_code=ERROR は publish せず failed (KMB-E502、確定エラー)", async () => {
    installGraphMock({ statusCodes: ["ERROR"] });

    await runPublishWorkerBatch();

    expect(calls.some((c) => c.url.includes("media_publish"))).toBe(false);
    expect(markFailed).toHaveBeenCalledTimes(1);
    expect(markFailed.mock.calls[0][2]).toMatchObject({ code: "KMB-E502" });
    expect(String(markFailed.mock.calls[0][2].detail)).toContain("ERROR");
    expect(markManualRequired).not.toHaveBeenCalled();
    expect(markChannelAccountExpired).not.toHaveBeenCalled();
  });

  it("上限回数まで IN_PROGRESS のままなら publish せず manual_required (KMB-E506、creation_id を external_id に残す)", async () => {
    vi.useFakeTimers();
    installGraphMock({ statusCodes: ["IN_PROGRESS"] });

    const run = runPublishWorkerBatch();
    await vi.advanceTimersByTimeAsync(120_000);
    await run;

    expect(calls.filter((c) => c.method === "GET")).toHaveLength(CONTAINER_STATUS_MAX_ATTEMPTS);
    expect(calls.some((c) => c.url.includes("media_publish"))).toBe(false);
    expect(markManualRequired).toHaveBeenCalledTimes(1);
    expect(markManualRequired.mock.calls[0][2]).toMatchObject({ code: "KMB-E506", externalId: "creation-1" });
    expect(markFailed).not.toHaveBeenCalled();
    expect(markPublished).not.toHaveBeenCalled();
  });
});

describe("publishInstagramPost: トークン失効の判定 (#4)", () => {
  it("コンテナ作成が 400 + error.code=190 (OAuthException) → 401 と同じ失効経路 (expired + scheduled フラグ + failed E503)", async () => {
    installGraphMock({
      statusCodes: ["FINISHED"],
      create: () => graphError(400, { message: "Error validating access token", type: "OAuthException", code: 190 }),
    });

    await runPublishWorkerBatch();

    expect(markChannelAccountExpired).toHaveBeenCalledWith(expect.anything(), "instagram");
    expect(flagScheduledPostsForExpiredChannel).toHaveBeenCalledWith(expect.anything(), "instagram");
    expect(markFailed).toHaveBeenCalledTimes(1);
    expect(markFailed.mock.calls[0][2]).toMatchObject({ code: "KMB-E503" });
    expect(String(markFailed.mock.calls[0][2].detail)).toContain("失効");
    expect(markPublished).not.toHaveBeenCalled();
  });

  it("media_publish が type=OAuthException (code 190 以外) でも失効経路に流す", async () => {
    installGraphMock({
      statusCodes: ["FINISHED"],
      publish: () => graphError(400, { message: "Session has expired", type: "OAuthException", code: 102 }),
    });

    await runPublishWorkerBatch();

    expect(markChannelAccountExpired).toHaveBeenCalledTimes(1);
    expect(markFailed.mock.calls[0][2]).toMatchObject({ code: "KMB-E503" });
  });

  it("HTTP 401 は従来どおり失効経路 (非退行)", async () => {
    installGraphMock({ statusCodes: ["FINISHED"], create: () => new Response("unauthorized", { status: 401 }) });

    await runPublishWorkerBatch();

    expect(markChannelAccountExpired).toHaveBeenCalledTimes(1);
    expect(markFailed.mock.calls[0][2]).toMatchObject({ code: "KMB-E503" });
  });

  it("400 + code 100 (GraphMethodException) は失効ではなく通常の確定失敗 (KMB-E502) — expired 化しない", async () => {
    installGraphMock({
      statusCodes: ["FINISHED"],
      create: () => graphError(400, { message: "Invalid parameter", type: "GraphMethodException", code: 100 }),
    });

    await runPublishWorkerBatch();

    expect(markChannelAccountExpired).not.toHaveBeenCalled();
    expect(flagScheduledPostsForExpiredChannel).not.toHaveBeenCalled();
    expect(markFailed.mock.calls[0][2]).toMatchObject({ code: "KMB-E502" });
  });
});
