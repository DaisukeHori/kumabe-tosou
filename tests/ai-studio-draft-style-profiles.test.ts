import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * canonical: GitHub Issue #20 (「ai-studio モジュールは distribution モジュールに依存できない」
 * 制約から style_profiles を BRAND_SYSTEM_PROMPT にハードコードしていた箇所の正式解。
 * docs/module-contracts.md §5 DistributionFacade.getStyleProfiles のコメント参照)。
 *
 * 検証観点:
 * - startRun: styleProfiles 引数が ai_runs.style_profiles として確定保存される
 *   (契約違反の styleProfiles は KMB-E101 で拒否する)
 * - drafting ステージ (runOneStage): チャネルごとに ai_runs.style_profiles から取り出した
 *   プロファイル (tone_instructions/format_rules/example_output) が生成プロンプトに反映される
 *   (旧 DEFAULT_STYLE_PROFILES ハードコードへの後退がないこと)
 * - regenerateDraft: 同一 run の style_profiles を再生成でも使い続ける
 */

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({}) as unknown,
}));

const sessionMock = vi.fn();
vi.mock("@/lib/supabase/session", () => ({
  getSessionAndClient: (...args: unknown[]) => sessionMock(...args),
}));

const generateTextMock = vi.fn();
vi.mock("@/modules/ai-providers/facade", () => ({
  aiProvidersFacade: { generateText: (...args: unknown[]) => generateTextMock(...args), generateImages: vi.fn() },
}));

vi.mock("@/modules/media/facade", () => ({
  mediaFacade: { createFromBytes: vi.fn(), getPublicUrl: vi.fn() },
}));

vi.mock("@/modules/settings/facade", () => ({
  settingsFacade: { get: vi.fn() },
}));

const acquireLeaseMock = vi.fn();
const heartbeatLeaseMock = vi.fn();
const commitStageMock = vi.fn();
const releaseLeaseAfterFailureMock = vi.fn();
const getSourceMock = vi.fn();
const insertRunMock = vi.fn();
const getRunMock = vi.fn();
const getDraftMock = vi.fn();
const insertAiRevisionMock = vi.fn();

vi.mock("@/modules/ai-studio/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/ai-studio/repository")>();
  return {
    ...actual,
    acquireLease: (...args: unknown[]) => acquireLeaseMock(...args),
    heartbeatLease: (...args: unknown[]) => heartbeatLeaseMock(...args),
    commitStage: (...args: unknown[]) => commitStageMock(...args),
    releaseLeaseAfterFailure: (...args: unknown[]) => releaseLeaseAfterFailureMock(...args),
    getSource: (...args: unknown[]) => getSourceMock(...args),
    insertRun: (...args: unknown[]) => insertRunMock(...args),
    getRun: (...args: unknown[]) => getRunMock(...args),
    getDraft: (...args: unknown[]) => getDraftMock(...args),
    insertAiRevision: (...args: unknown[]) => insertAiRevisionMock(...args),
  };
});

import { aiStudioFacade } from "@/modules/ai-studio/facade";
import type { StyleProfilesByChannel } from "@/modules/ai-studio/contracts";

const BRIEF = {
  theme: "耐候クリアの魅力",
  topics: ["塗装"],
  audience: "一般",
  keywords: ["耐候"],
  claims: [],
};

function styleProfiles(overrides: Partial<StyleProfilesByChannel> = {}): StyleProfilesByChannel {
  return {
    site_blog: { tone_instructions: "SITE_BLOG向けの独自トーン指示", format_rules: "SITE_BLOG向けの独自構成ルール", example_output: null },
    note: { tone_instructions: "NOTE向けの独自トーン指示", format_rules: "NOTE向けの独自構成ルール", example_output: null },
    x: { tone_instructions: "X向けの独自トーン指示", format_rules: "X向けの独自構成ルール", example_output: "Xお手本ツイート本文" },
    instagram: { tone_instructions: "IG向けの独自トーン指示", format_rules: "IG向けの独自構成ルール", example_output: null },
    ...overrides,
  };
}

