import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * canonical: docs/design/ai-studio-v2.md §7 (SNS 生成の画像統合、P4)。
 *
 * facade.listRunImageCandidates / facade.selectRunImage を repository・media facade・
 * session をすべてモックして検証する。
 *
 * 検証観点 (タスク指示のテスト項目と対応):
 * - 画像選択 → channel_drafts.content に media_id 保存 (x: thread[0]/instagram: media_ids)
 * - skip 経路 (media_id=null は channel_drafts に触れない)
 * - run の候補に無い media_id を指定した場合は KMB-E101
 */

const sessionMock = vi.fn();
vi.mock("@/lib/supabase/session", () => ({
  getSessionAndClient: (...args: unknown[]) => sessionMock(...args),
}));

const getPublicUrlMock = vi.fn();
vi.mock("@/modules/media/facade", () => ({
  mediaFacade: {
    getPublicUrl: (...args: unknown[]) => getPublicUrlMock(...args),
    createFromBytes: vi.fn(),
  },
}));

// image_generation ステージ (advanceRunDetailed) はこのテストでは対象外なので未使用でも良いが、
// facade.ts が import する ai-providers/settings facade は解決できる必要があるため最小限モックする。
vi.mock("@/modules/ai-providers/facade", () => ({
  aiProvidersFacade: { generateText: vi.fn(), generateImages: vi.fn() },
}));
vi.mock("@/modules/settings/facade", () => ({
  settingsFacade: { get: vi.fn() },
}));

const getRunMock = vi.fn();
const listDraftsForRunMock = vi.fn();
const insertHumanRevisionMock = vi.fn();
const updateRunImageSelectionMock = vi.fn();

vi.mock("@/modules/ai-studio/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/ai-studio/repository")>();
  return {
    ...actual,
    getRun: (...args: unknown[]) => getRunMock(...args),
    listDraftsForRun: (...args: unknown[]) => listDraftsForRunMock(...args),
    insertHumanRevision: (...args: unknown[]) => insertHumanRevisionMock(...args),
    updateRunImageSelection: (...args: unknown[]) => updateRunImageSelectionMock(...args),
  };
});

import { aiStudioFacade } from "@/modules/ai-studio/facade";

const MEDIA_1 = "11111111-1111-4111-8111-111111111111";
const MEDIA_2 = "22222222-2222-4222-8222-222222222222";

function runRow(imageCandidates: { media_id: string; selected: boolean }[]) {
  return {
    id: "run-1",
    source_id: "source-1",
    status: "ready_for_review" as const,
    target_channels: ["x", "instagram"],
    research_enabled: false,
    brief: null,
    research_notes: null,
    error_code: null,
    token_usage: null,
    lease_expires_at: null,
    stage_attempts: 1,
    image_candidates: imageCandidates,
    created_by: null,
    created_at: "2026-07-10T00:00:00.000Z",
    updated_at: "2026-07-10T00:00:00.000Z",
  };
}

function xDraft(thread: { text: string; media_id: string | null }[]) {
  return {
    id: "draft-x",
    run_id: "run-1",
    channel: "x" as const,
    status: "needs_review",
    content: { thread },
    claims: [],
    current_revision: 1,
    reviewed_by: null,
    reviewed_at: null,
    created_at: "2026-07-10T00:00:00.000Z",
  };
}

function igDraft(mediaIds: string[]) {
  return {
    id: "draft-ig",
    run_id: "run-1",
    channel: "instagram" as const,
    status: "needs_review",
    content: {
      caption: "投稿本文",
      hashtags: ["a", "b", "c", "d", "e"],
      media_ids: mediaIds,
    },
    claims: [],
    current_revision: 1,
    reviewed_by: null,
    reviewed_at: null,
    created_at: "2026-07-10T00:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.mockResolvedValue({ supabase: {} as unknown as SupabaseClient, user: { id: "admin-1" } });
  insertHumanRevisionMock.mockResolvedValue(2);
  updateRunImageSelectionMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listRunImageCandidates", () => {
  it("ai_runs.image_candidates を URL 付きで返す", async () => {
    getRunMock.mockResolvedValue(runRow([{ media_id: MEDIA_1, selected: false }, { media_id: MEDIA_2, selected: true }]));
    getPublicUrlMock.mockImplementation((mediaId: string) => ({ ok: true, value: `https://cdn.test/${mediaId}.webp` }));

    const result = await aiStudioFacade.listRunImageCandidates("run-1");

    expect(result).toEqual({
      ok: true,
      value: [
        { mediaId: MEDIA_1, url: `https://cdn.test/${MEDIA_1}.webp`, selected: false },
        { mediaId: MEDIA_2, url: `https://cdn.test/${MEDIA_2}.webp`, selected: true },
      ],
    });
  });

  it("run が見つからない場合は KMB-E101", async () => {
    getRunMock.mockResolvedValue(null);
    const result = await aiStudioFacade.listRunImageCandidates("missing");
    expect(result).toEqual({ ok: false, code: "KMB-E101", detail: "run が見つかりません" });
  });
});

