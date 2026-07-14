import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * canonical: docs/design/crm-suite/03-scheduling.md §8.4 (push) / §8.5 (pull)。
 * 実装計画書「テスト戦略」§scheduling-sync-engine.integration.test.ts の必須ケースを実装する
 * (「結合」だが docker/msw は使わない — repository.ts を vi.mock、google-api.ts は実装をそのまま通し
 * fetch を vi.stubGlobal でモックする HTTP レベルモック。sync-engine.ts の push/pull
 * オーケストレーションを検証する)。
 *
 * カバー対象 (実装計画書の「最重要地雷」優先度順):
 *  1. エコー棄却の破綻防止 (push直後のpullでecho判定されること)
 *  2. push_claimed_at claim の欠落防止 (findByLinkId 照合で二重 createEvent されないこと)
 *  3. 410 フル再同期時の link 重複防止 (3経路の事前照合)
 *  4. orphaned 生成 (逆方向突合) がフル再同期のラウンド完了時のみ発火すること
 *  5. カレンダー404 とイベント404 の混同防止 (P20)
 *  6. 削除待ちリンク (external_event_id NULL) への外部 API 呼び出し禁止
 */

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    GOOGLE_CALENDAR_CLIENT_ID: "test-client-id",
    GOOGLE_CALENDAR_CLIENT_SECRET: "test-client-secret",
  }),
}));

const repoMocks = {
  getCalendarConnection: vi.fn(),
  listPendingPushLinks: vi.fn(),
  claimPushForLink: vi.fn(),
  markLinkSynced: vi.fn(),
  deleteCalendarEventLink: vi.fn(),
  updateCalendarConnectionStatus: vi.fn(),
  markLinkDeletedExternally: vi.fn(),
  markLinkConflict: vi.fn(),
  recordPushAttemptFailure: vi.fn(),
  touchCalendarConnectionAfterPush: vi.fn(),
  claimCalendarSyncLease: vi.fn(),
  releaseCalendarSyncLease: vi.fn(),
  findLinkByExternalEventId: vi.fn(),
  findLinkByIcalUid: vi.fn(),
  getCalendarEventLinkById: vi.fn(),
  getCalendarEventLink: vi.fn(),
  insertReconstructedLink: vi.fn(),
  getWorkBlockTimes: vi.fn(),
  updateWorkBlockExternalTimeChange: vi.fn(),
  applyPullObservedFields: vi.fn(),
  markLinkPendingPush: vi.fn(),
  listLinksWithExternalEventId: vi.fn(),
  markLinksOrphaned: vi.fn(),
  updateCalendarConnectionAfterPull: vi.fn(),
  vaultReadSecret: vi.fn(),
  vaultUpsertSecret: vi.fn(),
  claimCalendarTokenRefreshLease: vi.fn(),
  releaseCalendarTokenRefreshLease: vi.fn(),
};

vi.mock("@/modules/scheduling/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/scheduling/repository")>();
  return {
    ...actual,
    getCalendarConnection: (...a: unknown[]) => repoMocks.getCalendarConnection(...a),
    listPendingPushLinks: (...a: unknown[]) => repoMocks.listPendingPushLinks(...a),
    claimPushForLink: (...a: unknown[]) => repoMocks.claimPushForLink(...a),
    markLinkSynced: (...a: unknown[]) => repoMocks.markLinkSynced(...a),
    deleteCalendarEventLink: (...a: unknown[]) => repoMocks.deleteCalendarEventLink(...a),
    updateCalendarConnectionStatus: (...a: unknown[]) => repoMocks.updateCalendarConnectionStatus(...a),
    markLinkDeletedExternally: (...a: unknown[]) => repoMocks.markLinkDeletedExternally(...a),
    markLinkConflict: (...a: unknown[]) => repoMocks.markLinkConflict(...a),
    recordPushAttemptFailure: (...a: unknown[]) => repoMocks.recordPushAttemptFailure(...a),
    touchCalendarConnectionAfterPush: (...a: unknown[]) => repoMocks.touchCalendarConnectionAfterPush(...a),
    claimCalendarSyncLease: (...a: unknown[]) => repoMocks.claimCalendarSyncLease(...a),
    releaseCalendarSyncLease: (...a: unknown[]) => repoMocks.releaseCalendarSyncLease(...a),
    findLinkByExternalEventId: (...a: unknown[]) => repoMocks.findLinkByExternalEventId(...a),
    findLinkByIcalUid: (...a: unknown[]) => repoMocks.findLinkByIcalUid(...a),
    getCalendarEventLinkById: (...a: unknown[]) => repoMocks.getCalendarEventLinkById(...a),
    getCalendarEventLink: (...a: unknown[]) => repoMocks.getCalendarEventLink(...a),
    insertReconstructedLink: (...a: unknown[]) => repoMocks.insertReconstructedLink(...a),
    getWorkBlockTimes: (...a: unknown[]) => repoMocks.getWorkBlockTimes(...a),
    updateWorkBlockExternalTimeChange: (...a: unknown[]) => repoMocks.updateWorkBlockExternalTimeChange(...a),
    applyPullObservedFields: (...a: unknown[]) => repoMocks.applyPullObservedFields(...a),
    markLinkPendingPush: (...a: unknown[]) => repoMocks.markLinkPendingPush(...a),
    listLinksWithExternalEventId: (...a: unknown[]) => repoMocks.listLinksWithExternalEventId(...a),
    markLinksOrphaned: (...a: unknown[]) => repoMocks.markLinksOrphaned(...a),
    updateCalendarConnectionAfterPull: (...a: unknown[]) => repoMocks.updateCalendarConnectionAfterPull(...a),
    vaultReadSecret: (...a: unknown[]) => repoMocks.vaultReadSecret(...a),
    vaultUpsertSecret: (...a: unknown[]) => repoMocks.vaultUpsertSecret(...a),
    claimCalendarTokenRefreshLease: (...a: unknown[]) => repoMocks.claimCalendarTokenRefreshLease(...a),
    releaseCalendarTokenRefreshLease: (...a: unknown[]) => repoMocks.releaseCalendarTokenRefreshLease(...a),
  };
});

