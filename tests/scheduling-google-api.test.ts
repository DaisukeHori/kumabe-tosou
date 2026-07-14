import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  decodeGoogleIdTokenEmail,
  exchangeGoogleAuthorizationCode,
  googleCalendarAdapter,
} from "@/modules/scheduling/internal/google-api";
import { ConflictError, GoneError, OAuthTokenError } from "@/modules/scheduling/internal/provider";
import { classifySyncError } from "@/modules/scheduling/internal/sync-error-classify";
import type { CalendarVaultSecret } from "@/modules/scheduling/internal/vault-names";

/**
 * canonical: docs/design/crm-suite/03-scheduling.md §8.1 (Google 列) / §3.3 (応答 zod)。
 * 実装計画書「テスト戦略」§scheduling-google-api.test.ts の必須ケース:
 *   nextSyncToken最終ページのみ / pageToken継続 / 410→GoneError / If-Match412→ConflictError /
 *   privateExtendedProperty検索 / timeout→結果不明分類 / start.date→isAllDay検知(P31)
 *
 * msw が未導入のためこのリポジトリの確立パターン (distribution-cas.test.ts /
 * distribution-x-media.test.ts) と同型で vi.stubGlobal("fetch", ...) を使う
 * (HTTP レベルモック。googleCalendarAdapter/exchangeGoogleAuthorizationCode の実装をそのまま通す)。
 */

const SECRET: CalendarVaultSecret = {
  access_token: "access-token-abc",
  refresh_token: "refresh-token-abc",
  expires_at: "2099-01-01T00:00:00.000Z",
};
const CALENDAR_ID = "cal-app-123";

type Call = { url: string; method: string; headers: Record<string, string> };

let calls: Call[];
let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function record(input: string | URL, init?: RequestInit): void {
  calls.push({
    url: String(input),
    method: init?.method ?? "GET",
    headers: (init?.headers as Record<string, string>) ?? {},
  });
}

beforeEach(() => {
  calls = [];
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pullChanges: nextSyncToken は最終ページのみ", () => {
  it("nextSyncToken が返る応答では nextPageCursor=null / nextSyncToken がそのまま返る", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      record(input, init);
      return jsonResponse(200, { items: [], nextSyncToken: "sync-token-final" });
    });

    const page = await googleCalendarAdapter.pullChanges(CALENDAR_ID, null, null, null, SECRET);

    expect(page.nextSyncToken).toBe("sync-token-final");
    expect(page.nextPageCursor).toBeNull();
    expect(calls[0].url).not.toContain("syncToken=");
    expect(calls[0].url).not.toContain("pageToken=");
  });

  it("syncToken を渡すとリクエスト URL に syncToken パラメータとして付与される", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      record(input, init);
      return jsonResponse(200, { items: [], nextSyncToken: "next-token" });
    });

    await googleCalendarAdapter.pullChanges(CALENDAR_ID, "prev-sync-token", null, null, SECRET);

    expect(calls[0].url).toContain("syncToken=prev-sync-token");
    // timeMin/timeMax は syncToken と併用不可のため付けない (§8.1)
    expect(calls[0].url).not.toContain("timeMin");
    expect(calls[0].url).not.toContain("timeMax");
  });
});

describe("pullChanges: pageToken 継続", () => {
  it("nextPageToken のみ返る応答 (nextSyncToken 無し) では nextPageCursor が設定され nextSyncToken は null", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      record(input, init);
      return jsonResponse(200, { items: [], nextPageToken: "page-2" });
    });

    const page = await googleCalendarAdapter.pullChanges(CALENDAR_ID, null, null, null, SECRET);

    expect(page.nextPageCursor).toBe("page-2");
    expect(page.nextSyncToken).toBeNull();
  });

  it("pageCursor を渡すとリクエスト URL に pageToken パラメータとして付与される", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      record(input, init);
      return jsonResponse(200, { items: [], nextSyncToken: "final" });
    });

    await googleCalendarAdapter.pullChanges(CALENDAR_ID, null, "page-cursor-xyz", null, SECRET);

    expect(calls[0].url).toContain("pageToken=page-cursor-xyz");
  });
});

