import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApprovedDraft } from "@/modules/ai-studio/contracts";
import type { ChannelPostRow } from "@/modules/distribution/repository";

/**
 * canonical: docs/design/ai-studio-v2.md §8 (note 下書き自動化・MAJOR-3) / cms-ai-pipeline.md §8.3、
 * migration 20260906000041 (channel_posts.note_draft_claimed_at)。
 * 2026-09-06 監査修正 #6: creating のまま 10 分超経過した行を CAS の遷移元に含め、回収した側は
 * 下書き一覧との照合 (reconcile) を経て再作成する。
 */

vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => ({}) as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({}) as unknown }));

const getApprovedDraft = vi.fn();
vi.mock("@/modules/distribution/internal/ai-studio-bridge", () => ({
  resolveAiStudioFacade: async () => ({ getApprovedDraft: (...args: unknown[]) => getApprovedDraft(...args) }),
}));

const callNoteCreateDraftApi = vi.fn();
const reconcileNoteDraftByTitle = vi.fn();
vi.mock("@/modules/distribution/internal/note-draft-client", () => ({
  createNoteDraft: (...args: unknown[]) => callNoteCreateDraftApi(...args),
  reconcileDraftByTitle: (...args: unknown[]) => reconcileNoteDraftByTitle(...args),
}));
vi.mock("@/modules/distribution/internal/note-notify", () => ({ notifyNoteSessionExpired: vi.fn() }));

const getChannelPostById = vi.fn();
const vaultReadSecret = vi.fn();
const claimNoteDraftCreating = vi.fn();
const updateNoteDraftStatus = vi.fn();
vi.mock("@/modules/distribution/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/distribution/repository")>();
  return {
    ...actual,
    getChannelPostById: (...args: unknown[]) => getChannelPostById(...args),
    vaultReadSecret: (...args: unknown[]) => vaultReadSecret(...args),
    claimNoteDraftCreating: (...args: unknown[]) => claimNoteDraftCreating(...args),
    updateNoteDraftStatus: (...args: unknown[]) => updateNoteDraftStatus(...args),
  };
});

import { distributionFacade } from "@/modules/distribution/facade";
import { NOTE_DRAFT_CREATING_STALE_MS } from "@/modules/distribution/repository";

// repository の実装 (CAS の filter 文字列) は importOriginal の実体を直接使って検証する
const { claimNoteDraftCreating: realClaimNoteDraftCreating } = await vi.importActual<
  typeof import("@/modules/distribution/repository")
>("@/modules/distribution/repository");