describe("selectRunImage: 選択 → channel_drafts.content に反映", () => {
  it("x: thread[0].media_id を選択画像で更新し、human revision として積む", async () => {
    getRunMock.mockResolvedValue(runRow([{ media_id: MEDIA_1, selected: false }, { media_id: MEDIA_2, selected: false }]));
    listDraftsForRunMock.mockResolvedValue([
      xDraft([
        { text: "1件目", media_id: null },
        { text: "2件目", media_id: null },
      ]),
    ]);

    const result = await aiStudioFacade.selectRunImage("run-1", MEDIA_1);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(insertHumanRevisionMock).toHaveBeenCalledTimes(1);
    const [, draftId, content] = insertHumanRevisionMock.mock.calls[0];
    expect(draftId).toBe("draft-x");
    expect(content).toEqual({
      thread: [
        { text: "1件目", media_id: MEDIA_1 },
        { text: "2件目", media_id: null }, // 先頭ツイートのみ更新 (判断点)
      ],
    });
    expect(updateRunImageSelectionMock).toHaveBeenCalledWith(expect.anything(), "run-1", MEDIA_1);
  });

  it("instagram: media_ids を選択画像 1 枚の配列で置き換える", async () => {
    getRunMock.mockResolvedValue(runRow([{ media_id: MEDIA_1, selected: false }]));
    listDraftsForRunMock.mockResolvedValue([igDraft(["99999999-9999-4999-8999-999999999999"])]);

    const result = await aiStudioFacade.selectRunImage("run-1", MEDIA_1);

    expect(result).toEqual({ ok: true, value: undefined });
    const [, draftId, content] = insertHumanRevisionMock.mock.calls[0];
    expect(draftId).toBe("draft-ig");
    expect(content).toMatchObject({ media_ids: [MEDIA_1], caption: "投稿本文" });
  });

  it("x と instagram の両方を含む run では両方の channel_drafts を更新する", async () => {
    getRunMock.mockResolvedValue(runRow([{ media_id: MEDIA_1, selected: false }]));
    listDraftsForRunMock.mockResolvedValue([
      xDraft([{ text: "本文", media_id: null }]),
      igDraft(["99999999-9999-4999-8999-999999999999"]),
    ]);

    await aiStudioFacade.selectRunImage("run-1", MEDIA_1);

    expect(insertHumanRevisionMock).toHaveBeenCalledTimes(2);
    expect(updateRunImageSelectionMock).toHaveBeenCalledTimes(1);
  });
});

describe("selectRunImage: skip 経路", () => {
  it("media_id=null は channel_drafts / 候補選択のいずれにも触れない", async () => {
    getRunMock.mockResolvedValue(runRow([{ media_id: MEDIA_1, selected: false }]));

    const result = await aiStudioFacade.selectRunImage("run-1", null);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(listDraftsForRunMock).not.toHaveBeenCalled();
    expect(insertHumanRevisionMock).not.toHaveBeenCalled();
    expect(updateRunImageSelectionMock).not.toHaveBeenCalled();
  });
});

describe("selectRunImage: 異常系", () => {
  it("run の候補に含まれない media_id を指定すると KMB-E101 で拒否する", async () => {
    getRunMock.mockResolvedValue(runRow([{ media_id: MEDIA_1, selected: false }]));

    const result = await aiStudioFacade.selectRunImage("run-1", MEDIA_2);

    expect(result).toEqual({
      ok: false,
      code: "KMB-E101",
      detail: "指定された画像はこの run の候補にありません",
    });
    expect(listDraftsForRunMock).not.toHaveBeenCalled();
  });

  it("run が見つからない場合は KMB-E101", async () => {
    getRunMock.mockResolvedValue(null);
    const result = await aiStudioFacade.selectRunImage("missing", MEDIA_1);
    expect(result).toEqual({ ok: false, code: "KMB-E101", detail: "run が見つかりません" });
  });
});