describe("pullChanges: 410 → GoneError (sync token 失効)", () => {
  it("410 応答は GoneError を送出する", async () => {
    fetchMock.mockImplementation(async () => new Response("gone", { status: 410 }));

    await expect(googleCalendarAdapter.pullChanges(CALENDAR_ID, "stale-token", null, null, SECRET)).rejects.toBeInstanceOf(
      GoneError,
    );
  });
});

describe("updateEvent: If-Match 412 → ConflictError", () => {
  it("412 応答は ConflictError(status=412) を送出する", async () => {
    fetchMock.mockImplementation(async () => new Response("precondition failed", { status: 412 }));

    let caught: unknown;
    try {
      await googleCalendarAdapter.updateEvent(
        CALENDAR_ID,
        "ext-1",
        { linkId: "link-1", blockId: "block-1", title: "研磨", startsAt: "2026-07-12T00:00:00Z", endsAt: "2026-07-12T03:00:00Z" },
        "etag-old",
        SECRET,
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConflictError);
    expect((caught as ConflictError).status).toBe(412);
  });

  it("ifMatch を渡すと If-Match ヘッダが送信される", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      record(input, init);
      return jsonResponse(200, { id: "ext-1", etag: "etag-new", updated: "2026-07-12T00:00:00Z" });
    });

    await googleCalendarAdapter.updateEvent(
      CALENDAR_ID,
      "ext-1",
      { linkId: "link-1", blockId: "block-1", title: "研磨", startsAt: "2026-07-12T00:00:00Z", endsAt: "2026-07-12T03:00:00Z" },
      "etag-old",
      SECRET,
    );

    expect(calls[0].headers["If-Match"]).toBe("etag-old");
    expect(calls[0].method).toBe("PUT");
  });

  it("ifMatch が null の場合は If-Match ヘッダを送らない", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      record(input, init);
      return jsonResponse(200, { id: "ext-1", etag: "etag-new", updated: "2026-07-12T00:00:00Z" });
    });

    await googleCalendarAdapter.updateEvent(
      CALENDAR_ID,
      "ext-1",
      { linkId: "link-1", blockId: "block-1", title: "研磨", startsAt: "2026-07-12T00:00:00Z", endsAt: "2026-07-12T03:00:00Z" },
      null,
      SECRET,
    );

    expect(calls[0].headers["If-Match"]).toBeUndefined();
  });
});

describe("findByLinkId: privateExtendedProperty 検索 (E724 照合用)", () => {
  it("privateExtendedProperty=kumabe_link_id%3D{linkId} をクエリに含める", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      record(input, init);
      return jsonResponse(200, { items: [] });
    });

    await googleCalendarAdapter.findByLinkId(CALENDAR_ID, "link-42", SECRET);

    expect(calls[0].url).toContain("privateExtendedProperty=kumabe_link_id%3Dlink-42");
  });

  it("cancelled でないイベントが見つかれば ExternalEventChange を返す (cancelled は除外)", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, {
        items: [
          { id: "ext-cancelled", status: "cancelled", updated: "2026-07-12T00:00:00Z" },
          { id: "ext-live", status: "confirmed", etag: "etag-live", updated: "2026-07-12T00:00:00Z" },
        ],
      }),
    );

    const found = await googleCalendarAdapter.findByLinkId(CALENDAR_ID, "link-42", SECRET);

    expect(found?.externalEventId).toBe("ext-live");
  });

  it("見つからなければ null を返す", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { items: [] }));

    const found = await googleCalendarAdapter.findByLinkId(CALENDAR_ID, "link-42", SECRET);
    expect(found).toBeNull();
  });
});

