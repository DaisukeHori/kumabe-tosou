import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/ai-studio-v2.md §7 (SNS 生成の画像統合、P4)。
 *
 * advanceRunDetailed の image_generation ステージ (facade.ts runOneStage) を、
 * repository / ai-providers facade / media facade / settings facade をすべてモックして検証する
 * (実 API はコスト発生のため CI 禁止。実疎通は接続テストで人が実行 — 設計書 §13 テスト戦略)。
 *
 * 検証観点 (タスク指示のテスト項目と対応):
 * - X/IG を含む run のみ 4 枚生成→候補保持、含まない run では skip
 * - 部分成功 (<4枚)・0枚・E407 の graceful 挙動 (常に ready_for_review へ前進)
 * - 画像プロンプト起案の入力元テキスト (instagram キャプション優先 / x スレッド / brief.theme)
 */

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({}) as unknown,
}));

const generateTextMock = vi.fn();
const generateImagesMock = vi.fn();
vi.mock("@/modules/ai-providers/facade", () => ({
  aiProvidersFacade: {
    generateText: (...args: unknown[]) => generateTextMock(...args),
    generateImages: (...args: unknown[]) => generateImagesMock(...args),
  },
}));

const createFromBytesMock = vi.fn();
vi.mock("@/modules/media/facade", () => ({
  mediaFacade: {
    createFromBytes: (...args: unknown[]) => createFromBytesMock(...args),
    getPublicUrl: vi.fn(),
  },
}));

const settingsGetMock = vi.fn();
vi.mock("@/modules/settings/facade", () => ({
  settingsFacade: { get: (...args: unknown[]) => settingsGetMock(...args) },
}));

const acquireLeaseMock = vi.fn();
const heartbeatLeaseMock = vi.fn();
const commitImageStageMock = vi.fn();
const listDraftsForRunMock = vi.fn();
const releaseLeaseAfterFailureMock = vi.fn();

vi.mock("@/modules/ai-studio/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/ai-studio/repository")>();
  return {
    ...actual,
    acquireLease: (...args: unknown[]) => acquireLeaseMock(...args),
    heartbeatLease: (...args: unknown[]) => heartbeatLeaseMock(...args),
    commitImageStage: (...args: unknown[]) => commitImageStageMock(...args),
    listDraftsForRun: (...args: unknown[]) => listDraftsForRunMock(...args),
    releaseLeaseAfterFailure: (...args: unknown[]) => releaseLeaseAfterFailureMock(...args),
  };
});

import { aiStudioFacade } from "@/modules/ai-studio/facade";

const OPS_LIMITS_WITH_MODEL = {
  x_monthly_post_limit: 100,
  ai_monthly_budget_micro_usd: 50_000_000,
  ai_monthly_image_limit: 200,
  ai_default_image_model: "gpt-image-2",
};

function acquiredRow(overrides: {
  target_channels: string[];
  brief?: unknown;
}): Record<string, unknown> {
  return {
    id: "run-1",
    status: "image_generation",
    lease_expires_at: new Date(Date.now() + 90_000).toISOString(),
    stage_attempts: 1,
    research_enabled: false,
    target_channels: overrides.target_channels,
    source_id: "source-1",
    brief: overrides.brief ?? { theme: "耐候クリアの魅力", topics: ["塗装"], audience: "一般", keywords: [], claims: [] },
    research_notes: null,
    result_kind: "acquired",
  };
}

function draftRow(channel: "x" | "instagram", content: unknown) {
  return {
    id: `draft-${channel}`,
    run_id: "run-1",
    channel,
    status: "needs_review",
    content,
    claims: [],
    current_revision: 1,
    reviewed_by: null,
    reviewed_at: null,
    created_at: "2026-07-10T00:00:00.000Z",
  };
}