import { computeWrittenHash } from "@/modules/scheduling/internal/echo";
import { googleCalendarAdapter } from "@/modules/scheduling/internal/google-api";
import { runPull, runPush } from "@/modules/scheduling/internal/sync-engine";
import type { CalendarConnectionRow, CalendarEventLinkRow, PendingPushLinkRow } from "@/modules/scheduling/repository";

const FAKE_CLIENT = {} as unknown as SupabaseClient;
const CAL_ID = "app-cal-1";
const CAL_BASE = `https://www.googleapis.com/calendar/v3/calendars/${CAL_ID}`;
const OK: { ok: true; value: undefined } = { ok: true, value: undefined };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function connectionRow(overrides: Partial<CalendarConnectionRow> = {}): CalendarConnectionRow {
  return {
    provider: "google",
    status: "connected",
    vault_secret_name: "calendar_google_oauth",
    sync_token: "existing-sync-token",
    sync_page_cursor: null,
    meta: {
      account_email: "owner@example.com",
      app_calendar_id: CAL_ID,
      token_expires_at: null,
      sync_window_start: null,
      sync_window_end: null,
    },
    token_refresh_lease_expires_at: null,
    sync_lease_expires_at: null,
    pull_requested_at: null,
    last_pulled_at: null,
    last_pushed_at: null,
    last_full_resync_at: null,
    last_error_code: null,
    last_error_detail: null,
    connected_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function pendingLink(overrides: Partial<PendingPushLinkRow> = {}): PendingPushLinkRow {
  return {
    id: "link-1",
    work_block_id: "block-1",
    provider: "google",
    external_event_id: null,
    external_ical_uid: null,
    etag_or_change_key: null,
    external_updated_at: null,
    last_written_hash: null,
    sync_status: "pending_push",
    push_attempts: 0,
    push_claimed_at: null,
    last_error_code: null,
    last_pushed_at: null,
    last_pulled_at: null,
    deleted_externally_at: null,
    created_at: "2026-07-12T00:00:00.000Z",
    updated_at: "2026-07-12T00:00:00.000Z",
    block_status: "scheduled",
    block_starts_at: "2026-07-12T00:00:00.000Z",
    block_ends_at: "2026-07-12T03:00:00.000Z",
    block_title: "研磨予定",
    block_work_type_label: "研磨",
    ...overrides,
  };
}

function eventLink(overrides: Partial<CalendarEventLinkRow> = {}): CalendarEventLinkRow {
  return {
    id: "link-1",
    work_block_id: "block-1",
    provider: "google",
    external_event_id: "ext-1",
    external_ical_uid: "ical-1",
    etag_or_change_key: "etag-old",
    external_updated_at: "2026-07-11T00:00:00.000Z",
    last_written_hash: null,
    sync_status: "synced",
    push_attempts: 0,
    push_claimed_at: null,
    last_error_code: null,
    last_pushed_at: "2026-07-11T00:00:00.000Z",
    last_pulled_at: null,
    deleted_externally_at: null,
    created_at: "2026-07-10T00:00:00.000Z",
    updated_at: "2026-07-11T00:00:00.000Z",
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
type Call = { url: string; method: string };
let calls: Call[];

function recordAndRoute(handler: (url: string, method: string, init?: RequestInit) => Response | Promise<Response>) {
  fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    return handler(url, method, init);
  });
}

const VALID_SECRET_JSON = JSON.stringify({
  access_token: "access-valid",
  refresh_token: "refresh-valid",
  expires_at: "2099-01-01T00:00:00.000Z",
});

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  // 妥当なデフォルト (各テストで必要な分だけ上書きする)
  repoMocks.getCalendarConnection.mockResolvedValue({ ok: true, value: connectionRow() });
  repoMocks.listPendingPushLinks.mockResolvedValue({ ok: true, value: [] });
  repoMocks.claimPushForLink.mockResolvedValue(OK);
  repoMocks.markLinkSynced.mockResolvedValue(OK);
  repoMocks.deleteCalendarEventLink.mockResolvedValue(OK);
  repoMocks.updateCalendarConnectionStatus.mockResolvedValue(OK);
  repoMocks.markLinkDeletedExternally.mockResolvedValue(OK);
  repoMocks.markLinkConflict.mockResolvedValue(OK);
  repoMocks.recordPushAttemptFailure.mockResolvedValue(OK);
  repoMocks.touchCalendarConnectionAfterPush.mockResolvedValue(OK);
  repoMocks.claimCalendarSyncLease.mockResolvedValue({ ok: true, value: true });
  repoMocks.releaseCalendarSyncLease.mockResolvedValue(OK);
  repoMocks.findLinkByExternalEventId.mockResolvedValue({ ok: true, value: null });
  repoMocks.findLinkByIcalUid.mockResolvedValue({ ok: true, value: null });
  repoMocks.getCalendarEventLinkById.mockResolvedValue({ ok: true, value: null });
  repoMocks.getCalendarEventLink.mockResolvedValue({ ok: true, value: null });
  repoMocks.insertReconstructedLink.mockResolvedValue({ ok: true, value: { id: "new-link" } });
  repoMocks.getWorkBlockTimes.mockResolvedValue({ ok: true, value: { starts_at: "2026-07-12T00:00:00.000Z", ends_at: "2026-07-12T03:00:00.000Z" } });
  repoMocks.updateWorkBlockExternalTimeChange.mockResolvedValue(OK);
  repoMocks.applyPullObservedFields.mockResolvedValue(OK);
  repoMocks.markLinkPendingPush.mockResolvedValue(OK);
  repoMocks.listLinksWithExternalEventId.mockResolvedValue({ ok: true, value: [] });
  repoMocks.markLinksOrphaned.mockResolvedValue(OK);
  repoMocks.updateCalendarConnectionAfterPull.mockResolvedValue(OK);
  repoMocks.vaultReadSecret.mockResolvedValue({ ok: true, value: VALID_SECRET_JSON });
  repoMocks.vaultUpsertSecret.mockResolvedValue(OK);
  repoMocks.claimCalendarTokenRefreshLease.mockResolvedValue({ ok: true, value: true });
  repoMocks.releaseCalendarTokenRefreshLease.mockResolvedValue(OK);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ===========================================================================
// runPush (§8.4)
// ===========================================================================

describe("runPush: create成功 (external_event_id NULL, push_claimed_at NULL)", () => {
  it("claim → createEvent → markLinkSynced の順で処理し、hash を正しく計算する", async () => {
    repoMocks.listPendingPushLinks.mockResolvedValue({ ok: true, value: [pendingLink()] });
    recordAndRoute((url, method) => {
      if (url === `${CAL_BASE}/events` && method === "POST") {
        return jsonResponse(200, { id: "ext-new", etag: "etag-new", updated: "2026-07-12T00:00:00.000Z", iCalUID: "ical-new" });
      }
      throw new Error(`unexpected call: ${method} ${url}`);
    });

    const result = await runPush(FAKE_CLIENT, "google", googleCalendarAdapter);

    expect(result).toEqual({ pushed: 1, conflicts: 0 });
    expect(repoMocks.claimPushForLink).toHaveBeenCalledWith(FAKE_CLIENT, "link-1");
    const expectedHash = computeWrittenHash({
      startsAt: "2026-07-12T00:00:00.000Z",
      endsAt: "2026-07-12T03:00:00.000Z",
      title: "研磨予定",
    });
    expect(repoMocks.markLinkSynced).toHaveBeenCalledWith(FAKE_CLIENT, "link-1", {
      external_event_id: "ext-new",
      etag_or_change_key: "etag-new",
      external_updated_at: "2026-07-12T00:00:00.000Z",
      external_ical_uid: "ical-new",
      last_written_hash: expectedHash,
    });
    expect(repoMocks.touchCalendarConnectionAfterPush).toHaveBeenCalled();
  });
});

describe("runPush: push_claimed_at 非NULL (kill疑い) → findByLinkId 照合で二重 createEvent を防ぐ", () => {
  it("findByLinkId が既存イベントを発見したら createEvent は呼ばず、updateEvent (PUT) 経由で現在の block 内容を反映してから synced 化する", async () => {
    // MAJOR 修正の回帰テスト: found をそのまま synced 採用すると、interrupted create から
    // このリカバリまでの間の block 変更 (時刻/タイトル) が外部へ反映されないまま synced 扱いに
    // なってしまう (sync-engine.ts pushOneLink 参照)。updateEvent (PUT, If-Match: 発見した etag)
    // を必ず経由することを検証する。
    repoMocks.listPendingPushLinks.mockResolvedValue({
      ok: true,
      value: [pendingLink({ push_claimed_at: "2026-07-11T23:59:00.000Z" })],
    });
    recordAndRoute((url, method, init) => {
      if (url.startsWith(`${CAL_BASE}/events?`) && method === "GET") {
        expect(url).toContain("privateExtendedProperty=kumabe_link_id%3Dlink-1");
        return jsonResponse(200, {
          items: [{ id: "ext-found", status: "confirmed", etag: "etag-found", updated: "2026-07-12T00:00:00.000Z", iCalUID: "ical-found" }],
        });
      }
      if (url === `${CAL_BASE}/events/ext-found` && method === "PUT") {
        expect(init?.headers).toEqual(expect.objectContaining({ "If-Match": "etag-found" }));
        return jsonResponse(200, {
          id: "ext-found",
          etag: "etag-updated",
          updated: "2026-07-12T00:05:00.000Z",
          iCalUID: "ical-found",
        });
      }
      throw new Error(`unexpected call (二重 createEvent が発生した疑い): ${method} ${url}`);
    });

    const result = await runPush(FAKE_CLIENT, "google", googleCalendarAdapter);

    expect(result).toEqual({ pushed: 1, conflicts: 0 });
    expect(repoMocks.claimPushForLink).not.toHaveBeenCalled();
    expect(repoMocks.markLinkSynced).toHaveBeenCalledWith(
      FAKE_CLIENT,
      "link-1",
      expect.objectContaining({ external_event_id: "ext-found", etag_or_change_key: "etag-updated" }),
    );
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    expect(calls.some((c) => c.method === "PUT")).toBe(true);
  });
});

describe("runPush: 削除待ち (external_event_id NULL) は外部 API を呼ばず行削除のみ", () => {
  it("未 push の削除待ちリンクは fetch を一切呼ばず deleteCalendarEventLink のみ実行する", async () => {
    repoMocks.listPendingPushLinks.mockResolvedValue({
      ok: true,
      value: [pendingLink({ block_starts_at: null, block_ends_at: null, block_status: "backlog" })],
    });
    fetchMock.mockImplementation(async () => {
      throw new Error("削除待ち (external_event_id NULL) で外部 API が呼ばれてしまった (地雷6)");
    });

    const result = await runPush(FAKE_CLIENT, "google", googleCalendarAdapter);

    expect(result).toEqual({ pushed: 0, conflicts: 0 });
    expect(repoMocks.deleteCalendarEventLink).toHaveBeenCalledWith(FAKE_CLIENT, "link-1");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("runPush: 削除待ち (external_event_id 非NULL) は deleteEvent 後にリンクを削除する", () => {
  it("deleteEvent を呼んでから deleteCalendarEventLink する", async () => {
    repoMocks.listPendingPushLinks.mockResolvedValue({
      ok: true,
      value: [pendingLink({ block_status: "cancelled", external_event_id: "ext-old" })],
    });
    recordAndRoute((url, method) => {
      if (url === `${CAL_BASE}/events/ext-old` && method === "DELETE") return new Response(null, { status: 204 });
      throw new Error(`unexpected call: ${method} ${url}`);
    });

    const result = await runPush(FAKE_CLIENT, "google", googleCalendarAdapter);

    expect(result).toEqual({ pushed: 0, conflicts: 0 });
    expect(calls).toEqual([{ url: `${CAL_BASE}/events/ext-old`, method: "DELETE" }]);
    expect(repoMocks.deleteCalendarEventLink).toHaveBeenCalledWith(FAKE_CLIENT, "link-1");
  });
});

describe("runPush: 404分岐 (P20) — イベント404 (カレンダーは実在)", () => {
  it("イベント404 は markLinkDeletedExternally のみ (connection は壊さず、次のlinkも処理を継続する)", async () => {
    repoMocks.listPendingPushLinks.mockResolvedValue({
      ok: true,
      value: [
        pendingLink({ id: "link-a", external_event_id: "ext-a" }),
        pendingLink({ id: "link-b", external_event_id: null, work_block_id: "block-b" }),
      ],
    });
    recordAndRoute((url, method) => {
      if (url === `${CAL_BASE}/events/ext-a` && method === "PUT") return new Response("not found", { status: 404 });
      if (url === `${CAL_BASE}` && method === "GET") return new Response(null, { status: 200 }); // カレンダー自体は実在
      if (url === `${CAL_BASE}/events` && method === "POST") {
        return jsonResponse(200, { id: "ext-b", etag: "etag-b", updated: "2026-07-12T00:00:00.000Z" });
      }
      throw new Error(`unexpected call: ${method} ${url}`);
    });

    const result = await runPush(FAKE_CLIENT, "google", googleCalendarAdapter);

    expect(repoMocks.markLinkDeletedExternally).toHaveBeenCalledWith(FAKE_CLIENT, "link-a");
    expect(repoMocks.updateCalendarConnectionStatus).not.toHaveBeenCalled();
    // 次の link (link-b) の処理も継続される (break しない)
    expect(result).toEqual({ pushed: 1, conflicts: 0 });
  });
});

describe("runPush: 404分岐 (P20) — カレンダー404 (専用カレンダー消失)", () => {
  it("カレンダー404 は connection を error+KMB-E723 に更新し、残りの link をスキップする (誤って全 link を deleted_externally にしない)", async () => {
    repoMocks.listPendingPushLinks.mockResolvedValue({
      ok: true,
      value: [
        pendingLink({ id: "link-a", external_event_id: "ext-a" }),
        pendingLink({ id: "link-b", external_event_id: null, work_block_id: "block-b" }),
      ],
    });
    recordAndRoute((url, method) => {
      if (url === `${CAL_BASE}/events/ext-a` && method === "PUT") return new Response("not found", { status: 404 });
      if (url === `${CAL_BASE}` && method === "GET") return new Response("not found", { status: 404 }); // カレンダー自体が消失
      throw new Error(`unexpected call (残り link がスキップされていない疑い): ${method} ${url}`);
    });

    const result = await runPush(FAKE_CLIENT, "google", googleCalendarAdapter);

    expect(repoMocks.updateCalendarConnectionStatus).toHaveBeenCalledWith(FAKE_CLIENT, "google", "error", "KMB-E723", expect.any(String));
    expect(repoMocks.markLinkDeletedExternally).not.toHaveBeenCalled();
    expect(result).toEqual({ pushed: 0, conflicts: 0 });
  });
});

describe("runPush: 412 → conflict + KMB-E721", () => {
  it("412 応答は markLinkConflict('KMB-E721') を呼び conflicts をカウントする", async () => {
    repoMocks.listPendingPushLinks.mockResolvedValue({ ok: true, value: [pendingLink({ external_event_id: "ext-a" })] });
    recordAndRoute((url, method) => {
      if (url === `${CAL_BASE}/events/ext-a` && method === "PUT") return new Response("conflict", { status: 412 });
      throw new Error(`unexpected call: ${method} ${url}`);
    });

    const result = await runPush(FAKE_CLIENT, "google", googleCalendarAdapter);

    expect(result).toEqual({ pushed: 0, conflicts: 1 });
    expect(repoMocks.markLinkConflict).toHaveBeenCalledWith(FAKE_CLIENT, "link-1", "KMB-E721");
  });
});

describe("runPush: timeout (結果不明) → conflict + KMB-E724、push_attempts は変化させない", () => {
  it("AbortError は markLinkConflict('KMB-E724') のみ呼び、recordPushAttemptFailure は呼ばない", async () => {
    repoMocks.listPendingPushLinks.mockResolvedValue({ ok: true, value: [pendingLink({ external_event_id: "ext-a" })] });
    fetchMock.mockImplementation(async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    });

    const result = await runPush(FAKE_CLIENT, "google", googleCalendarAdapter);

    expect(result).toEqual({ pushed: 0, conflicts: 1 });
    expect(repoMocks.markLinkConflict).toHaveBeenCalledWith(FAKE_CLIENT, "link-1", "KMB-E724");
    expect(repoMocks.recordPushAttemptFailure).not.toHaveBeenCalled();
  });
});

describe("runPush: 401 → refresh 1回 → 再試行成功", () => {
  it("初回401 → token refresh 成功 → 再試行の createEvent が成功する", async () => {
    repoMocks.listPendingPushLinks.mockResolvedValue({ ok: true, value: [pendingLink()] });
    let eventsPostCount = 0;
    recordAndRoute((url, method) => {
      if (url === "https://oauth2.googleapis.com/token" && method === "POST") {
        return jsonResponse(200, { access_token: "access-refreshed", expires_in: 3600 });
      }
      if (url === `${CAL_BASE}/events` && method === "POST") {
        eventsPostCount += 1;
        if (eventsPostCount === 1) return new Response("unauthorized", { status: 401 });
        return jsonResponse(200, { id: "ext-new", etag: "etag-new", updated: "2026-07-12T00:00:00.000Z" });
      }
      throw new Error(`unexpected call: ${method} ${url}`);
    });

    const result = await runPush(FAKE_CLIENT, "google", googleCalendarAdapter);

    expect(result).toEqual({ pushed: 1, conflicts: 0 });
    expect(eventsPostCount).toBe(2);
    expect(repoMocks.vaultUpsertSecret).toHaveBeenCalled(); // refresh 結果が Vault に保存された
    expect(repoMocks.updateCalendarConnectionStatus).not.toHaveBeenCalled();
  });
});

describe("runPush: 401 → refresh 後も401 → connection expired + KMB-E720、残り link はスキップ", () => {
  it("refresh 自体は成功するが再試行も401 なら expired 化して break する", async () => {
    repoMocks.listPendingPushLinks.mockResolvedValue({
      ok: true,
      value: [pendingLink({ id: "link-a" }), pendingLink({ id: "link-b", work_block_id: "block-b" })],
    });
    recordAndRoute((url, method) => {
      if (url === "https://oauth2.googleapis.com/token" && method === "POST") {
        return jsonResponse(200, { access_token: "access-refreshed", expires_in: 3600 });
      }
      if (url === `${CAL_BASE}/events` && method === "POST") return new Response("unauthorized", { status: 401 });
      throw new Error(`unexpected call (残り link がスキップされていない疑い): ${method} ${url}`);
    });

    const result = await runPush(FAKE_CLIENT, "google", googleCalendarAdapter);

    expect(result).toEqual({ pushed: 0, conflicts: 0 });
    expect(repoMocks.updateCalendarConnectionStatus).toHaveBeenCalledWith(FAKE_CLIENT, "google", "expired", "KMB-E720", expect.any(String));
  });
});

// ===========================================================================
// runPull (§8.5)
// ===========================================================================

describe("runPull: エコー再送ゼロ (自己push直後の反響は work_blocks を更新しない)", () => {
  it("etag 一致 (rule1) の change は echo 判定され、work_blocks も link の sync_status も変更しない", async () => {
    repoMocks.findLinkByExternalEventId.mockResolvedValue({
      ok: true,
      value: eventLink({ etag_or_change_key: "etag-match" }),
    });
    recordAndRoute((url, method) => {
      if (url.startsWith(`${CAL_BASE}/events?`) && method === "GET") {
        return jsonResponse(200, {
          items: [
            {
              id: "ext-1",
              status: "confirmed",
              etag: "etag-match",
              updated: "2026-07-12T00:00:05.000Z",
              start: { dateTime: "2026-07-12T09:00:00+09:00" },
              end: { dateTime: "2026-07-12T12:00:00+09:00" },
            },
          ],
          nextSyncToken: "new-token",
        });
      }
      throw new Error(`unexpected call: ${method} ${url}`);
    });

    const result = await runPull(FAKE_CLIENT, "google", googleCalendarAdapter);

    expect(result).toEqual({ pulled: 0, echoes_rejected: 1, full_resync: false, skipped_running: false });
    expect(repoMocks.updateWorkBlockExternalTimeChange).not.toHaveBeenCalled();
    expect(repoMocks.applyPullObservedFields).not.toHaveBeenCalled();
    expect(repoMocks.markLinkDeletedExternally).not.toHaveBeenCalled();
  });
});

describe("runPull: 非エコーの時刻変更 → work_blocks 更新 + conflict(E721) の自動 pending_push 復帰", () => {
  it("時刻が変わっていれば updateWorkBlockExternalTimeChange を呼び、E721 は自動で pending_push に戻す", async () => {
    repoMocks.findLinkByExternalEventId.mockResolvedValue({
      ok: true,
      value: eventLink({ sync_status: "conflict", last_error_code: "KMB-E721", etag_or_change_key: "etag-old", last_written_hash: null }),
    });
    repoMocks.getWorkBlockTimes.mockResolvedValue({
      ok: true,
      value: { starts_at: "2026-07-12T00:00:00.000Z", ends_at: "2026-07-12T03:00:00.000Z" },
    });
    recordAndRoute((url, method) => {
      if (url.startsWith(`${CAL_BASE}/events?`) && method === "GET") {
        return jsonResponse(200, {
          items: [
            {
              id: "ext-1",
              status: "confirmed",
              etag: "etag-new",
              updated: "2026-07-12T01:00:00.000Z",
              start: { dateTime: "2026-07-12T10:00:00+09:00" }, // 現在の work_block とは異なる時刻
              end: { dateTime: "2026-07-12T13:00:00+09:00" },
            },
          ],
          nextSyncToken: "new-token",
        });
      }
      throw new Error(`unexpected call: ${method} ${url}`);
    });

    const result = await runPull(FAKE_CLIENT, "google", googleCalendarAdapter);

    expect(result.pulled).toBe(1);
    expect(repoMocks.updateWorkBlockExternalTimeChange).toHaveBeenCalledWith(
      FAKE_CLIENT,
      "block-1",
      "2026-07-12T01:00:00.000Z",
      "2026-07-12T04:00:00.000Z",
    );
    expect(repoMocks.applyPullObservedFields).toHaveBeenCalledWith(
      FAKE_CLIENT,
      "link-1",
      expect.objectContaining({ sync_status: "pending_push" }),
    );
    // P15: Google 単体接続では microsoft link は存在しないため伝播ロジックは no-op で完走する
    expect(repoMocks.getCalendarEventLink).toHaveBeenCalledWith(FAKE_CLIENT, "block-1", "microsoft");
    expect(repoMocks.markLinkPendingPush).not.toHaveBeenCalled();
  });
});

describe("runPull: タイトルのみ変更 (P18) は block/sync_status を変更しない", () => {
  it("starts_at/ends_at が現在と同じなら updateWorkBlockExternalTimeChange を呼ばず、sync_status も据え置く", async () => {
    repoMocks.findLinkByExternalEventId.mockResolvedValue({
      ok: true,
      value: eventLink({ sync_status: "synced", etag_or_change_key: "etag-old", last_written_hash: null }),
    });
    repoMocks.getWorkBlockTimes.mockResolvedValue({
      ok: true,
      value: { starts_at: "2026-07-12T00:00:00.000Z", ends_at: "2026-07-12T03:00:00.000Z" },
    });
    recordAndRoute((url, method) => {
      if (url.startsWith(`${CAL_BASE}/events?`) && method === "GET") {
        return jsonResponse(200, {
          items: [
            {
              id: "ext-1",
              status: "confirmed",
              etag: "etag-new",
              updated: "2026-07-12T01:00:00.000Z",
              summary: "タイトルだけ変更",
              start: { dateTime: "2026-07-12T09:00:00+09:00" }, // 現在と同じ時刻 (UTC 00:00)
              end: { dateTime: "2026-07-12T12:00:00+09:00" }, // 現在と同じ時刻 (UTC 03:00)
            },
          ],
          nextSyncToken: "new-token",
        });
      }
      throw new Error(`unexpected call: ${method} ${url}`);
    });

    const result = await runPull(FAKE_CLIENT, "google", googleCalendarAdapter);

    expect(result.pulled).toBe(1);
    expect(repoMocks.updateWorkBlockExternalTimeChange).not.toHaveBeenCalled();
    const callArgs = repoMocks.applyPullObservedFields.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(callArgs).not.toHaveProperty("sync_status");
  });
});

describe("runPull: removed → deleted_externally (ブロック本体は自動削除しない)", () => {
  it("外部削除は markLinkDeletedExternally のみ呼ぶ", async () => {
    repoMocks.findLinkByExternalEventId.mockResolvedValue({
      ok: true,
      value: eventLink({ etag_or_change_key: "etag-live-before-delete" }),
    });
    recordAndRoute((url, method) => {
      if (url.startsWith(`${CAL_BASE}/events?`) && method === "GET") {
        return jsonResponse(200, {
          items: [{ id: "ext-1", status: "cancelled", etag: "etag-removed-marker", updated: "2026-07-12T01:00:00.000Z" }],
          nextSyncToken: "new-token",
        });
      }
      throw new Error(`unexpected call: ${method} ${url}`);
    });

    const result = await runPull(FAKE_CLIENT, "google", googleCalendarAdapter);

    expect(result.pulled).toBe(1);
    expect(repoMocks.markLinkDeletedExternally).toHaveBeenCalledWith(FAKE_CLIENT, "link-1");
    expect(repoMocks.updateWorkBlockExternalTimeChange).not.toHaveBeenCalled();
  });
});

describe("runPull: isAllDay (P31) → 時刻を取り込まず pending_push 化のみ", () => {
  it("終日イベント検知時は getWorkBlockTimes / updateWorkBlockExternalTimeChange を呼ばない", async () => {
    repoMocks.findLinkByExternalEventId.mockResolvedValue({
      ok: true,
      value: eventLink({ etag_or_change_key: "etag-before-allday" }),
    });
    recordAndRoute((url, method) => {
      if (url.startsWith(`${CAL_BASE}/events?`) && method === "GET") {
        return jsonResponse(200, {
          items: [
            {
              id: "ext-1",
              status: "confirmed",
              etag: "etag-allday",
              updated: "2026-07-12T01:00:00.000Z",
              start: { date: "2026-07-12" },
              end: { date: "2026-07-13" },
            },
          ],
          nextSyncToken: "new-token",
        });
      }
      throw new Error(`unexpected call: ${method} ${url}`);
    });

    const result = await runPull(FAKE_CLIENT, "google", googleCalendarAdapter);

    expect(result.pulled).toBe(1);
    expect(repoMocks.getWorkBlockTimes).not.toHaveBeenCalled();
    expect(repoMocks.updateWorkBlockExternalTimeChange).not.toHaveBeenCalled();
    expect(repoMocks.applyPullObservedFields).toHaveBeenCalledWith(
      FAKE_CLIENT,
      "link-1",
      expect.objectContaining({ sync_status: "pending_push" }),
    );
  });
});

describe("runPull: link 未解決 + appBlockId 実在 → link 再構築 (disconnect→再接続後の二重イベント防止)", () => {
  it("appLinkId が旧リンク (削除済み) を指していても appBlockId が実在の配置済みブロックなら link を再構築する", async () => {
    repoMocks.getCalendarEventLinkById.mockResolvedValue({ ok: true, value: null }); // 旧 link は既に存在しない
    repoMocks.getCalendarEventLink.mockResolvedValue({ ok: true, value: null }); // (block, provider) にまだ link 無し
    repoMocks.insertReconstructedLink.mockResolvedValue({ ok: true, value: { id: "new-link" } });
    recordAndRoute((url, method) => {
      if (url.startsWith(`${CAL_BASE}/events?`) && method === "GET") {
        return jsonResponse(200, {
          items: [
            {
              id: "ext-recon",
              status: "confirmed",
              etag: "etag-recon",
              iCalUID: "ical-recon",
              updated: "2026-07-12T01:00:00.000Z",
              start: { dateTime: "2026-07-12T09:00:00+09:00" },
              end: { dateTime: "2026-07-12T12:00:00+09:00" },
              extendedProperties: { private: { kumabe_link_id: "old-deleted-link-id", kumabe_block_id: "block-recon" } },
            },
          ],
          nextSyncToken: "new-token",
        });
      }
      throw new Error(`unexpected call: ${method} ${url}`);
    });

    const result = await runPull(FAKE_CLIENT, "google", googleCalendarAdapter);

    expect(result.pulled).toBe(1);
    expect(repoMocks.insertReconstructedLink).toHaveBeenCalledWith(FAKE_CLIENT, {
      work_block_id: "block-recon",
      provider: "google",
      external_event_id: "ext-recon",
      etag_or_change_key: "etag-recon",
      external_updated_at: "2026-07-12T01:00:00.000Z",
      external_ical_uid: "ical-recon",
    });
  });
});

describe("runPull: link 未解決 + appLinkId/appBlockId 無し → P19 (アプリ管理外の生イベントは skip)", () => {
  it("出所マーキングが無いイベントは skip され、書き込み系 repository 関数を一切呼ばない", async () => {
    recordAndRoute((url, method) => {
      if (url.startsWith(`${CAL_BASE}/events?`) && method === "GET") {
        return jsonResponse(200, {
          items: [{ id: "ext-raw", status: "confirmed", etag: "etag-raw", updated: "2026-07-12T01:00:00.000Z" }],
          nextSyncToken: "new-token",
        });
      }
      throw new Error(`unexpected call: ${method} ${url}`);
    });

    const result = await runPull(FAKE_CLIENT, "google", googleCalendarAdapter);

    expect(result).toEqual({ pulled: 0, echoes_rejected: 0, full_resync: false, skipped_running: false });
    expect(repoMocks.insertReconstructedLink).not.toHaveBeenCalled();
    expect(repoMocks.applyPullObservedFields).not.toHaveBeenCalled();
  });
});

describe("runPull: 重複掃除 (appLinkId で解決した link が既に別の external_event_id を持つ)", () => {
  it("change 側のイベントを削除し、link 側は変更しない (410再同期後の重複防止)", async () => {
    repoMocks.getCalendarEventLinkById.mockResolvedValue({
      ok: true,
      value: eventLink({ id: "link-dup", external_event_id: "ext-already-linked" }),
    });
    recordAndRoute((url, method) => {
      if (url.startsWith(`${CAL_BASE}/events?`) && method === "GET") {
        return jsonResponse(200, {
          items: [
            {
              id: "ext-new-duplicate",
              status: "confirmed",
              etag: "etag-dup",
              updated: "2026-07-12T01:00:00.000Z",
              extendedProperties: { private: { kumabe_link_id: "link-dup", kumabe_block_id: "block-1" } },
            },
          ],
          nextSyncToken: "new-token",
        });
      }
      if (url === `${CAL_BASE}/events/ext-new-duplicate` && method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected call: ${method} ${url}`);
    });

    const result = await runPull(FAKE_CLIENT, "google", googleCalendarAdapter);

    expect(result.pulled).toBe(0);
    expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/ext-new-duplicate"))).toBe(true);
    expect(repoMocks.applyPullObservedFields).not.toHaveBeenCalled();
  });
});

describe("runPull: 410 → KMB-E722 でフル再同期即時開始 + 逆方向突合で未観測linkをorphaned化 (C7)", () => {
  it("410 検知後、同一ラウンド内でフル再同期を継続し、観測されなかった既存 link を orphaned にする", async () => {
    repoMocks.getCalendarConnection.mockResolvedValue({ ok: true, value: connectionRow({ sync_token: "stale-token" }) });
    repoMocks.listLinksWithExternalEventId.mockResolvedValue({
      ok: true,
      value: [{ id: "link-old-1", external_event_id: "ext-old-1" }],
    });
    let callIndex = 0;
    recordAndRoute((url, method) => {
      if (url.startsWith(`${CAL_BASE}/events?`) && method === "GET") {
        callIndex += 1;
        if (callIndex === 1) {
          expect(url).toContain("syncToken=stale-token");
          return new Response("gone", { status: 410 });
        }
        // 2 回目 (トークン/カーソル NULL 化後の再試行) — 何も観測されない
        expect(url).not.toContain("syncToken=");
        return jsonResponse(200, { items: [], nextSyncToken: "brand-new-token" });
      }
      throw new Error(`unexpected call: ${method} ${url}`);
    });

    const result = await runPull(FAKE_CLIENT, "google", googleCalendarAdapter);

    expect(result.full_resync).toBe(true);
    expect(repoMocks.markLinksOrphaned).toHaveBeenCalledWith(FAKE_CLIENT, ["link-old-1"]);
    expect(repoMocks.updateCalendarConnectionAfterPull).toHaveBeenCalledWith(
      FAKE_CLIENT,
      "google",
      expect.objectContaining({
        sync_token: "brand-new-token",
        sync_page_cursor: null,
        last_full_resync_at: expect.any(String),
        last_error_code: "KMB-E722",
      }),
    );
  });
});

describe("runPull: sync リースが取れない場合は何もせず skipped_running=true", () => {
  it("claimCalendarSyncLease が false を返したら fetch も repository 書き込みも一切行わない", async () => {
    repoMocks.claimCalendarSyncLease.mockResolvedValue({ ok: true, value: false });

    const result = await runPull(FAKE_CLIENT, "google", googleCalendarAdapter);

    expect(result).toEqual({ pulled: 0, echoes_rejected: 0, full_resync: false, skipped_running: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(repoMocks.releaseCalendarSyncLease).not.toHaveBeenCalled(); // リースを取れていないので解放も不要
  });
});

describe("runPull: 未接続 (connection が null / disconnected) は何もしない", () => {
  it("connection が null なら pullChanges を一切呼ばない", async () => {
    repoMocks.getCalendarConnection.mockResolvedValue({ ok: true, value: null });

    const result = await runPull(FAKE_CLIENT, "google", googleCalendarAdapter);

    expect(result).toEqual({ pulled: 0, echoes_rejected: 0, full_resync: false, skipped_running: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
