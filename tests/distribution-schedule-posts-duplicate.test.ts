import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApprovedDraft } from "@/modules/ai-studio/contracts";

/**
 * canonical: cms-ai-pipeline.md §4.3 / §8.2、migration 20260906000040 (channel_posts_active_draft_uniq)。
 * 2026-09-06 監査修正 #2 (同一 draft の重複予約) / #9 (X 課金ガードの合算不読は fail-closed)。
 * schedulePosts は (a) entries 内の draft_id 重複、(b) 既存の active 行、(c) DB の unique index 違反
 * (23505 → KMB-E102) のいずれも KMB-E102 で拒否し、insert を途中まで行わない。
 */

const { opsLimitsRow } = vi.hoisted(() => ({
  opsLimitsRow: {
    current: {
      data: {
        value: {
          x_monthly_post_limit: 1000,
          ai_monthly_budget_micro_usd: 50_000_000,
          ai_monthly_image_limit: 200,
          ai_default_image_model: null,
        },
      } as { value: unknown } | null,
      error: null as { message: string } | null,
    },
  },
}));

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () =>
    ({
      from: (table: string) => {
        if (table !== "site_settings") throw new Error(`fake service client: 未対応のテーブル (${table})`);
        return { select: () => ({ eq: () => ({ maybeSingle: async () => opsLimitsRow.current }) }) };
      },
    }) as unknown,
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) as unknown }));

const getApprovedDraft = vi.fn();
vi.mock("@/modules/distribution/internal/ai-studio-bridge", () => ({
  resolveAiStudioFacade: async () => ({ getApprovedDraft: (...args: unknown[]) => getApprovedDraft(...args) }),
}));

const insertChannelPost = vi.fn();
const getMonthlyXCostCentsSum = vi.fn();
const listActiveChannelPostsByDraftIds = vi.fn();
vi.mock("@/modules/distribution/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/distribution/repository")>();
  return {
    ...actual,
    insertChannelPost: (...args: unknown[]) => insertChannelPost(...args),
    getMonthlyXCostCentsSum: (...args: unknown[]) => getMonthlyXCostCentsSum(...args),
    listActiveChannelPostsByDraftIds: (...args: unknown[]) => listActiveChannelPostsByDraftIds(...args),
  };
});

import { distributionFacade } from "@/modules/distribution/facade";
import { ACTIVE_DRAFT_POST_STATUSES } from "@/modules/distribution/repository";

const D1 = "11111111-1111-1111-1111-111111111111";
const D2 = "22222222-2222-2222-2222-222222222222";
const FUTURE = new Date(Date.now() + 60_000).toISOString();

function xDraft(draftId: string): ApprovedDraft {
  return {
    draft_id: draftId,
    run_id: "run-1",
    channel: "x",
    content: { thread: [{ text: "hello", media_id: null }] } as unknown as ApprovedDraft["content"],
    approved_at: new Date().toISOString(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getApprovedDraft.mockImplementation(async (id: string) => ({ ok: true, value: xDraft(id) }));
  getMonthlyXCostCentsSum.mockResolvedValue({ ok: true, value: 0 });
  listActiveChannelPostsByDraftIds.mockResolvedValue({ ok: true, value: [] });
  insertChannelPost.mockImplementation(async (_c: unknown, input: { draft_id: string }) => ({
    ok: true,
    value: { id: `post-${input.draft_id.slice(0, 1)}` },
  }));
});

describe("schedulePosts: 同一 draft の重複予約は KMB-E102 (#2)", () => {
  it("entries 内に同じ draft_id が 2 回あると、facade 呼び出しも insert も行わず KMB-E102", async () => {
    const result = await distributionFacade.schedulePosts([
      { draft_id: D1, scheduled_at: FUTURE },
      { draft_id: D1, scheduled_at: FUTURE },
    ]);

    expect(result).toMatchObject({ ok: false, code: "KMB-E102" });
    if (!result.ok) expect(result.detail).toContain(D1);
    expect(getApprovedDraft).not.toHaveBeenCalled();
    expect(insertChannelPost).not.toHaveBeenCalled();
  });

  it("既に active な行 (scheduled/publishing/published/manual_required) がある draft は KMB-E102 で拒否し insert しない", async () => {
    listActiveChannelPostsByDraftIds.mockResolvedValue({
      ok: true,
      value: [{ id: "existing", draft_id: D2, status: "published" }],
    });

    const result = await distributionFacade.schedulePosts([
      { draft_id: D1, scheduled_at: FUTURE },
      { draft_id: D2, scheduled_at: FUTURE },
    ]);

    expect(result).toMatchObject({ ok: false, code: "KMB-E102" });
    if (!result.ok) {
      expect(result.detail).toContain(D2);
      expect(result.detail).toContain("published");
    }
    // 事前チェックは全 entry の draft_id をまとめて 1 回で照会する
    expect(listActiveChannelPostsByDraftIds).toHaveBeenCalledTimes(1);
    expect(listActiveChannelPostsByDraftIds.mock.calls[0][1]).toEqual([D1, D2]);
    expect(insertChannelPost).not.toHaveBeenCalled();
  });

  it("active 集合は partial unique index (migration 20260906000040) と同じ 4 状態 (failed/cancelled 後は再予約可)", () => {
    expect([...ACTIVE_DRAFT_POST_STATUSES].sort()).toEqual(["manual_required", "published", "publishing", "scheduled"]);
  });

  it("重複が無ければ従来どおり全件 insert され post_ids を返す (非退行)", async () => {
    const result = await distributionFacade.schedulePosts([
      { draft_id: D1, scheduled_at: FUTURE },
      { draft_id: D2, scheduled_at: FUTURE },
    ]);

    expect(result).toEqual({ ok: true, value: { post_ids: ["post-1", "post-2"] } });
    expect(insertChannelPost).toHaveBeenCalledTimes(2);
  });

  it("最終防衛線: insert が unique index 違反 (23505 → repository が KMB-E102 に変換) を返したらそのまま KMB-E102 を返す", async () => {
    insertChannelPost.mockResolvedValueOnce({
      ok: false,
      code: "KMB-E102",
      detail: 'duplicate key value violates unique constraint "channel_posts_active_draft_uniq"',
    });

    const result = await distributionFacade.schedulePosts([{ draft_id: D1, scheduled_at: FUTURE }]);

    expect(result).toMatchObject({ ok: false, code: "KMB-E102" });
  });
});

describe("schedulePosts: X 課金ガードの当月合算が読めない場合は fail-closed (#9)", () => {
  it("getMonthlyXCostCentsSum が ok:false → 0 とみなさず KMB-E901 で拒否し insert しない", async () => {
    getMonthlyXCostCentsSum.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "timeout" });

    const result = await distributionFacade.schedulePosts([{ draft_id: D1, scheduled_at: FUTURE }]);

    expect(result).toMatchObject({ ok: false, code: "KMB-E901" });
    if (!result.ok) {
      expect(result.detail).toContain("合算");
      expect(result.detail).toContain("timeout");
    }
    expect(insertChannelPost).not.toHaveBeenCalled();
  });
});
