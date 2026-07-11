import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApprovedDraft } from "@/modules/ai-studio/contracts";
import type { ChannelPostRow } from "@/modules/distribution/repository";

/**
 * canonical: 敵対レビュー MAJOR#2 (distribution/facade.ts schedulePosts の fail-open 掃討)。
 *
 * schedulePosts の X 課金ガードは、worker.ts と同じ共通 helper
 * (distribution/internal/ops-limits.ts getOpsLimitsForService) に統一された。
 * 従来は settingsFacade.get() が失敗すると Number.POSITIVE_INFINITY (無制限) へ
 * 静かにフォールバックしており、ops_limits 行が読めない状態でも X 予約が事実上無制限に
 * 通ってしまう fail-open だった。本テストはその修正 (fail-closed = KMB-E901、
 * 真の上限超過のみ KMB-E505) を単体で検証する。
 */

// vi.mock はファイル先頭へホイストされるため、可変値は vi.hoisted() で包む
// (tests/distribution-worker-x-media.test.ts と同型の precedent)。
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
        if (table !== "site_settings") {
          throw new Error(`fake service client: 未対応のテーブルへのアクセスです (${table})`);
        }
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => opsLimitsRow.current,
            }),
          }),
        };
      },
    }) as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({}) as unknown,
}));

const getApprovedDraft = vi.fn();
// internal/ai-studio-bridge.ts の resolveAiStudioFacade は動的 import のラッパーなので、
// tests/distribution-note-draft.test.ts と同じ理由 (Vitest SSR モジュールランナーの
// フレーキー回避) で静的にモックする。
vi.mock("@/modules/distribution/internal/ai-studio-bridge", () => ({
  resolveAiStudioFacade: async () => ({ getApprovedDraft: (...args: unknown[]) => getApprovedDraft(...args) }),
}));

const insertChannelPost = vi.fn();
const getMonthlyXCostCentsSum = vi.fn();
vi.mock("@/modules/distribution/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/distribution/repository")>();
  return {
    ...actual,
    insertChannelPost: (...args: unknown[]) => insertChannelPost(...args),
    getMonthlyXCostCentsSum: (...args: unknown[]) => getMonthlyXCostCentsSum(...args),
  };
});

import { distributionFacade } from "@/modules/distribution/facade";

function xDraft(): ApprovedDraft {
  return {
    draft_id: "draft-1",
    channel: "x",
    content: { thread: [{ text: "hello", media_id: null }] } as unknown as ApprovedDraft["content"],
    approved_at: new Date().toISOString(),
  };
}

function fakePostRow(overrides: Partial<ChannelPostRow> = {}): ChannelPostRow {
  return {
    id: "post-1",
    draft_id: "draft-1",
    channel: "x",
    status: "scheduled",
    scheduled_at: new Date(Date.now() + 60_000).toISOString(),
    published_at: null,
    external_id: null,
    external_url: null,
    tweet_count: 1,
    url_count: 0,
    estimated_cost_cents: 2,
    attempt_count: 0,
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

const ENTRIES = [
  { draft_id: "11111111-1111-1111-1111-111111111111", scheduled_at: new Date(Date.now() + 60_000).toISOString() },
];

beforeEach(() => {
  vi.clearAllMocks();
  opsLimitsRow.current = {
    data: {
      value: {
        x_monthly_post_limit: 1000,
        ai_monthly_budget_micro_usd: 50_000_000,
        ai_monthly_image_limit: 200,
        ai_default_image_model: null,
      },
    },
    error: null,
  };
  getApprovedDraft.mockResolvedValue({ ok: true, value: xDraft() });
  getMonthlyXCostCentsSum.mockResolvedValue({ ok: true, value: 0 });
  insertChannelPost.mockResolvedValue({ ok: true, value: fakePostRow() });
});

describe("schedulePosts: X 課金ガード (fail-closed / 読取不能ブランチ)", () => {
  it("ops_limits 行が存在しない (missing) → KMB-E901 で拒否し、channel_posts への insert は一切行わない", async () => {
    opsLimitsRow.current = { data: null, error: null };

    const result = await distributionFacade.schedulePosts(ENTRIES);

    expect(result).toMatchObject({ ok: false, code: "KMB-E901" });
    if (!result.ok) expect(result.detail).toContain("ops_limits");
    expect(insertChannelPost).not.toHaveBeenCalled();
  });

  it("ops_limits の value が zOpsLimits と一致しない (invalid) → KMB-E901 で拒否する (KMB-E505 にはしない、無制限フォールバックもしない)", async () => {
    opsLimitsRow.current = { data: { value: { x_monthly_post_limit: 100 } }, error: null };

    const result = await distributionFacade.schedulePosts(ENTRIES);

    expect(result).toMatchObject({ ok: false, code: "KMB-E901" });
    expect(insertChannelPost).not.toHaveBeenCalled();
  });

  it("ops_limits は正常に読めるが当月合算が上限を超過している → KMB-E505 で拒否する", async () => {
    opsLimitsRow.current = {
      data: { value: { x_monthly_post_limit: 1, ai_monthly_budget_micro_usd: 50_000_000, ai_monthly_image_limit: 200, ai_default_image_model: null } },
      error: null,
    };
    getMonthlyXCostCentsSum.mockResolvedValue({ ok: true, value: 100 });

    const result = await distributionFacade.schedulePosts(ENTRIES);

    expect(result).toMatchObject({ ok: false, code: "KMB-E505" });
    expect(insertChannelPost).not.toHaveBeenCalled();
  });

  it("ops_limits が正常かつ上限内 → ブロックされず insertChannelPost が呼ばれて予約に成功する", async () => {
    const result = await distributionFacade.schedulePosts(ENTRIES);

    expect(result).toMatchObject({ ok: true, value: { post_ids: ["post-1"] } });
    expect(insertChannelPost).toHaveBeenCalledTimes(1);
  });

  it("X 以外のチャネルのみ (totalNewXCents=0) の予約は ops_limits を確認せず素通りする (従来どおりの非退行)", async () => {
    getApprovedDraft.mockResolvedValue({
      ok: true,
      value: {
        draft_id: "draft-1",
        channel: "site_blog",
        content: {} as unknown as ApprovedDraft["content"],
        approved_at: new Date().toISOString(),
      },
    });
    opsLimitsRow.current = { data: null, error: null }; // ops_limits が読めなくても影響しないはず

    const result = await distributionFacade.schedulePosts(ENTRIES);

    expect(result).toMatchObject({ ok: true, value: { post_ids: ["post-1"] } });
    expect(insertChannelPost).toHaveBeenCalledTimes(1);
  });
});
