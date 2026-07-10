import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApprovedDraft } from "@/modules/ai-studio/contracts";
import type { ChannelAccountRow, ChannelPostRow } from "@/modules/distribution/repository";

/**
 * canonical: docs/design/ai-studio-v2.md §8 (note 下書き自動化・MAJOR-3 の状態意味論)。
 * DistributionFacade.createNoteDraft / saveNoteSessionCookie の状態遷移を、
 * repository / ai-studio facade / note-draft-client (note.com への実 HTTP 呼び出し部分) /
 * note-notify (通知メール) を vi.mock して検証する。実 note API は一切叩かない。
 */

vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({}) as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({}) as unknown,
}));

const getApprovedDraft = vi.fn();
vi.mock("@/modules/ai-studio/facade", () => ({
  aiStudioFacade: { getApprovedDraft: (...args: unknown[]) => getApprovedDraft(...args) },
}));

const settingsGet = vi.fn();
vi.mock("@/modules/settings/facade", () => ({
  settingsFacade: { get: (...args: unknown[]) => settingsGet(...args) },
}));

const callNoteCreateDraftApi = vi.fn();
const reconcileNoteDraftByTitle = vi.fn();
vi.mock("@/modules/distribution/internal/note-draft-client", () => ({
  createNoteDraft: (...args: unknown[]) => callNoteCreateDraftApi(...args),
  reconcileDraftByTitle: (...args: unknown[]) => reconcileNoteDraftByTitle(...args),
}));

const notifyNoteSessionExpired = vi.fn();
vi.mock("@/modules/distribution/internal/note-notify", () => ({
  notifyNoteSessionExpired: (...args: unknown[]) => notifyNoteSessionExpired(...args),
}));

const getChannelPostById = vi.fn();
const vaultReadSecret = vi.fn();
const vaultUpsertSecret = vi.fn();
const updateNoteDraftStatus = vi.fn();
const markChannelAccountExpired = vi.fn();
const getChannelAccount = vi.fn();
const upsertChannelAccount = vi.fn();

vi.mock("@/modules/distribution/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/distribution/repository")>();
  return {
    ...actual,
    getChannelPostById: (...args: unknown[]) => getChannelPostById(...args),
    vaultReadSecret: (...args: unknown[]) => vaultReadSecret(...args),
    vaultUpsertSecret: (...args: unknown[]) => vaultUpsertSecret(...args),
    updateNoteDraftStatus: (...args: unknown[]) => updateNoteDraftStatus(...args),
    markChannelAccountExpired: (...args: unknown[]) => markChannelAccountExpired(...args),
    getChannelAccount: (...args: unknown[]) => getChannelAccount(...args),
    upsertChannelAccount: (...args: unknown[]) => upsertChannelAccount(...args),
  };
});

import { distributionFacade } from "@/modules/distribution/facade";

