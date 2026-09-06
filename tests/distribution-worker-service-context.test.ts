import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApprovedDraft } from "@/modules/ai-studio/contracts";
import type { ChannelAccountRow, ChannelPostRow } from "@/modules/distribution/repository";

/**
 * canonical: docs/module-contracts.md §3 (ExecutionContext) / cms-ai-pipeline.md §8.2。
 * 2026-09-06 監査修正 #1 / #3 / #9:
 * - publish worker は pg_cron (/api/jobs/publish) から起動され cookie セッションを持たない。
 *   ai-studio / media / content の facade を cookie 前提のまま呼ぶと RLS で行が見えず全件 KMB-E101
 *   になっていた。worker は 3 facade を必ず `{ mode: "service", client: <service client> }` で呼ぶ。
 * - ApprovedDraft.run_id が契約に昇格し、site_blog 配信は draft.run_id を source_run_id に渡す
 *   (従来は常に manual_required)。
 * - X 課金ガードの当月合算 (getMonthlyXCostCentsSum) が読めない場合は 0 とみなさず KMB-E901 で拒否。
 */

const { serviceClientBox } = vi.hoisted(() => {
  const OPS_LIMITS = {
    x_monthly_post_limit: 1000,
    ai_monthly_budget_micro_usd: 50_000_000,
    ai_monthly_image_limit: 200,
    ai_default_image_model: null,
  };
  const serviceClient = {
    __kind: "fake-service-client",
    from: (table: string) => {
      if (table !== "site_settings") {
        throw new Error(`fake service client: 未対応のテーブルへのアクセスです (${table})`);
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { value: OPS_LIMITS }, error: null }),
          }),
        }),
      };
    },
  };
  return { OPS_LIMITS, serviceClientBox: { serviceClient } };
});

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

const createBlogPostFromDraft = vi.fn();
vi.mock("@/modules/content/facade", () => ({
  contentFacade: { createBlogPostFromDraft: (...args: unknown[]) => createBlogPostFromDraft(...args) },
}));

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
const updateXThreadProgress = vi.fn();
const markPublished = vi.fn();
const markFailed = vi.fn();
const markManualRequired = vi.fn();
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
    getMonthlyXCostCentsSum: (...args: unknown[]) => getMonthlyXCostCentsSum(...args),
  };
});

import { runPublishWorkerBatch } from "@/modules/distribution/internal/worker";

const X_ACCOUNT: ChannelAccountRow = {
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
    note_draft_status: "none",
    note_draft_url: null,
    idempotency_key: "idem-1",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function approved(channel: ApprovedDraft["channel"], content: unknown): ApprovedDraft {
  return {
    draft_id: "draft-1",
    run_id: "run-42",
    channel,
    content: content as ApprovedDraft["content"],
    approved_at: new Date().toISOString(),
  };
}

const SERVICE_CTX = { mode: "service", client: serviceClientBox.serviceClient };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  getMonthlyXCostCentsSum.mockResolvedValue({ ok: true, value: 0 });
  getChannelAccount.mockResolvedValue({ ok: true, value: X_ACCOUNT });
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

describe("publish worker は facade を service 文脈 (ExecutionContext) で呼ぶ (#1)", () => {
  it("getApprovedDraft は { mode:'service', client: <service client> } 付きで呼ばれる (cookie セッションに依存しない)", async () => {
    claimDueScheduledPosts.mockResolvedValue({ ok: true, value: [basePost()] });
    getApprovedDraft.mockResolvedValue({ ok: true, value: approved("x", { thread: [{ text: "hi", media_id: null }] }) });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: { id: "tweet-1" } }), { status: 200 }));

    await runPublishWorkerBatch();

    expect(getApprovedDraft).toHaveBeenCalledTimes(1);
    expect(getApprovedDraft).toHaveBeenCalledWith("draft-1", SERVICE_CTX);
    // client は createSupabaseServiceClient() の戻り値そのもの (同一性) — 新たに cookie client を作らない
    expect(getApprovedDraft.mock.calls[0][1].client).toBe(serviceClientBox.serviceClient);
    expect(markPublished).toHaveBeenCalledTimes(1);
  });

  it("X 画像付きツイートの getJpegRenditionUrl は service 文脈で呼ばれる", async () => {
    claimDueScheduledPosts.mockResolvedValue({ ok: true, value: [basePost()] });
    getApprovedDraft.mockResolvedValue({
      ok: true,
      value: approved("x", { thread: [{ text: "画像つき", media_id: "media-uuid-1" }] }),
    });
    getJpegRenditionUrl.mockResolvedValue({ ok: true, value: "https://storage.example.com/r.jpg" });
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url === "https://storage.example.com/r.jpg") return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      if (url.endsWith("/2/media/upload/initialize")) {
        return new Response(JSON.stringify({ data: { id: "x-media-1" } }), { status: 200 });
      }
      if (url.endsWith("/append")) return new Response(null, { status: 202 });
      if (url.endsWith("/finalize")) return new Response(JSON.stringify({ data: { id: "x-media-1" } }), { status: 200 });
      if (url.endsWith("/2/tweets")) return new Response(JSON.stringify({ data: { id: "tweet-1" } }), { status: 200 });
      throw new Error(`unexpected url: ${url}`);
    });

    await runPublishWorkerBatch();

    expect(getJpegRenditionUrl).toHaveBeenCalledWith("media-uuid-1", SERVICE_CTX);
    expect(markPublished).toHaveBeenCalledTimes(1);
  });

  it("Instagram の getJpegRenditionUrl も service 文脈で呼ばれる (media_ids 全件)", async () => {
    getChannelAccount.mockResolvedValue({
      ok: true,
      value: {
        ...X_ACCOUNT,
        channel: "instagram",
        vault_secret_name: "sns_instagram_token",
        meta: {
    ig_business_account_id: "ig-1",
    facebook_page_id: "page-1",
    username: "yamagishi",
    token_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  },
      },
    });
    vaultReadSecret.mockResolvedValue({
      ok: true,
      value: JSON.stringify({ access_token: "ig-token", expires_at: new Date(Date.now() + 86_400_000).toISOString() }),
    });
    claimDueScheduledPosts.mockResolvedValue({ ok: true, value: [basePost({ channel: "instagram" })] });
    getApprovedDraft.mockResolvedValue({
      ok: true,
      value: approved("instagram", { caption: "c", hashtags: ["a"], media_ids: ["m1", "m2"] }),
    });
    getJpegRenditionUrl.mockImplementation(async (id: string) => ({ ok: true, value: `https://s.example.com/${id}.jpg` }));
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/ig-1/media_publish")) return new Response(JSON.stringify({ id: "ig-media-1" }), { status: 200 });
      if (url.includes("/ig-1/media")) return new Response(JSON.stringify({ id: `c-${fetchMock.mock.calls.length}` }), { status: 200 });
      if ((init?.method ?? "GET") === "GET" && url.includes("fields=status_code")) {
        return new Response(JSON.stringify({ status_code: "FINISHED" }), { status: 200 });
      }
      throw new Error(`unexpected url: ${url}`);
    });

    await runPublishWorkerBatch();

    expect(getJpegRenditionUrl).toHaveBeenCalledTimes(2);
    for (const call of getJpegRenditionUrl.mock.calls) expect(call[1]).toEqual(SERVICE_CTX);
    expect(markPublished).toHaveBeenCalledWith(expect.anything(), "post-1", { externalId: "ig-media-1", externalUrl: null });
  });
});