describe("pullChanges: start.date → isAllDay 検知 (P31)", () => {
  it("start.date のみ (dateTime 無し) の終日イベントは isAllDay=true、startsAt/endsAt は null (時刻を取り込まない)", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, {
        items: [
          {
            id: "ext-allday",
            status: "confirmed",
            updated: "2026-07-12T00:00:00Z",
            start: { date: "2026-07-12" },
            end: { date: "2026-07-13" },
          },
        ],
        nextSyncToken: "t1",
      }),
    );

    const page = await googleCalendarAdapter.pullChanges(CALENDAR_ID, null, null, null, SECRET);

    expect(page.changes).toHaveLength(1);
    expect(page.changes[0].isAllDay).toBe(true);
    expect(page.changes[0].startsAt).toBeNull();
    expect(page.changes[0].endsAt).toBeNull();
  });

  it("通常の dateTime イベントは isAllDay=false で時刻を取り込む", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, {
        items: [
          {
            id: "ext-timed",
            status: "confirmed",
            updated: "2026-07-12T00:00:00Z",
            start: { dateTime: "2026-07-12T09:00:00+09:00" },
            end: { dateTime: "2026-07-12T12:00:00+09:00" },
          },
        ],
        nextSyncToken: "t1",
      }),
    );

    const page = await googleCalendarAdapter.pullChanges(CALENDAR_ID, null, null, null, SECRET);

    expect(page.changes[0].isAllDay).toBe(false);
    expect(page.changes[0].startsAt).not.toBeNull();
  });

  it("removed (status=cancelled) は isAllDay 判定より優先し removed=true、startsAt/endsAt は null", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, {
        items: [{ id: "ext-removed", status: "cancelled", updated: "2026-07-12T00:00:00Z" }],
        nextSyncToken: "t1",
      }),
    );

    const page = await googleCalendarAdapter.pullChanges(CALENDAR_ID, null, null, null, SECRET);

    expect(page.changes[0].removed).toBe(true);
    expect(page.changes[0].isAllDay).toBe(false);
    expect(page.changes[0].startsAt).toBeNull();
  });
});

describe("timeout / ネットワーク断 → 結果不明分類 (classifySyncError と組み合わせて確認)", () => {
  it("AbortSignal.timeout 相当 (AbortError) は google-api.ts では加工されずそのまま送出され、classifySyncError が 'unknown' に分類する", async () => {
    fetchMock.mockImplementation(async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    });

    let caught: unknown;
    try {
      await googleCalendarAdapter.pullChanges(CALENDAR_ID, null, null, null, SECRET);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DOMException);
    expect(classifySyncError(caught)).toEqual({ kind: "unknown" });
  });

  it("fetch のネットワーク断 (TypeError) も 'unknown' に分類される", async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });

    let caught: unknown;
    try {
      await googleCalendarAdapter.createEvent(
        CALENDAR_ID,
        { linkId: "l1", blockId: "b1", title: "t", startsAt: "2026-07-12T00:00:00Z", endsAt: "2026-07-12T03:00:00Z" },
        SECRET,
      );
    } catch (err) {
      caught = err;
    }
    expect(classifySyncError(caught)).toEqual({ kind: "unknown" });
  });
});

describe("429/403 は 1 回だけ指数バックオフ後リトライする (§8.1 末尾)", () => {
  it("最初の応答が 429 でも 2 回目の応答が成功なら成功として返す", async () => {
    vi.useFakeTimers();
    let callCount = 0;
    fetchMock.mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) return new Response("rate limited", { status: 429 });
      return jsonResponse(200, { id: "ext-1", etag: "etag-1", updated: "2026-07-12T00:00:00Z" });
    });

    const promise = googleCalendarAdapter.createEvent(
      CALENDAR_ID,
      { linkId: "l1", blockId: "b1", title: "t", startsAt: "2026-07-12T00:00:00Z", endsAt: "2026-07-12T03:00:00Z" },
      SECRET,
    );
    await vi.advanceTimersByTimeAsync(1_000);
    const outcome = await promise;

    expect(callCount).toBe(2);
    expect(outcome.externalEventId).toBe("ext-1");
    vi.useRealTimers();
  });

  it("2 回目も失敗すればそのままエラーになる (2 回目以降はリトライしない)", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => new Response("still limited", { status: 429 }));

    const promise = googleCalendarAdapter.createEvent(
      CALENDAR_ID,
      { linkId: "l1", blockId: "b1", title: "t", startsAt: "2026-07-12T00:00:00Z", endsAt: "2026-07-12T03:00:00Z" },
      SECRET,
    ).catch((err) => err);
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toBeDefined();
    vi.useRealTimers();
  });
});

