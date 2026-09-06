import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/module-contracts.md §3 (ExecutionContext の 1 の形: `ctx?: ExecutionContext`)。
 * 2026-09-06 監査修正 #1 / #3: AiStudioFacade.getApprovedDraft / MediaFacade.getJpegRenditionUrl /
 * ContentFacade.createBlogPostFromDraft が
 * - ctx 省略時は従来どおり cookie セッション client (createSupabaseServerClient) を使い (非退行)、
 * - `{ mode: "service", client }` では cookie client を一切生成せず注入 client を使う
 * ことと、getApprovedDraft が run_id を返すことを検証する。
 */

const createSupabaseServerClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: (...args: unknown[]) => createSupabaseServerClient(...args),
}));
const createSupabaseServiceClient = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: (...args: unknown[]) => createSupabaseServiceClient(...args),
}));
vi.mock("@/lib/supabase/session", () => ({ getSessionAndClient: vi.fn() }));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co", NEXT_PUBLIC_SITE_URL: "https://example.com" }),
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

// ai-studio facade の他依存 (画像生成等) は本テストでは触らない
vi.mock("@/modules/ai-providers/facade", () => ({ aiProvidersFacade: {} }));
vi.mock("@/modules/settings/facade", () => ({ settingsFacade: {} }));
vi.mock("@/modules/ai-studio/internal/claude", () => ({}));
vi.mock("@/modules/ai-studio/internal/transcribe", () => ({}));

const getDraft = vi.fn();
vi.mock("@/modules/ai-studio/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/ai-studio/repository")>();
  return { ...actual, getDraft: (...args: unknown[]) => getDraft(...args) };
});

const renditionExists = vi.fn();
const buildPublicRenditionUrl = vi.fn();
vi.mock("@/modules/media/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/media/repository")>();
  return {
    ...actual,
    renditionExists: (...args: unknown[]) => renditionExists(...args),
    buildPublicRenditionUrl: (...args: unknown[]) => buildPublicRenditionUrl(...args),
  };
});

const insertPublishedBlogPost = vi.fn();
vi.mock("@/modules/content/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/content/repository")>();
  return { ...actual, insertPublishedBlogPost: (...args: unknown[]) => insertPublishedBlogPost(...args) };
});

import { aiStudioFacade } from "@/modules/ai-studio/facade";
import { contentFacade } from "@/modules/content/facade";
import { mediaFacade } from "@/modules/media/facade";

const SESSION_CLIENT = { __kind: "session" };
const INJECTED_CLIENT = { __kind: "injected-service" } as unknown as import("@supabase/supabase-js").SupabaseClient;
const GENERATED_SERVICE_CLIENT = { __kind: "generated-service" };

const DRAFT_ROW = {
  id: "draft-1",
  run_id: "run-1",
  channel: "x",
  status: "approved",
  content: { thread: [] },
  claims: [],
  current_revision: 1,
  reviewed_by: "u",
  reviewed_at: "2026-09-06T00:00:00.000Z",
  created_at: "2026-09-06T00:00:00.000Z",
};

const BLOG_INPUT = {
  title: "t",
  excerpt: "e",
  body_md: "b",
  suggested_slug: "hello",
  cover_media_id: null,
  seo: { title: "t", description: "d" },
  source_run_id: "run-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  createSupabaseServerClient.mockResolvedValue(SESSION_CLIENT);
  createSupabaseServiceClient.mockReturnValue(GENERATED_SERVICE_CLIENT);
  getDraft.mockResolvedValue(DRAFT_ROW);
  renditionExists.mockResolvedValue(true);
  buildPublicRenditionUrl.mockReturnValue("https://proj.supabase.co/storage/v1/object/public/media/x.jpg");
  insertPublishedBlogPost.mockResolvedValue({ ok: true, value: { id: "post-uuid" } });
});