function notePost(overrides: Partial<ChannelPostRow> = {}): ChannelPostRow {
  return {
    id: "post-1",
    draft_id: "draft-1",
    channel: "note",
    status: "manual_required",
    scheduled_at: new Date().toISOString(),
    published_at: null,
    external_id: null,
    external_url: null,
    tweet_count: null,
    url_count: null,
    estimated_cost_cents: 0,
    attempt_count: 0,
    last_error_code: null,
    last_error_detail: null,
    note_draft_status: "creating",
    note_draft_url: null,
    idempotency_key: "idem-1",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

const NOTE_DRAFT: ApprovedDraft = {
  draft_id: "draft-1",
  run_id: "run-1",
  channel: "note",
  content: { title: "テスト記事", body_md: "本文", hashtags: ["塗装"] } as unknown as ApprovedDraft["content"],
  approved_at: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  getApprovedDraft.mockResolvedValue({ ok: true, value: NOTE_DRAFT });
  vaultReadSecret.mockResolvedValue({ ok: true, value: "_note_session_v5=cookie" });
  updateNoteDraftStatus.mockResolvedValue({ ok: true, value: undefined });
  reconcileNoteDraftByTitle.mockResolvedValue(null);
  callNoteCreateDraftApi.mockResolvedValue({ kind: "created", url: "https://note.com/x/n/new" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("repository.claimNoteDraftCreating: creating 固着の回収を CAS の遷移元に含める (#6)", () => {
  type Captured = { update: Record<string, unknown>; eq: [string, string]; or: string };

  function fakeClient(captured: Captured[], matched: boolean) {
    return {
      from: (table: string) => {
        expect(table).toBe("channel_posts");
        const rec: Partial<Captured> = {};
        return {
          update: (v: Record<string, unknown>) => {
            rec.update = v;
            return {
              eq: (col: string, val: string) => {
                rec.eq = [col, val];
                return {
                  or: (expr: string) => {
                    rec.or = expr;
                    captured.push(rec as Captured);
                    return {
                      select: () => ({ maybeSingle: async () => ({ data: matched ? { id: val } : null, error: null }) }),
                    };
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as import("@supabase/supabase-js").SupabaseClient;
  }

  it("遷移元は none/failed/unknown に加え「creating かつ claimed_at が 10 分超前 (または null)」、claimed_at を now で記録する", async () => {
    const captured: Captured[] = [];
    const now = new Date("2026-09-06T03:00:00.000Z");
    const result = await realClaimNoteDraftCreating(fakeClient(captured, true), "post-1", now);

    expect(result).toEqual({ ok: true, value: true });
    expect(captured).toHaveLength(1);
    const c = captured[0];
    expect(c.update).toEqual({
      note_draft_status: "creating",
      note_draft_url: null,
      note_draft_claimed_at: now.toISOString(),
    });
    expect(c.eq).toEqual(["id", "post-1"]);
    const staleBefore = new Date(now.getTime() - NOTE_DRAFT_CREATING_STALE_MS).toISOString();
    expect(NOTE_DRAFT_CREATING_STALE_MS).toBe(10 * 60 * 1000);
    expect(c.or).toBe(
      `note_draft_status.in.(none,failed,unknown),` +
        `and(note_draft_status.eq.creating,or(note_draft_claimed_at.is.null,note_draft_claimed_at.lt.${staleBefore}))`,
    );
  });

  it("影響行数 0 (10 分以内の creating を他プロセスが保持中) は false", async () => {
    const result = await realClaimNoteDraftCreating(fakeClient([], false), "post-1");
    expect(result).toEqual({ ok: true, value: false });
  });
});

describe("facade.createNoteDraft: 固着 creating を回収した側は reconcile を経て再作成する (#6)", () => {
  it("post が creating でも CAS に勝てば (=10 分超の固着)、まず下書き一覧と照合し、無ければ新規作成する", async () => {
    getChannelPostById.mockResolvedValue({ ok: true, value: notePost({ note_draft_status: "creating" }) });
    claimNoteDraftCreating.mockResolvedValue({ ok: true, value: true });

    const result = await distributionFacade.createNoteDraft("post-1");

    expect(result).toEqual({ ok: true, value: { status: "created", url: "https://note.com/x/n/new" } });
    expect(reconcileNoteDraftByTitle).toHaveBeenCalledWith("_note_session_v5=cookie", "テスト記事");
    expect(callNoteCreateDraftApi).toHaveBeenCalledTimes(1);
    expect(updateNoteDraftStatus).toHaveBeenCalledWith(expect.anything(), "post-1", "created", "https://note.com/x/n/new");
  });

  it("固着 creating の前回分が実は成功していた (照合で見つかる) 場合は再作成せず created に昇格する (重複下書き防止)", async () => {
    getChannelPostById.mockResolvedValue({ ok: true, value: notePost({ note_draft_status: "creating" }) });
    claimNoteDraftCreating.mockResolvedValue({ ok: true, value: true });
    reconcileNoteDraftByTitle.mockResolvedValue({ url: "https://note.com/x/n/found" });

    const result = await distributionFacade.createNoteDraft("post-1");

    expect(result).toEqual({ ok: true, value: { status: "created", url: "https://note.com/x/n/found" } });
    expect(callNoteCreateDraftApi).not.toHaveBeenCalled();
  });

  it("CAS に負けた (10 分以内の creating を他プロセスが保持中) 場合は従来どおり外部 API を呼ばず creating を返す", async () => {
    getChannelPostById.mockResolvedValue({ ok: true, value: notePost({ note_draft_status: "creating" }) });
    claimNoteDraftCreating.mockResolvedValue({ ok: true, value: false });

    const result = await distributionFacade.createNoteDraft("post-1");

    expect(result).toEqual({ ok: true, value: { status: "creating", url: null } });
    expect(reconcileNoteDraftByTitle).not.toHaveBeenCalled();
    expect(callNoteCreateDraftApi).not.toHaveBeenCalled();
  });

  it("none からの通常経路では reconcile しない (非退行)", async () => {
    getChannelPostById.mockResolvedValue({ ok: true, value: notePost({ note_draft_status: "none" }) });
    claimNoteDraftCreating.mockResolvedValue({ ok: true, value: true });

    await distributionFacade.createNoteDraft("post-1");

    expect(reconcileNoteDraftByTitle).not.toHaveBeenCalled();
    expect(callNoteCreateDraftApi).toHaveBeenCalledTimes(1);
  });
});