function basePost(overrides: Partial<ChannelPostRow> = {}): ChannelPostRow {
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
    note_draft_status: "none",
    note_draft_url: null,
    idempotency_key: "idem-1",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function noteAccount(overrides: Partial<ChannelAccountRow> = {}): ChannelAccountRow {
  return {
    channel: "note",
    account_label: "note",
    auth_status: "connected",
    vault_secret_name: "sns_note_session_cookie",
    meta: { profile_url: null, cookie_saved_at: new Date().toISOString() },
    connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    token_refresh_lease_expires_at: null,
    ...overrides,
  };
}

function draftWithNote(overrides: Partial<{ title: string; body_md: string; hashtags: string[] }> = {}): ApprovedDraft {
  return {
    draft_id: "draft-1",
    channel: "note",
    content: { title: "テスト記事", body_md: "本文です".repeat(20), hashtags: ["塗装"], ...overrides } as unknown as ApprovedDraft["content"],
    approved_at: new Date().toISOString(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getApprovedDraft.mockResolvedValue({ ok: true, value: draftWithNote() });
  settingsGet.mockResolvedValue({ ok: true, value: { inquiry_to: "admin@example.com", on_publish_failure: true } });
  updateNoteDraftStatus.mockResolvedValue({ ok: true, value: undefined });
  markChannelAccountExpired.mockResolvedValue({ ok: true, value: undefined });
  getChannelAccount.mockResolvedValue({ ok: true, value: noteAccount() });
  upsertChannelAccount.mockResolvedValue({ ok: true, value: undefined });
  vaultUpsertSecret.mockResolvedValue({ ok: true, value: undefined });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createNoteDraft: 前提条件のバリデーション", () => {
  it("note チャネル以外は KMB-E101 で拒否する", async () => {
    getChannelPostById.mockResolvedValue({ ok: true, value: basePost({ channel: "x" }) });

    const result = await distributionFacade.createNoteDraft("post-1");
    expect(result).toMatchObject({ ok: false, code: "KMB-E101" });
    expect(callNoteCreateDraftApi).not.toHaveBeenCalled();
  });

  it("対象が見つからない場合は KMB-E901", async () => {
    getChannelPostById.mockResolvedValue({ ok: true, value: null });

    const result = await distributionFacade.createNoteDraft("post-1");
    expect(result).toMatchObject({ ok: false, code: "KMB-E901" });
  });

  it("既に created 状態なら二重作成せずそのまま返す", async () => {
    getChannelPostById.mockResolvedValue({
      ok: true,
      value: basePost({ note_draft_status: "created", note_draft_url: "https://note.com/notes/1/edit" }),
    });

    const result = await distributionFacade.createNoteDraft("post-1");
    expect(result).toEqual({ ok: true, value: { status: "created", url: "https://note.com/notes/1/edit" } });
    expect(callNoteCreateDraftApi).not.toHaveBeenCalled();
    expect(vaultReadSecret).not.toHaveBeenCalled();
  });

  it("note セッション Cookie 未登録は KMB-E409 (未登録は明示失敗と別扱い、状態は変更しない)", async () => {
    getChannelPostById.mockResolvedValue({ ok: true, value: basePost() });
    vaultReadSecret.mockResolvedValue({ ok: true, value: null });

    const result = await distributionFacade.createNoteDraft("post-1");
    expect(result).toMatchObject({ ok: false, code: "KMB-E409" });
    expect(updateNoteDraftStatus).not.toHaveBeenCalled();
  });
});

describe("createNoteDraft: 状態遷移 (§8 MAJOR-3)", () => {
  it("成功 → created + URL を保存・返却する", async () => {
    getChannelPostById.mockResolvedValue({ ok: true, value: basePost() });
    vaultReadSecret.mockResolvedValue({ ok: true, value: "_note_session_v5=abc" });
    callNoteCreateDraftApi.mockResolvedValue({
      kind: "created",
      draftId: "42",
      url: "https://note.com/notes/42/edit",
      headerImageWarning: null,
    });

    const result = await distributionFacade.createNoteDraft("post-1");

    expect(result).toEqual({ ok: true, value: { status: "created", url: "https://note.com/notes/42/edit" } });
    expect(updateNoteDraftStatus).toHaveBeenCalledWith(expect.anything(), "post-1", "creating", null);
    expect(updateNoteDraftStatus).toHaveBeenCalledWith(
      expect.anything(),
      "post-1",
      "created",
      "https://note.com/notes/42/edit",
    );
    expect(markChannelAccountExpired).not.toHaveBeenCalled();
    expect(notifyNoteSessionExpired).not.toHaveBeenCalled();
  });

  it("明示的失敗 (api_error) → failed に更新し KMB-E901 を返す (チャネル失効扱いはしない)", async () => {
    getChannelPostById.mockResolvedValue({ ok: true, value: basePost() });
    vaultReadSecret.mockResolvedValue({ ok: true, value: "_note_session_v5=abc" });
    callNoteCreateDraftApi.mockResolvedValue({ kind: "failed", reason: "api_error", detail: "500 error" });

    const result = await distributionFacade.createNoteDraft("post-1");

    expect(result).toMatchObject({ ok: false, code: "KMB-E901", detail: "500 error" });
    expect(updateNoteDraftStatus).toHaveBeenCalledWith(expect.anything(), "post-1", "failed", null);
    expect(markChannelAccountExpired).not.toHaveBeenCalled();
    expect(notifyNoteSessionExpired).not.toHaveBeenCalled();
  });

  it("401 (Cookie 失効) → failed + チャネル expired 化 + 通知メール + KMB-E409", async () => {
    getChannelPostById.mockResolvedValue({ ok: true, value: basePost() });
    vaultReadSecret.mockResolvedValue({ ok: true, value: "_note_session_v5=abc" });
    callNoteCreateDraftApi.mockResolvedValue({
      kind: "failed",
      reason: "session_invalid",
      detail: "401 unauthorized",
    });

    const result = await distributionFacade.createNoteDraft("post-1");

    expect(result).toMatchObject({ ok: false, code: "KMB-E409", detail: "401 unauthorized" });
    expect(updateNoteDraftStatus).toHaveBeenCalledWith(expect.anything(), "post-1", "failed", null);
    expect(markChannelAccountExpired).toHaveBeenCalledWith(expect.anything(), "note");
    expect(notifyNoteSessionExpired).toHaveBeenCalledWith("401 unauthorized");
  });

  it("タイムアウト/応答不明 → unknown に更新し KMB-E901 を返す (下書き一覧照合を促す文言)", async () => {
    getChannelPostById.mockResolvedValue({ ok: true, value: basePost() });
    vaultReadSecret.mockResolvedValue({ ok: true, value: "_note_session_v5=abc" });
    callNoteCreateDraftApi.mockResolvedValue({ kind: "unknown", detail: "timeout" });

    const result = await distributionFacade.createNoteDraft("post-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("KMB-E901");
      expect(result.detail).toContain("timeout");
    }
    expect(updateNoteDraftStatus).toHaveBeenCalledWith(expect.anything(), "post-1", "unknown", null);
    expect(markChannelAccountExpired).not.toHaveBeenCalled();
  });
});

describe("createNoteDraft: unknown からの再試行時の重複防止照合 (§8 MAJOR-3)", () => {
  it("前回 unknown で同タイトルの下書きが見つかれば created に昇格し、新規作成 API は呼ばない", async () => {
    getChannelPostById.mockResolvedValue({ ok: true, value: basePost({ note_draft_status: "unknown" }) });
    vaultReadSecret.mockResolvedValue({ ok: true, value: "_note_session_v5=abc" });
    reconcileNoteDraftByTitle.mockResolvedValue({
      id: "77",
      title: "テスト記事",
      url: "https://note.com/notes/77/edit",
    });

    const result = await distributionFacade.createNoteDraft("post-1");

    expect(result).toEqual({ ok: true, value: { status: "created", url: "https://note.com/notes/77/edit" } });
    expect(reconcileNoteDraftByTitle).toHaveBeenCalledWith("_note_session_v5=abc", "テスト記事");
    expect(callNoteCreateDraftApi).not.toHaveBeenCalled();
    expect(updateNoteDraftStatus).toHaveBeenCalledWith(
      expect.anything(),
      "post-1",
      "created",
      "https://note.com/notes/77/edit",
    );
  });

  it("前回 unknown で照合しても見つからなければ通常どおり新規作成を試行する", async () => {
    getChannelPostById.mockResolvedValue({ ok: true, value: basePost({ note_draft_status: "unknown" }) });
    vaultReadSecret.mockResolvedValue({ ok: true, value: "_note_session_v5=abc" });
    reconcileNoteDraftByTitle.mockResolvedValue(null);
    callNoteCreateDraftApi.mockResolvedValue({
      kind: "created",
      draftId: "88",
      url: "https://note.com/notes/88/edit",
      headerImageWarning: null,
    });

    const result = await distributionFacade.createNoteDraft("post-1");

    expect(result).toEqual({ ok: true, value: { status: "created", url: "https://note.com/notes/88/edit" } });
    expect(callNoteCreateDraftApi).toHaveBeenCalledTimes(1);
  });

  it("照合自体が例外を投げても無視して新規作成を試行する (ベストエフォート)", async () => {
    getChannelPostById.mockResolvedValue({ ok: true, value: basePost({ note_draft_status: "unknown" }) });
    vaultReadSecret.mockResolvedValue({ ok: true, value: "_note_session_v5=abc" });
    reconcileNoteDraftByTitle.mockRejectedValue(new Error("network error"));
    callNoteCreateDraftApi.mockResolvedValue({
      kind: "created",
      draftId: "99",
      url: "https://note.com/notes/99/edit",
      headerImageWarning: null,
    });

    const result = await distributionFacade.createNoteDraft("post-1");
    expect(result).toEqual({ ok: true, value: { status: "created", url: "https://note.com/notes/99/edit" } });
  });

  it("note_draft_status='creating' (前回プロセスがクラッシュ/タイムアウトし作成成否未確定) でも同タイトル照合してから created に昇格する (実装レビューで発見・修正した状態遷移漏れ)", async () => {
    // 'creating' は note API 呼び出し直前に書き込まれる状態。サーバーレス関数がその後の
    // 成否書き込み前に死ぬと 'creating' のまま永続化されうるため、'unknown' と同様に
    // reconcile してから新規作成に進むべき (でなければ二重下書きが作られる)。
    getChannelPostById.mockResolvedValue({ ok: true, value: basePost({ note_draft_status: "creating" }) });
    vaultReadSecret.mockResolvedValue({ ok: true, value: "_note_session_v5=abc" });
    reconcileNoteDraftByTitle.mockResolvedValue({
      id: "77",
      title: "テスト記事",
      url: "https://note.com/notes/77/edit",
    });

    const result = await distributionFacade.createNoteDraft("post-1");

    expect(result).toEqual({ ok: true, value: { status: "created", url: "https://note.com/notes/77/edit" } });
    expect(reconcileNoteDraftByTitle).toHaveBeenCalledWith("_note_session_v5=abc", "テスト記事");
    expect(callNoteCreateDraftApi).not.toHaveBeenCalled();
  });

  it("note_draft_status='creating' で照合しても見つからなければ通常どおり新規作成を試行する (二重作成そのものは防げないが note API へは 1 回のみ到達する)", async () => {
    getChannelPostById.mockResolvedValue({ ok: true, value: basePost({ note_draft_status: "creating" }) });
    vaultReadSecret.mockResolvedValue({ ok: true, value: "_note_session_v5=abc" });
    reconcileNoteDraftByTitle.mockResolvedValue(null);
    callNoteCreateDraftApi.mockResolvedValue({
      kind: "created",
      draftId: "101",
      url: "https://note.com/notes/101/edit",
      headerImageWarning: null,
    });

    const result = await distributionFacade.createNoteDraft("post-1");

    expect(result).toEqual({ ok: true, value: { status: "created", url: "https://note.com/notes/101/edit" } });
    expect(callNoteCreateDraftApi).toHaveBeenCalledTimes(1);
  });

  it("note_draft_status='failed' からの再試行は照合をスキップしていきなり新規作成する", async () => {
    getChannelPostById.mockResolvedValue({ ok: true, value: basePost({ note_draft_status: "failed" }) });
    vaultReadSecret.mockResolvedValue({ ok: true, value: "_note_session_v5=abc" });
    callNoteCreateDraftApi.mockResolvedValue({
      kind: "created",
      draftId: "100",
      url: "https://note.com/notes/100/edit",
      headerImageWarning: null,
    });

    const result = await distributionFacade.createNoteDraft("post-1");
    expect(result.ok).toBe(true);
    expect(reconcileNoteDraftByTitle).not.toHaveBeenCalled();
  });
});

describe("saveNoteSessionCookie: Vault 保存 + channel_accounts メタ更新", () => {
  it("Vault へ生の Cookie ヘッダ文字列をそのまま保存し、cookie_saved_at を記録する", async () => {
    getChannelAccount.mockResolvedValue({ ok: true, value: null });

    const cookie = "_note_session_v5=abc; note_gql_auth_token=def; XSRF-TOKEN=xyz";
    const result = await distributionFacade.saveNoteSessionCookie({ cookie });

    expect(result.ok).toBe(true);
    expect(vaultUpsertSecret).toHaveBeenCalledWith(expect.anything(), "sns_note_session_cookie", cookie);
    const upsertArgs = upsertChannelAccount.mock.calls[0][1];
    expect(upsertArgs.channel).toBe("note");
    expect(upsertArgs.auth_status).toBe("connected");
    expect(upsertArgs.vault_secret_name).toBe("sns_note_session_cookie");
    expect(typeof upsertArgs.meta.cookie_saved_at).toBe("string");
  });

  it("短すぎる Cookie は KMB-E101 で拒否し Vault に書き込まない", async () => {
    const result = await distributionFacade.saveNoteSessionCookie({ cookie: "short" });
    expect(result).toMatchObject({ ok: false, code: "KMB-E101" });
    expect(vaultUpsertSecret).not.toHaveBeenCalled();
  });

  it("既存の profile_url を保持したまま Cookie だけを更新する", async () => {
    getChannelAccount.mockResolvedValue({
      ok: true,
      value: noteAccount({ meta: { profile_url: "https://note.com/kumabe", cookie_saved_at: null } }),
    });

    const cookie = "_note_session_v5=new-value-here";
    await distributionFacade.saveNoteSessionCookie({ cookie });

    const upsertArgs = upsertChannelAccount.mock.calls[0][1];
    expect(upsertArgs.meta.profile_url).toBe("https://note.com/kumabe");
  });
});