describe("AiStudioFacade.getApprovedDraft", () => {
  it("ctx 省略 → cookie セッション client を使う (非退行)。run_id を返す (#3)", async () => {
    const result = await aiStudioFacade.getApprovedDraft("draft-1");
    expect(result).toEqual({
      ok: true,
      value: { draft_id: "draft-1", run_id: "run-1", channel: "x", content: { thread: [] }, approved_at: DRAFT_ROW.reviewed_at },
    });
    expect(createSupabaseServerClient).toHaveBeenCalledTimes(1);
    expect(getDraft).toHaveBeenCalledWith(SESSION_CLIENT, "draft-1");
  });

  it("{ mode:'service', client } → cookie client を生成せず注入 client で読む (#1)", async () => {
    const result = await aiStudioFacade.getApprovedDraft("draft-1", { mode: "service", client: INJECTED_CLIENT });
    expect(result.ok).toBe(true);
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(createSupabaseServiceClient).not.toHaveBeenCalled();
    expect(getDraft).toHaveBeenCalledWith(INJECTED_CLIENT, "draft-1");
  });

  it("{ mode:'service' } (client 省略) → service client を生成して使う", async () => {
    await aiStudioFacade.getApprovedDraft("draft-1", { mode: "service" });
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(createSupabaseServiceClient).toHaveBeenCalledTimes(1);
    expect(getDraft).toHaveBeenCalledWith(GENERATED_SERVICE_CLIENT, "draft-1");
  });

  it("approved 以外は service 文脈でも KMB-E101 (認可意味論は変えない)", async () => {
    getDraft.mockResolvedValue({ ...DRAFT_ROW, status: "needs_review" });
    const result = await aiStudioFacade.getApprovedDraft("draft-1", { mode: "service", client: INJECTED_CLIENT });
    expect(result).toMatchObject({ ok: false, code: "KMB-E101" });
  });
});

describe("MediaFacade.getJpegRenditionUrl", () => {
  it("ctx 省略 → cookie セッション client (非退行)", async () => {
    const result = await mediaFacade.getJpegRenditionUrl("media-1");
    expect(result.ok).toBe(true);
    expect(createSupabaseServerClient).toHaveBeenCalledTimes(1);
    expect(renditionExists).toHaveBeenCalledWith(SESSION_CLIENT, expect.stringContaining("media-1"));
  });

  it("{ mode:'service', client } → 注入 client で Storage を扱う (#1)", async () => {
    const result = await mediaFacade.getJpegRenditionUrl("media-1", { mode: "service", client: INJECTED_CLIENT });
    expect(result.ok).toBe(true);
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(renditionExists).toHaveBeenCalledWith(INJECTED_CLIENT, expect.stringContaining("media-1"));
    expect(buildPublicRenditionUrl).toHaveBeenCalledWith(INJECTED_CLIENT, expect.stringContaining("media-1"));
  });
});

describe("ContentFacade.createBlogPostFromDraft", () => {
  it("ctx 省略 → cookie セッション client (非退行)", async () => {
    const result = await contentFacade.createBlogPostFromDraft(BLOG_INPUT);
    expect(result).toEqual({ ok: true, value: { post_id: "post-uuid", slug: "hello" } });
    expect(createSupabaseServerClient).toHaveBeenCalledTimes(1);
    expect(insertPublishedBlogPost.mock.calls[0][0]).toBe(SESSION_CLIENT);
  });

  it("{ mode:'service', client } → 注入 client で insert する (#1)", async () => {
    const result = await contentFacade.createBlogPostFromDraft(BLOG_INPUT, { mode: "service", client: INJECTED_CLIENT });
    expect(result).toEqual({ ok: true, value: { post_id: "post-uuid", slug: "hello" } });
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(insertPublishedBlogPost.mock.calls[0][0]).toBe(INJECTED_CLIENT);
    expect(insertPublishedBlogPost.mock.calls[0][1]).toMatchObject({ slug: "hello", source_run_id: "run-1" });
  });
});