describe("site_blog 配信: ApprovedDraft.run_id を source_run_id に渡し、createBlogPostFromDraft を service 文脈で呼ぶ (#1 / #3)", () => {
  it("run_id が契約フィールドとして渡り published になる (従来の manual_required 固定を解消)", async () => {
    claimDueScheduledPosts.mockResolvedValue({ ok: true, value: [basePost({ channel: "site_blog" })] });
    const content = {
      title: "t",
      excerpt: "e",
      body_md: "b",
      suggested_slug: "hello",
      cover_media_id: null,
      seo: { title: "t", description: "d" },
    };
    getApprovedDraft.mockResolvedValue({ ok: true, value: approved("site_blog", content) });
    createBlogPostFromDraft.mockResolvedValue({ ok: true, value: { post_id: "post-uuid", slug: "hello" } });

    await runPublishWorkerBatch();

    expect(createBlogPostFromDraft).toHaveBeenCalledTimes(1);
    const [input, ctx] = createBlogPostFromDraft.mock.calls[0];
    expect(input).toMatchObject({ ...content, source_run_id: "run-42" });
    expect(ctx).toEqual(SERVICE_CTX);
    expect(markManualRequired).not.toHaveBeenCalled();
    expect(markPublished).toHaveBeenCalledWith(expect.anything(), "post-1", {
      externalId: "post-uuid",
      externalUrl: "https://example.com/blog/hello",
    });
  });
});

describe("X 課金ガード: 当月合算が読めない場合は fail-closed (#9)", () => {
  it("getMonthlyXCostCentsSum が ok:false → X API を呼ばず KMB-E901 で markFailed (KMB-E505 ではない)", async () => {
    getMonthlyXCostCentsSum.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "connection reset" });
    claimDueScheduledPosts.mockResolvedValue({ ok: true, value: [basePost()] });
    getApprovedDraft.mockResolvedValue({ ok: true, value: approved("x", { thread: [{ text: "hi", media_id: null }] }) });
    fetchMock.mockImplementation(async (input: string | URL) => {
      throw new Error(`合算不読時は X API を呼んではいけない: ${String(input)}`);
    });

    await runPublishWorkerBatch();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(getApprovedDraft).not.toHaveBeenCalled();
    expect(markFailed).toHaveBeenCalledTimes(1);
    const call = markFailed.mock.calls[0];
    expect(call[2]).toMatchObject({ code: "KMB-E901" });
    expect(String(call[2].detail)).toContain("合算");
    expect(String(call[2].detail)).toContain("connection reset");
    expect(markPublished).not.toHaveBeenCalled();
  });
});