describe("createEvent: リクエストボディの出所マーキング (extendedProperties.private)", () => {
  it("kumabe_link_id / kumabe_block_id / kumabe_origin='app' を extendedProperties.private に含める", async () => {
    let sentBody: Record<string, unknown> | undefined;
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      record(input, init);
      sentBody = JSON.parse(init?.body as string);
      return jsonResponse(200, { id: "ext-1", etag: "etag-1", updated: "2026-07-12T00:00:00Z" });
    });

    await googleCalendarAdapter.createEvent(
      CALENDAR_ID,
      { linkId: "link-1", blockId: "block-1", title: "研磨", startsAt: "2026-07-12T00:00:00Z", endsAt: "2026-07-12T03:00:00Z" },
      SECRET,
    );

    const priv = (sentBody?.extendedProperties as { private: Record<string, string> }).private;
    expect(priv.kumabe_link_id).toBe("link-1");
    expect(priv.kumabe_block_id).toBe("block-1");
    expect(priv.kumabe_origin).toBe("app");
    expect(calls[0].method).toBe("POST");
  });
});

describe("deleteEvent: 404/410 は成功扱い (§8.1)", () => {
  it.each([404, 410])("status=%i は例外を投げない", async (status) => {
    fetchMock.mockImplementation(async () => new Response(null, { status }));
    await expect(googleCalendarAdapter.deleteEvent(CALENDAR_ID, "ext-1", SECRET)).resolves.toBeUndefined();
  });

  it("その他のエラー (500) は例外を投げる", async () => {
    fetchMock.mockImplementation(async () => new Response("server error", { status: 500 }));
    await expect(googleCalendarAdapter.deleteEvent(CALENDAR_ID, "ext-1", SECRET)).rejects.toThrow();
  });
});

describe("calendarExists: 実在確認のみ (作成しない)", () => {
  it("200 なら true", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 200 }));
    expect(await googleCalendarAdapter.calendarExists(CALENDAR_ID, SECRET)).toBe(true);
  });

  it("404 なら false", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 404 }));
    expect(await googleCalendarAdapter.calendarExists(CALENDAR_ID, SECRET)).toBe(false);
  });

  it("calendars.get 以外 (POST /calendars 等) を呼ばない (実在確認のみで作成しないことの確認)", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      record(input, init);
      return new Response(null, { status: 200 });
    });
    await googleCalendarAdapter.calendarExists(CALENDAR_ID, SECRET);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
  });
});

describe("ensureAppCalendar: 保存済み id の実在検証 → 無ければ新規作成", () => {
  it("knownCalendarId が実在 (200) すればそのまま返し、POST /calendars は呼ばない", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      record(input, init);
      return new Response(null, { status: 200 });
    });

    const id = await googleCalendarAdapter.ensureAppCalendar(SECRET, "known-cal-1");
    expect(id).toBe("known-cal-1");
    expect(calls).toHaveLength(1);
  });

  it("knownCalendarId が 404 (消失) なら POST /calendars で新規作成する", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      record(input, init);
      if (init?.method === "GET") return new Response(null, { status: 404 });
      return jsonResponse(200, { id: "new-cal-2" });
    });

    const id = await googleCalendarAdapter.ensureAppCalendar(SECRET, "gone-cal");
    expect(id).toBe("new-cal-2");
    expect(calls.some((c) => c.method === "POST")).toBe(true);
  });

  it("knownCalendarId が無ければ直接 POST /calendars で新規作成する (calendarList は呼ばない)", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      record(input, init);
      return jsonResponse(200, { id: "new-cal-3" });
    });

    const id = await googleCalendarAdapter.ensureAppCalendar(SECRET, null);
    expect(id).toBe("new-cal-3");
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    expect(calls.every((c) => !c.url.includes("calendarList"))).toBe(true);
  });
});