function acquiredDraftingRow(targetChannels: string[], profiles: StyleProfilesByChannel) {
  return {
    id: "run-1",
    status: "drafting",
    lease_expires_at: new Date(Date.now() + 90_000).toISOString(),
    stage_attempts: 1,
    research_enabled: false,
    target_channels: targetChannels,
    source_id: "source-1",
    brief: BRIEF,
    research_notes: null,
    style_profiles: profiles,
    result_kind: "acquired",
  };
}

function siteBlogGenerateTextResult() {
  return {
    ok: true,
    value: {
      text: JSON.stringify({
        content: {
          title: "タイトル",
          excerpt: "抜粋",
          body_md: "本文本文本文".repeat(20),
          suggested_slug: "taitoru-slug",
          cover_media_id: null,
        },
        claims: [],
      }),
      provider: "anthropic",
      model: "claude-opus-4-8",
      usage: { inputTokens: 10, outputTokens: 20, cachedInputTokens: 0, cacheWriteInputTokens: 0, webSearchRequests: 0 },
      costMicroUsd: 100,
      stopReason: "end_turn",
    },
  };
}

function xGenerateTextResult() {
  return {
    ok: true,
    value: {
      text: JSON.stringify({
        content: { thread: [{ text: "新しい塗装が完成しました", media_id: null }] },
        claims: [],
      }),
      provider: "anthropic",
      model: "claude-opus-4-8",
      usage: { inputTokens: 10, outputTokens: 20, cachedInputTokens: 0, cacheWriteInputTokens: 0, webSearchRequests: 0 },
      costMicroUsd: 100,
      stopReason: "end_turn",
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  commitStageMock.mockResolvedValue("ready_for_review");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("drafting ステージ: ai_runs.style_profiles がチャネル別に生成プロンプトへ反映される", () => {
  it("2チャネル (site_blog/x) それぞれ異なる style_profiles がそのチャネル向け userPrompt にのみ現れる", async () => {
    const profiles = styleProfiles();
    acquireLeaseMock.mockResolvedValue(acquiredDraftingRow(["site_blog", "x"], profiles));
    generateTextMock.mockResolvedValueOnce(siteBlogGenerateTextResult()).mockResolvedValueOnce(xGenerateTextResult());

    const outcome = await aiStudioFacade.advanceRunDetailed("run-1");

    expect(outcome).toEqual({ kind: "advanced", status: "ready_for_review" });
    expect(generateTextMock).toHaveBeenCalledTimes(2);

    const prompts = generateTextMock.mock.calls.map((call) => (call[0] as { messages: { content: string }[] }).messages[0].content);
    const siteBlogPrompt = prompts.find((p) => p.includes("チャネル「site_blog」"));
    const xPrompt = prompts.find((p) => p.includes("チャネル「x」"));

    expect(siteBlogPrompt).toContain("SITE_BLOG向けの独自トーン指示");
    expect(siteBlogPrompt).toContain("SITE_BLOG向けの独自構成ルール");
    expect(siteBlogPrompt).not.toContain("X向けの独自トーン指示");

    expect(xPrompt).toContain("X向けの独自トーン指示");
    expect(xPrompt).toContain("X向けの独自構成ルール");
    // example_output が設定されているチャネル (x) は few-shot ブロックとして反映される
    expect(xPrompt).toContain("Xお手本ツイート本文");
    expect(xPrompt).not.toContain("SITE_BLOG向けの独自トーン指示");
  });

  it("example_output が null のチャネルは「お手本」ブロックを含まない", async () => {
    const profiles = styleProfiles();
    acquireLeaseMock.mockResolvedValue(acquiredDraftingRow(["site_blog"], profiles));
    generateTextMock.mockResolvedValueOnce(siteBlogGenerateTextResult());

    await aiStudioFacade.advanceRunDetailed("run-1");

    const prompt = (generateTextMock.mock.calls[0][0] as { messages: { content: string }[] }).messages[0].content;
    expect(prompt).not.toContain("# お手本");
  });

  it("style_profiles にチャネルが欠けている (契約違反) 場合は KMB-E901 で失敗しステージを進めない", async () => {
    const incomplete = { ...styleProfiles() } as Partial<StyleProfilesByChannel>;
    delete incomplete.site_blog;
    acquireLeaseMock.mockResolvedValue({
      ...acquiredDraftingRow(["site_blog"], styleProfiles()),
      style_profiles: incomplete,
    });

    const outcome = await aiStudioFacade.advanceRunDetailed("run-1");

    expect(outcome).toMatchObject({ kind: "error", code: "KMB-E901" });
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(commitStageMock).not.toHaveBeenCalled();
  });
});

describe("regenerateDraft: 再生成も同一 run の style_profiles を使う", () => {
  it("run.style_profiles から対象チャネル分のプロファイルを取り出し userPrompt に反映する", async () => {
    const profiles = styleProfiles();
    getDraftMock.mockResolvedValue({
      id: "draft-x",
      run_id: "run-1",
      channel: "x",
      status: "needs_review",
      content: { thread: [{ text: "旧本文", media_id: null }] },
      claims: [],
      current_revision: 1,
      reviewed_by: null,
      reviewed_at: null,
      created_at: "2026-07-12T00:00:00.000Z",
    });
    getRunMock.mockResolvedValue({
      id: "run-1",
      source_id: "source-1",
      status: "ready_for_review",
      target_channels: ["x"],
      research_enabled: false,
      brief: BRIEF,
      research_notes: null,
      error_code: null,
      token_usage: null,
      lease_expires_at: null,
      stage_attempts: 0,
      image_candidates: [],
      style_profiles: profiles,
      created_by: null,
      created_at: "2026-07-12T00:00:00.000Z",
      updated_at: "2026-07-12T00:00:00.000Z",
    });
    generateTextMock.mockResolvedValueOnce(xGenerateTextResult());
    insertAiRevisionMock.mockResolvedValue(2);

    const result = await aiStudioFacade.regenerateDraft("draft-x", "もっと簡潔に");

    expect(result).toEqual({ ok: true, value: { revision: 2 } });
    const prompt = (generateTextMock.mock.calls[0][0] as { messages: { content: string }[] }).messages[0].content;
    expect(prompt).toContain("X向けの独自トーン指示");
    expect(prompt).toContain("Xお手本ツイート本文");
  });
});

describe("startRun: styleProfiles 引数を ai_runs.style_profiles として確定保存する", () => {
  beforeEach(() => {
    sessionMock.mockResolvedValue({ supabase: {} as unknown as SupabaseClient, user: { id: "admin-1" } });
    getSourceMock.mockResolvedValue({
      id: "source-1",
      input_type: "text",
      audio_storage_path: null,
      raw_text: "元テキスト",
      cleaned_text: "整文済みテキスト",
      cleaned_at: "2026-07-12T00:00:00.000Z",
      transcript_status: "cleaned",
      duration_seconds: null,
      created_by: "admin-1",
      created_at: "2026-07-12T00:00:00.000Z",
    });
    insertRunMock.mockResolvedValue("run-1");
  });

  it("正常な styleProfiles を渡すと insertRun にそのまま渡る", async () => {
    const profiles = styleProfiles();
    const result = await aiStudioFacade.startRun("source-1", ["x"], false, profiles);

    expect(result).toEqual({ ok: true, value: { run_id: "run-1" } });
    expect(insertRunMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sourceId: "source-1", styleProfiles: profiles }),
    );
  });

  it("styleProfiles にチャネルが欠けている場合は KMB-E101 で拒否し insertRun を呼ばない", async () => {
    const incomplete = { ...styleProfiles() } as Partial<StyleProfilesByChannel>;
    delete incomplete.instagram;

    const result = await aiStudioFacade.startRun("source-1", ["x"], false, incomplete as StyleProfilesByChannel);

    expect(result).toMatchObject({ ok: false, code: "KMB-E101" });
    expect(insertRunMock).not.toHaveBeenCalled();
  });
});