function mockValidPromptAndImages(imageCount: number, failedCount = 0) {
  generateTextMock.mockResolvedValue({
    ok: true,
    value: {
      text: JSON.stringify({ image_prompt: "a photorealistic freshly painted car in a workshop" }),
      provider: "openai",
      model: "gpt-5",
      usage: { inputTokens: 10, outputTokens: 20, cachedInputTokens: 0, cacheWriteInputTokens: 0, webSearchRequests: 0 },
      costMicroUsd: 100,
      stopReason: "end_turn",
    },
  });
  generateImagesMock.mockResolvedValue({
    ok: true,
    value: {
      images: Array.from({ length: imageCount }, (_, i) => ({
        dataBase64: Buffer.from(`img-${i}`).toString("base64"),
        mimeType: "image/png",
      })),
      provider: "openai",
      model: "gpt-image-2",
      costMicroUsd: 4000,
      failedCount,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  settingsGetMock.mockResolvedValue({ ok: true, value: OPS_LIMITS_WITH_MODEL });
  commitImageStageMock.mockResolvedValue("ready_for_review");
  let counter = 0;
  createFromBytesMock.mockImplementation(async () => {
    counter += 1;
    return { ok: true, value: { id: `media-${counter}`, storagePath: `ai-generated/media-${counter}.png` } };
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("image_generation ステージ: X/IG を含む run", () => {
  it("4 枚生成 → media 保存 → candidates として commitImageStage に渡り ready_for_review へ前進する", async () => {
    acquireLeaseMock.mockResolvedValue(acquiredRow({ target_channels: ["x", "instagram"] }));
    listDraftsForRunMock.mockResolvedValue([
      draftRow("x", { thread: [{ text: "新しい塗装が完成しました", media_id: null }] }),
      draftRow("instagram", {
        caption: "耐候クリアで仕上げた車体です",
        hashtags: ["塗装", "カー", "隈部塗装", "福岡", "自動車"],
        media_ids: ["00000000-0000-4000-8000-000000000000"],
      }),
    ]);
    mockValidPromptAndImages(4);

    const outcome = await aiStudioFacade.advanceRunDetailed("run-1");

    expect(outcome).toEqual({ kind: "advanced", status: "ready_for_review" });
    expect(generateImagesMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-image-2", feature: "sns-image", n: 4, refTable: "ai_runs", refId: "run-1" }),
    );
    expect(createFromBytesMock).toHaveBeenCalledTimes(4);
    for (const call of createFromBytesMock.mock.calls) {
      expect(call[0]).toMatchObject({ tags: ["ai-generated", "sns-draft"] });
    }

    expect(commitImageStageMock).toHaveBeenCalledTimes(1);
    const params = commitImageStageMock.mock.calls[0][1];
    expect(params.expectedStatus).toBe("image_generation");
    expect(params.nextStatus).toBe("ready_for_review");
    expect(params.imageCandidates).toHaveLength(4);
    expect(params.imageCandidates.every((c: { selected: boolean }) => c.selected === false)).toBe(true);
    expect(params.errorCode).toBeUndefined();

    // instagram のキャプションを優先して画像プロンプトの元テキストにする (buildImagePromptSourceText)
    expect(generateTextMock.mock.calls[0][0].messages[0].content).toContain("耐候クリアで仕上げた車体です");
  });

  it("instagram が無い run では x スレッド全文を画像プロンプトの元テキストにする", async () => {
    acquireLeaseMock.mockResolvedValue(acquiredRow({ target_channels: ["x"] }));
    listDraftsForRunMock.mockResolvedValue([
      draftRow("x", {
        thread: [
          { text: "1件目のツイート", media_id: null },
          { text: "2件目のツイート", media_id: null },
        ],
      }),
    ]);
    mockValidPromptAndImages(4);

    await aiStudioFacade.advanceRunDetailed("run-1");

    const promptContent = generateTextMock.mock.calls[0][0].messages[0].content as string;
    expect(promptContent).toContain("1件目のツイート");
    expect(promptContent).toContain("2件目のツイート");
  });

  it("x/instagram の draft が無い場合は brief.theme を画像プロンプトの元テキストにフォールバックする", async () => {
    acquireLeaseMock.mockResolvedValue(
      acquiredRow({
        target_channels: ["x"],
        brief: { theme: "特別なテーマ文言", topics: ["塗装"], audience: "一般", keywords: [], claims: [] },
      }),
    );
    listDraftsForRunMock.mockResolvedValue([]);
    mockValidPromptAndImages(4);

    const outcome = await aiStudioFacade.advanceRunDetailed("run-1");

    expect(outcome).toEqual({ kind: "advanced", status: "ready_for_review" });
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(generateTextMock.mock.calls[0][0].messages[0].content).toContain("特別なテーマ文言");
  });
});

describe("image_generation ステージ: X/IG を含まない run", () => {
  it("skip して candidates=[] のまま ready_for_review へ前進し、AI 呼び出しは一切行わない", async () => {
    acquireLeaseMock.mockResolvedValue(acquiredRow({ target_channels: ["site_blog", "note"] }));

    const outcome = await aiStudioFacade.advanceRunDetailed("run-1");

    expect(outcome).toEqual({ kind: "advanced", status: "ready_for_review" });
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(generateImagesMock).not.toHaveBeenCalled();
    expect(createFromBytesMock).not.toHaveBeenCalled();
    expect(listDraftsForRunMock).not.toHaveBeenCalled();

    const params = commitImageStageMock.mock.calls[0][1];
    expect(params.imageCandidates).toEqual([]);
  });
});

describe("image_generation ステージ: graceful degradation (run を止めない)", () => {
  it("部分成功 (4枚要求→2枚のみ生成) でも候補2枚のまま ready_for_review へ前進する", async () => {
    acquireLeaseMock.mockResolvedValue(acquiredRow({ target_channels: ["x"] }));
    listDraftsForRunMock.mockResolvedValue([draftRow("x", { thread: [{ text: "本文", media_id: null }] })]);
    mockValidPromptAndImages(2, 2);

    const outcome = await aiStudioFacade.advanceRunDetailed("run-1");

    expect(outcome).toEqual({ kind: "advanced", status: "ready_for_review" });
    const params = commitImageStageMock.mock.calls[0][1];
    expect(params.imageCandidates).toHaveLength(2);
    expect(releaseLeaseAfterFailureMock).not.toHaveBeenCalled();
  });

  it("画像生成が全プロバイダで失敗 (KMB-E408) でも candidates=[] + errorCode=E408 で前進する", async () => {
    acquireLeaseMock.mockResolvedValue(acquiredRow({ target_channels: ["x"] }));
    listDraftsForRunMock.mockResolvedValue([draftRow("x", { thread: [{ text: "本文", media_id: null }] })]);
    generateTextMock.mockResolvedValue({
      ok: true,
      value: {
        text: JSON.stringify({ image_prompt: "prompt" }),
        provider: "openai",
        model: "gpt-5",
        usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheWriteInputTokens: 0, webSearchRequests: 0 },
        costMicroUsd: 10,
        stopReason: "end_turn",
      },
    });
    generateImagesMock.mockResolvedValue({ ok: false, code: "KMB-E408", detail: "全キー失敗" });

    const outcome = await aiStudioFacade.advanceRunDetailed("run-1");

    expect(outcome).toEqual({ kind: "advanced", status: "ready_for_review" });
    expect(createFromBytesMock).not.toHaveBeenCalled();
    const params = commitImageStageMock.mock.calls[0][1];
    expect(params.imageCandidates).toEqual([]);
    expect(params.errorCode).toBe("KMB-E408");
    expect(releaseLeaseAfterFailureMock).not.toHaveBeenCalled();
  });

  it("予算超過 (KMB-E407) でも candidates=[] + errorCode=E407 で前進する (run 全体は止めない)", async () => {
    acquireLeaseMock.mockResolvedValue(acquiredRow({ target_channels: ["instagram"] }));
    listDraftsForRunMock.mockResolvedValue([
      draftRow("instagram", { caption: "本文", hashtags: ["a", "b", "c", "d", "e"], media_ids: ["00000000-0000-4000-8000-000000000000"] }),
    ]);
    generateTextMock.mockResolvedValue({
      ok: true,
      value: {
        text: JSON.stringify({ image_prompt: "prompt" }),
        provider: "openai",
        model: "gpt-5",
        usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheWriteInputTokens: 0, webSearchRequests: 0 },
        costMicroUsd: 10,
        stopReason: "end_turn",
      },
    });
    generateImagesMock.mockResolvedValue({ ok: false, code: "KMB-E407", detail: "月次予算上限に達しています" });

    const outcome = await aiStudioFacade.advanceRunDetailed("run-1");

    expect(outcome).toEqual({ kind: "advanced", status: "ready_for_review" });
    const params = commitImageStageMock.mock.calls[0][1];
    expect(params.imageCandidates).toEqual([]);
    expect(params.errorCode).toBe("KMB-E407");
  });

  it("画像プロンプト起案が失敗した場合は画像生成を試みず candidates=[] で前進する", async () => {
    acquireLeaseMock.mockResolvedValue(acquiredRow({ target_channels: ["x"] }));
    listDraftsForRunMock.mockResolvedValue([draftRow("x", { thread: [{ text: "本文", media_id: null }] })]);
    generateTextMock.mockResolvedValue({ ok: false, code: "KMB-E408", detail: "全キー失敗" });

    const outcome = await aiStudioFacade.advanceRunDetailed("run-1");

    expect(outcome).toEqual({ kind: "advanced", status: "ready_for_review" });
    expect(generateImagesMock).not.toHaveBeenCalled();
    const params = commitImageStageMock.mock.calls[0][1];
    expect(params.imageCandidates).toEqual([]);
    expect(params.errorCode).toBe("KMB-E408");
  });

  it("画像モデル未設定 (ai_default_image_model=null) の場合は画像生成を試みず candidates=[] で前進する", async () => {
    acquireLeaseMock.mockResolvedValue(acquiredRow({ target_channels: ["x"] }));
    listDraftsForRunMock.mockResolvedValue([draftRow("x", { thread: [{ text: "本文", media_id: null }] })]);
    generateTextMock.mockResolvedValue({
      ok: true,
      value: {
        text: JSON.stringify({ image_prompt: "prompt" }),
        provider: "openai",
        model: "gpt-5",
        usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheWriteInputTokens: 0, webSearchRequests: 0 },
        costMicroUsd: 10,
        stopReason: "end_turn",
      },
    });
    settingsGetMock.mockResolvedValue({ ok: true, value: { ...OPS_LIMITS_WITH_MODEL, ai_default_image_model: null } });

    const outcome = await aiStudioFacade.advanceRunDetailed("run-1");

    expect(outcome).toEqual({ kind: "advanced", status: "ready_for_review" });
    expect(generateImagesMock).not.toHaveBeenCalled();
    const params = commitImageStageMock.mock.calls[0][1];
    expect(params.imageCandidates).toEqual([]);
    expect(params.errorCode).toBeUndefined();
  });

  it("生成された画像の media 保存が全件例外で失敗しても candidates=[] のまま ready_for_review へ前進する (0枚)", async () => {
    acquireLeaseMock.mockResolvedValue(acquiredRow({ target_channels: ["x"] }));
    listDraftsForRunMock.mockResolvedValue([draftRow("x", { thread: [{ text: "本文", media_id: null }] })]);
    mockValidPromptAndImages(4);
    createFromBytesMock.mockRejectedValue(new Error("storage upload failed"));

    const outcome = await aiStudioFacade.advanceRunDetailed("run-1");

    expect(outcome).toEqual({ kind: "advanced", status: "ready_for_review" });
    const params = commitImageStageMock.mock.calls[0][1];
    expect(params.imageCandidates).toEqual([]);
  });

  it("生成された画像の media 保存が全件 Result err で失敗しても candidates=[] のまま ready_for_review へ前進する (0枚)", async () => {
    acquireLeaseMock.mockResolvedValue(acquiredRow({ target_channels: ["x"] }));
    listDraftsForRunMock.mockResolvedValue([draftRow("x", { thread: [{ text: "本文", media_id: null }] })]);
    mockValidPromptAndImages(4);
    createFromBytesMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "DB insert failed" });

    const outcome = await aiStudioFacade.advanceRunDetailed("run-1");

    expect(outcome).toEqual({ kind: "advanced", status: "ready_for_review" });
    const params = commitImageStageMock.mock.calls[0][1];
    expect(params.imageCandidates).toEqual([]);
  });
});