describe("refreshTokens: 401/400系の OAuth エラー分類", () => {
  it("invalid_grant を含む応答は OAuthTokenError(oauthError='invalid_grant') を送出する", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(400, { error: "invalid_grant" }));

    let caught: unknown;
    try {
      await googleCalendarAdapter.refreshTokens(SECRET, { clientId: "cid", clientSecret: "csecret" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OAuthTokenError);
    expect((caught as OAuthTokenError).oauthError).toBe("invalid_grant");
  });

  it("応答に refresh_token が含まれない場合は既存の refresh_token を維持する (非ローテーション)", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { access_token: "new-access", expires_in: 3600 }));

    const refreshed = await googleCalendarAdapter.refreshTokens(SECRET, { clientId: "cid", clientSecret: "csecret" });
    expect(refreshed.access_token).toBe("new-access");
    expect(refreshed.refresh_token).toBe(SECRET.refresh_token);
  });

  it("JSON でない応答本文は oauthError=null で安全側に倒す", async () => {
    fetchMock.mockImplementation(async () => new Response("not json", { status: 500 }));

    let caught: unknown;
    try {
      await googleCalendarAdapter.refreshTokens(SECRET, { clientId: "cid", clientSecret: "csecret" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OAuthTokenError);
    expect((caught as OAuthTokenError).oauthError).toBeNull();
  });
});

describe("getBusy: primary カレンダーの busy 帯を返す", () => {
  it("calendars.primary.busy をそのまま変換して返す", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { calendars: { primary: { busy: [{ start: "2026-07-12T00:00:00Z", end: "2026-07-12T01:00:00Z" }] } } }),
    );

    const busy = await googleCalendarAdapter.getBusy({ start: "2026-07-12T00:00:00Z", end: "2026-07-13T00:00:00Z" }, SECRET);
    expect(busy).toEqual([{ start: "2026-07-12T00:00:00Z", end: "2026-07-12T01:00:00Z" }]);
  });

  it("primary が応答に含まれない場合は空配列を返す (エラーにしない)", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { calendars: {} }));
    const busy = await googleCalendarAdapter.getBusy({ start: "2026-07-12T00:00:00Z", end: "2026-07-13T00:00:00Z" }, SECRET);
    expect(busy).toEqual([]);
  });
});

describe("exchangeGoogleAuthorizationCode: 認可コード交換", () => {
  it("成功時は accessToken/refreshToken/idToken を返す", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { access_token: "at", refresh_token: "rt", expires_in: 3600, id_token: "idt" }),
    );

    const result = await exchangeGoogleAuthorizationCode({
      clientId: "cid",
      clientSecret: "csecret",
      code: "auth-code",
      codeVerifier: "verifier",
      redirectUri: "https://example.com/callback",
    });

    expect(result.accessToken).toBe("at");
    expect(result.refreshToken).toBe("rt");
    expect(result.idToken).toBe("idt");
  });

  it("refresh_token が応答に含まれなければ refreshToken=null (呼び出し元が E720 判定する)", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { access_token: "at", expires_in: 3600 }));

    const result = await exchangeGoogleAuthorizationCode({
      clientId: "cid",
      clientSecret: "csecret",
      code: "auth-code",
      codeVerifier: "verifier",
      redirectUri: "https://example.com/callback",
    });

    expect(result.refreshToken).toBeNull();
  });
});

describe("decodeGoogleIdTokenEmail: 署名検証なしの payload デコード", () => {
  it("email claim を含む JWT から email を取り出す", () => {
    const payload = Buffer.from(JSON.stringify({ email: "owner@example.com" })).toString("base64url");
    const idToken = `header.${payload}.signature`;
    expect(decodeGoogleIdTokenEmail(idToken)).toBe("owner@example.com");
  });

  it("email claim が無い場合は null", () => {
    const payload = Buffer.from(JSON.stringify({ sub: "123" })).toString("base64url");
    const idToken = `header.${payload}.signature`;
    expect(decodeGoogleIdTokenEmail(idToken)).toBeNull();
  });

  it("壊れた token (不正な base64/JSON) は例外を投げず null を返す", () => {
    expect(decodeGoogleIdTokenEmail("not-a-jwt")).toBeNull();
    expect(decodeGoogleIdTokenEmail("")).toBeNull();
  });
});
