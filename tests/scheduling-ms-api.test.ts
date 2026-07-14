import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  exchangeMsAuthorizationCode,
  fetchMsAccountEmail,
  msCalendarAdapter,
} from "@/modules/scheduling/internal/ms-api";
import { AuthExpiredError, ConflictError, GoneError, OAuthTokenError } from "@/modules/scheduling/internal/provider";
import { classifySyncError } from "@/modules/scheduling/internal/sync-error-classify";
import type { CalendarVaultSecret } from "@/modules/scheduling/internal/vault-names";

/**
 * canonical: docs/design/crm-suite/03-scheduling.md §8.1 (Microsoft 列) / §3.3 (応答 zod)。
 * 実装計画書「テスト戦略」§scheduling-ms-api.test.ts の必須ケース:
 *   deltaLink/nextLink / @removed / 窓必須 / 同一skiptoken検知E725 / ページ上限 /
 *   transactionId付与 / MSArefresh_token毎回上書き / isAllDay検知(P31) /
 *   getSchedule失敗→calendarView busy合成フォールバック / invalid_client→E723分類
 *
 * google-api.test.ts (#54) と同じ粒度・同じ HTTP レベルモック手法 (vi.stubGlobal("fetch", ...))。
 *
 * 【スコープの注記】「同一skiptoken検知 E725」「ページ上限」の実際の検知ロジックは
 * sync-engine.ts (runPullLoop の isGraphSafetyValveApplicable 分岐) にあり、ms-api.ts の
 * pullChanges は @odata.nextLink/@odata.deltaLink をそのまま中継するだけの薄いラッパである
 * (canonical §8.1 の adapter 抽象がそう定義している)。そのため本ファイルでは
 * pullChanges の中継が正しいこと (nextLink→nextPageCursor / deltaLink→nextSyncToken) を
 * 検証し、安全弁そのものの発火条件は tests/scheduling-sync-engine.integration.test.ts に
 * 追加した provider="microsoft" のケース (同一skiptoken2連続 / maxPages到達) で担保する。
 */

const SECRET: CalendarVaultSecret = {
  access_token: "access-token-abc",
  refresh_token: "refresh-token-abc",
  expires_at: "2099-01-01T00:00:00.000Z",
};
const CALENDAR_ID = "cal-app-123";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const WINDOW = { start: "2026-06-11T00:00:00Z", end: "2026-12-08T00:00:00Z" };

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

describe("pullChanges: 初回フル同期は時間窓 (window) が必須", () => {
  it("window が null (未初期化) だと fetch を呼ばず例外を投げる (握り潰さない — 安全に停止)", async () => {
    await expect(msCalendarAdapter.pullChanges(CALENDAR_ID, null, null, null, SECRET)).rejects.toThrow(
      /時間窓/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("window ありなら calendarView/delta へ startDateTime/endDateTime を付与して呼び出す", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      record(input, init);
      return jsonResponse(200, { value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta-final" });
    });

    await msCalendarAdapter.pullChanges(CALENDAR_ID, null, null, WINDOW, SECRET);

    const url = new URL(calls[0].url);
    expect(url.pathname).toBe(`/v1.0/me/calendars/${CALENDAR_ID}/calendarView/delta`);
    expect(url.searchParams.get("startDateTime")).toBe(WINDOW.start);
    expect(url.searchParams.get("endDateTime")).toBe(WINDOW.end);
  });

  it("window は syncToken/pageCursor が既にある場合には使わない (継続呼び出しはそのまま URL を叩く)", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      record(input, init);
      return jsonResponse(200, { value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta-final" });
    });

    await msCalendarAdapter.pullChanges(CALENDAR_ID, "https://graph.microsoft.com/v1.0/delta-prev", null, null, SECRET);

    expect(calls[0].url).toBe("https://graph.microsoft.com/v1.0/delta-prev");
  });
});

describe("pullChanges: deltaLink/nextLink の中継", () => {
  it("@odata.deltaLink のみ返る応答は nextSyncToken にそのまま入り、nextPageCursor は null (ラウンド完了)", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/delta-token-final" }),
    );

    const page = await msCalendarAdapter.pullChanges(CALENDAR_ID, null, null, WINDOW, SECRET);

    expect(page.nextSyncToken).toBe("https://graph.microsoft.com/v1.0/delta-token-final");
    expect(page.nextPageCursor).toBeNull();
  });

  it("@odata.nextLink のみ返る応答は nextPageCursor にそのまま入り、nextSyncToken は null (継続あり)", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { value: [], "@odata.nextLink": "https://graph.microsoft.com/v1.0/next-page-2" }),
    );

    const page = await msCalendarAdapter.pullChanges(CALENDAR_ID, null, null, WINDOW, SECRET);

    expect(page.nextPageCursor).toBe("https://graph.microsoft.com/v1.0/next-page-2");
    expect(page.nextSyncToken).toBeNull();
  });

  it("pageCursor (nextLink) を渡すとそのフル URL がそのまま fetch される (絶対 URL はベースを付け直さない)", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      record(input, init);
      return jsonResponse(200, { value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/final" });
    });

    await msCalendarAdapter.pullChanges(CALENDAR_ID, null, "https://graph.microsoft.com/v1.0/next-page-2", WINDOW, SECRET);

    expect(calls[0].url).toBe("https://graph.microsoft.com/v1.0/next-page-2");
  });

  it("読み出しは Prefer: outlook.timezone ヘッダを付与する (§8.1 表末尾)", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      record(input, init);
      return jsonResponse(200, { value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/final" });
    });

    await msCalendarAdapter.pullChanges(CALENDAR_ID, null, null, WINDOW, SECRET);

    expect(calls[0].headers.Prefer).toBe('outlook.timezone="Tokyo Standard Time"');
  });

  it("410 応答は GoneError を送出する (deltaLink 失効)", async () => {
    fetchMock.mockImplementation(async () => new Response("gone", { status: 410 }));

    await expect(msCalendarAdapter.pullChanges(CALENDAR_ID, "stale-delta-link", null, WINDOW, SECRET)).rejects.toBeInstanceOf(
      GoneError,
    );
  });
});

describe("pullChanges: @removed 通知の中継", () => {
  it("@removed が付いた change は removed=true、startsAt/endsAt/isAllDay は無効化される", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, {
        value: [
          {
            id: "ev-removed",
            "@removed": { reason: "deleted" },
            isAllDay: true, // removed 優先 (isAllDay より先に判定すること)
            start: { dateTime: "2026-07-12T09:00:00.0000000", timeZone: "Tokyo Standard Time" },
            end: { dateTime: "2026-07-12T12:00:00.0000000", timeZone: "Tokyo Standard Time" },
          },
        ],
        "@odata.deltaLink": "https://graph.microsoft.com/v1.0/final",
      }),
    );

    const page = await msCalendarAdapter.pullChanges(CALENDAR_ID, null, null, WINDOW, SECRET);

    expect(page.changes).toHaveLength(1);
    expect(page.changes[0].removed).toBe(true);
    expect(page.changes[0].isAllDay).toBe(false);
    expect(page.changes[0].startsAt).toBeNull();
    expect(page.changes[0].endsAt).toBeNull();
  });

  it("id が欠落した @removed 通知は仕様外として例外を投げる (空文字列で握り潰さない)", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, {
        value: [{ "@removed": { reason: "deleted" } }],
        "@odata.deltaLink": "https://graph.microsoft.com/v1.0/final",
      }),
    );

    await expect(msCalendarAdapter.pullChanges(CALENDAR_ID, null, null, WINDOW, SECRET)).rejects.toThrow(/id/);
  });
});

describe("pullChanges: isAllDay 検知 (P31)", () => {
  it("isAllDay=true は startsAt/endsAt を null にし、時刻として取り込まない", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, {
        value: [
          {
            id: "ev-allday",
            isAllDay: true,
            start: { dateTime: "2026-07-12T00:00:00.0000000", timeZone: "Tokyo Standard Time" },
            end: { dateTime: "2026-07-13T00:00:00.0000000", timeZone: "Tokyo Standard Time" },
          },
        ],
        "@odata.deltaLink": "https://graph.microsoft.com/v1.0/final",
      }),
    );

    const page = await msCalendarAdapter.pullChanges(CALENDAR_ID, null, null, WINDOW, SECRET);

    expect(page.changes[0].isAllDay).toBe(true);
    expect(page.changes[0].startsAt).toBeNull();
    expect(page.changes[0].endsAt).toBeNull();
  });

  it("通常 (isAllDay=false 相当・未指定) イベントは時刻を取り込む (小数秒付き壁時計表記を JST として解釈)", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, {
        value: [
          {
            id: "ev-timed",
            start: { dateTime: "2026-07-12T09:00:00.0000000", timeZone: "Tokyo Standard Time" },
            end: { dateTime: "2026-07-12T12:00:00.0000000", timeZone: "Tokyo Standard Time" },
          },
        ],
        "@odata.deltaLink": "https://graph.microsoft.com/v1.0/final",
      }),
    );

    const page = await msCalendarAdapter.pullChanges(CALENDAR_ID, null, null, WINDOW, SECRET);

    expect(page.changes[0].isAllDay).toBe(false);
    expect(page.changes[0].startsAt).toBe("2026-07-12T00:00:00.000Z"); // 09:00 JST = 00:00 UTC
    expect(page.changes[0].endsAt).toBe("2026-07-12T03:00:00.000Z");
  });
});

describe("createEvent: transactionId 付与 (§8.1/§8.4 — リトライによる二重作成防止)", () => {
  it("body に transactionId: `kmb-{linkId}` を含める", async () => {
    let sentBody: Record<string, unknown> | undefined;
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      record(input, init);
      sentBody = JSON.parse(init?.body as string);
      return jsonResponse(200, { id: "ev-1", changeKey: "ck-1", lastModifiedDateTime: "2026-07-12T00:00:00Z" });
    });

    await msCalendarAdapter.createEvent(
      CALENDAR_ID,
      { linkId: "link-77", blockId: "block-77", title: "研磨", startsAt: "2026-07-12T00:00:00Z", endsAt: "2026-07-12T03:00:00Z" },
      SECRET,
    );

    expect(sentBody?.transactionId).toBe("kmb-link-77");
    expect(calls[0].url).toBe(`${GRAPH_BASE}/me/calendars/${CALENDAR_ID}/events`);
    expect(calls[0].method).toBe("POST");
  });

  it("同じ linkId でも呼び出すたびに同じ transactionId が付く (サーバ側の重複作成防止に依存する設計の確認)", async () => {
    let sentBody: Record<string, unknown> | undefined;
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      sentBody = JSON.parse(init?.body as string);
      return jsonResponse(200, { id: "ev-1", changeKey: "ck-1", lastModifiedDateTime: "2026-07-12T00:00:00Z" });
    });

    await msCalendarAdapter.createEvent(
      CALENDAR_ID,
      { linkId: "link-dup", blockId: "block-dup", title: "t", startsAt: "2026-07-12T00:00:00Z", endsAt: "2026-07-12T03:00:00Z" },
      SECRET,
    );
    const firstBody = sentBody;
    await msCalendarAdapter.createEvent(
      CALENDAR_ID,
      { linkId: "link-dup", blockId: "block-dup", title: "t", startsAt: "2026-07-12T00:00:00Z", endsAt: "2026-07-12T03:00:00Z" },
      SECRET,
    );

    expect(firstBody?.transactionId).toBe(sentBody?.transactionId);
  });
});

describe("updateEvent/deleteEvent: Graph のイベント ID はグローバル (/me/events/{id} を叩く)", () => {
  it("updateEvent は calendarId を含まない /me/events/{id} を PATCH する", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      record(input, init);
      return jsonResponse(200, { id: "ev-1", changeKey: "ck-2", lastModifiedDateTime: "2026-07-12T01:00:00Z" });
    });

    await msCalendarAdapter.updateEvent(
      CALENDAR_ID,
      "ev-1",
      { linkId: "l1", blockId: "b1", title: "t", startsAt: "2026-07-12T00:00:00Z", endsAt: "2026-07-12T03:00:00Z" },
      "ck-old",
      SECRET,
    );

    expect(calls[0].url).toBe(`${GRAPH_BASE}/me/events/ev-1`);
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].headers["If-Match"]).toBe("ck-old");
  });

  it("ifMatch が null なら If-Match ヘッダを送らない", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      record(input, init);
      return jsonResponse(200, { id: "ev-1", changeKey: "ck-2", lastModifiedDateTime: "2026-07-12T01:00:00Z" });
    });

    await msCalendarAdapter.updateEvent(
      CALENDAR_ID,
      "ev-1",
      { linkId: "l1", blockId: "b1", title: "t", startsAt: "2026-07-12T00:00:00Z", endsAt: "2026-07-12T03:00:00Z" },
      null,
      SECRET,
    );

    expect(calls[0].headers["If-Match"]).toBeUndefined();
  });

  it("412 応答は ConflictError(status=412) を送出する (楽観排他競合)", async () => {
    fetchMock.mockImplementation(async () => new Response("precondition failed", { status: 412 }));

    let caught: unknown;
    try {
      await msCalendarAdapter.updateEvent(
        CALENDAR_ID,
        "ev-1",
        { linkId: "l1", blockId: "b1", title: "t", startsAt: "2026-07-12T00:00:00Z", endsAt: "2026-07-12T03:00:00Z" },
        "ck-old",
        SECRET,
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConflictError);
    expect((caught as ConflictError).status).toBe(412);
  });

  it("deleteEvent は /me/events/{id} を叩き、404/410 は成功扱いにする", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      record(input, init);
      return new Response(null, { status: 404 });
    });

    await expect(msCalendarAdapter.deleteEvent(CALENDAR_ID, "ev-1", SECRET)).resolves.toBeUndefined();
    expect(calls[0].url).toBe(`${GRAPH_BASE}/me/events/ev-1`);
    expect(calls[0].method).toBe("DELETE");
  });

  it("deleteEvent のその他エラー (500) は例外を投げる", async () => {
    fetchMock.mockImplementation(async () => new Response("server error", { status: 500 }));
    await expect(msCalendarAdapter.deleteEvent(CALENDAR_ID, "ev-1", SECRET)).rejects.toThrow();
  });
});

describe("findByLinkId: Graph は拡張プロパティに依存しないため常に null を返す固定実装 (§8.1/§8.7)", () => {
  it("fetch を一切呼ばず null を返す (E724 照合は transactionId 再送で代替される設計)", async () => {
    const found = await msCalendarAdapter.findByLinkId(CALENDAR_ID, "link-1", SECRET);
    expect(found).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("calendarExists / ensureAppCalendar", () => {
  it("calendarExists: 200 なら true、404 なら false、他は例外", async () => {
    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 200 }));
    expect(await msCalendarAdapter.calendarExists(CALENDAR_ID, SECRET)).toBe(true);

    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 404 }));
    expect(await msCalendarAdapter.calendarExists(CALENDAR_ID, SECRET)).toBe(false);
  });

  it("ensureAppCalendar: knownCalendarId が実在 (200) すればそのまま返し、検索/作成は呼ばない", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      record(input, init);
      return new Response(null, { status: 200 });
    });

    const id = await msCalendarAdapter.ensureAppCalendar(SECRET, "known-cal-1");
    expect(id).toBe("known-cal-1");
    expect(calls).toHaveLength(1);
  });

  it("ensureAppCalendar: knownCalendarId が 404 なら名前検索 → 発見すればそれを採用する", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      record(input, init);
      const url = String(input);
      if (url.includes("/me/calendars/gone-cal")) return new Response(null, { status: 404 });
      if (url.includes("%24filter")) return jsonResponse(200, { value: [{ id: "found-cal" }] });
      throw new Error(`unexpected call: ${url}`);
    });

    const id = await msCalendarAdapter.ensureAppCalendar(SECRET, "gone-cal");
    expect(id).toBe("found-cal");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("ensureAppCalendar: knownCalendarId が無く名前検索でも見つからなければ POST /me/calendars で新規作成する", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      record(input, init);
      const url = String(input);
      if (url.includes("%24filter")) return jsonResponse(200, { value: [] });
      return jsonResponse(200, { id: "new-cal-1" });
    });

    const id = await msCalendarAdapter.ensureAppCalendar(SECRET, null);
    expect(id).toBe("new-cal-1");
    expect(calls.some((c) => c.method === "POST" && c.url === `${GRAPH_BASE}/me/calendars`)).toBe(true);
  });
});

describe("getBusy: getSchedule → calendarView 合成フォールバック → degrade (§1.4/§18 R1)", () => {
  it("getSchedule が成功すれば calendarView は呼ばず、'free' 以外を busy として返す", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url === `${GRAPH_BASE}/me`) return jsonResponse(200, { mail: "owner@example.com" });
      if (url === `${GRAPH_BASE}/me/calendar/getSchedule`) {
        return jsonResponse(200, {
          value: [
            {
              scheduleItems: [
                { status: "busy", start: { dateTime: "2026-07-12T09:00:00.0000000", timeZone: "Tokyo Standard Time" }, end: { dateTime: "2026-07-12T10:00:00.0000000", timeZone: "Tokyo Standard Time" } },
                { status: "free", start: { dateTime: "2026-07-12T11:00:00.0000000", timeZone: "Tokyo Standard Time" }, end: { dateTime: "2026-07-12T12:00:00.0000000", timeZone: "Tokyo Standard Time" } },
              ],
            },
          ],
        });
      }
      throw new Error(`unexpected call (calendarView フォールバックが誤って呼ばれた疑い): ${url}`);
    });

    const busy = await msCalendarAdapter.getBusy({ start: "2026-07-12T00:00:00Z", end: "2026-07-13T00:00:00Z" }, SECRET);

    expect(busy).toEqual([{ start: "2026-07-12T00:00:00.000Z", end: "2026-07-12T01:00:00.000Z" }]);
  });

  it("getSchedule 呼び出しは Prefer: outlook.timezone ヘッダを付与する (BLOCKER 回帰防止 — 応答 scheduleItems の時刻表記は request body の timeZone とは独立に Prefer ヘッダでのみ制御される)", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      record(input, init);
      if (url === `${GRAPH_BASE}/me`) return jsonResponse(200, { mail: "owner@example.com" });
      if (url === `${GRAPH_BASE}/me/calendar/getSchedule`) return jsonResponse(200, { value: [] });
      throw new Error(`unexpected call: ${url}`);
    });

    await msCalendarAdapter.getBusy({ start: "2026-07-12T00:00:00Z", end: "2026-07-13T00:00:00Z" }, SECRET);

    const scheduleCall = calls.find((c) => c.url === `${GRAPH_BASE}/me/calendar/getSchedule`);
    expect(scheduleCall?.headers.Prefer).toBe('outlook.timezone="Tokyo Standard Time"');
  });

  it("getSchedule が確定失敗 (403 = MSA Not supported 相当) すると calendarView へフォールバックし、showAs='free' を除外した busy を返す", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url === `${GRAPH_BASE}/me`) return jsonResponse(200, { mail: "owner@example.com" });
      if (url === `${GRAPH_BASE}/me/calendar/getSchedule`) return new Response("not supported", { status: 403 });
      if (url.startsWith(`${GRAPH_BASE}/me/calendarView?`)) {
        return jsonResponse(200, {
          value: [
            { start: { dateTime: "2026-07-12T09:00:00.0000000", timeZone: "Tokyo Standard Time" }, end: { dateTime: "2026-07-12T10:00:00.0000000", timeZone: "Tokyo Standard Time" }, showAs: "busy" },
            { start: { dateTime: "2026-07-12T13:00:00.0000000", timeZone: "Tokyo Standard Time" }, end: { dateTime: "2026-07-12T14:00:00.0000000", timeZone: "Tokyo Standard Time" }, showAs: "free" },
          ],
        });
      }
      throw new Error(`unexpected call: ${url}`);
    });

    const busy = await msCalendarAdapter.getBusy({ start: "2026-07-12T00:00:00Z", end: "2026-07-13T00:00:00Z" }, SECRET);

    expect(busy).toEqual([{ start: "2026-07-12T00:00:00.000Z", end: "2026-07-12T01:00:00.000Z" }]);
  });

  it("getSchedule も calendarView も両方失敗すれば busy 帯なし ([]) で degrade し、例外は投げない", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url === `${GRAPH_BASE}/me`) return jsonResponse(200, { mail: "owner@example.com" });
      if (url === `${GRAPH_BASE}/me/calendar/getSchedule`) return new Response("error", { status: 500 });
      if (url.startsWith(`${GRAPH_BASE}/me/calendarView?`)) return new Response("error", { status: 500 });
      throw new Error(`unexpected call: ${url}`);
    });

    const busy = await msCalendarAdapter.getBusy({ start: "2026-07-12T00:00:00Z", end: "2026-07-13T00:00:00Z" }, SECRET);
    expect(busy).toEqual([]);
  });

  it("getSchedule が AuthExpiredError (401) の場合は calendarView へフォールバックせずそのまま送出する (同じ secret で叩いても同じ 401 になるため)", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url === `${GRAPH_BASE}/me`) return jsonResponse(200, { mail: "owner@example.com" });
      if (url === `${GRAPH_BASE}/me/calendar/getSchedule`) return new Response("unauthorized", { status: 401 });
      throw new Error(`unexpected call (calendarView フォールバックが誤って呼ばれた疑い): ${url}`);
    });

    await expect(
      msCalendarAdapter.getBusy({ start: "2026-07-12T00:00:00Z", end: "2026-07-13T00:00:00Z" }, SECRET),
    ).rejects.toBeInstanceOf(AuthExpiredError);
  });
});

describe("refreshTokens: MSA ローテーション + OAuth エラー分類 (§8.3)", () => {
  it("応答に refresh_token が含まれていれば必ず採用する (ローテーション — 拘束条件)", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(200, { access_token: "new-access", refresh_token: "new-refresh-rotated", expires_in: 3600 }),
    );

    const refreshed = await msCalendarAdapter.refreshTokens(SECRET, { clientId: "cid", clientSecret: "csecret" });

    expect(refreshed.refresh_token).toBe("new-refresh-rotated");
    expect(refreshed.access_token).toBe("new-access");
  });

  it("応答に refresh_token が含まれない場合のみ既存値を維持する (フォールバック)", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { access_token: "new-access", expires_in: 3600 }));

    const refreshed = await msCalendarAdapter.refreshTokens(SECRET, { clientId: "cid", clientSecret: "csecret" });

    expect(refreshed.refresh_token).toBe(SECRET.refresh_token);
  });

  it("invalid_client を含む応答は OAuthTokenError(oauthError='invalid_client') を送出する (§8.3手順6/§18 R9 — E720 と区別するため token.ts が分類に使う)", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(401, { error: "invalid_client", error_description: "expired client secret" }));

    let caught: unknown;
    try {
      await msCalendarAdapter.refreshTokens(SECRET, { clientId: "cid", clientSecret: "expired-secret" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OAuthTokenError);
    expect((caught as OAuthTokenError).oauthError).toBe("invalid_client");
  });

  it("invalid_grant を含む応答は OAuthTokenError(oauthError='invalid_grant') を送出する (通常の再連携要求)", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(400, { error: "invalid_grant" }));

    let caught: unknown;
    try {
      await msCalendarAdapter.refreshTokens(SECRET, { clientId: "cid", clientSecret: "csecret" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OAuthTokenError);
    expect((caught as OAuthTokenError).oauthError).toBe("invalid_grant");
  });

  it("JSON でない応答本文は oauthError=null で安全側に倒す (token.ts が status のみで判定できるように)", async () => {
    fetchMock.mockImplementation(async () => new Response("not json", { status: 500 }));

    let caught: unknown;
    try {
      await msCalendarAdapter.refreshTokens(SECRET, { clientId: "cid", clientSecret: "csecret" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OAuthTokenError);
    expect((caught as OAuthTokenError).oauthError).toBeNull();
  });
});

describe("timeout / ネットワーク断 → 結果不明分類 (classifySyncError と組み合わせて確認)", () => {
  it("AbortError は加工されずそのまま送出され、classifySyncError が 'unknown' に分類する", async () => {
    fetchMock.mockImplementation(async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    });

    let caught: unknown;
    try {
      await msCalendarAdapter.pullChanges(CALENDAR_ID, null, null, WINDOW, SECRET);
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
      await msCalendarAdapter.createEvent(
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

describe("429/403 は 1 回だけ指数バックオフ後リトライする (§8.1 末尾。google-api.ts と共通の msFetch 流儀)", () => {
  it("最初の応答が 429 でも 2 回目が成功なら成功として返す", async () => {
    vi.useFakeTimers();
    let callCount = 0;
    fetchMock.mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) return new Response("rate limited", { status: 429 });
      return jsonResponse(200, { id: "ev-1", changeKey: "ck-1", lastModifiedDateTime: "2026-07-12T00:00:00Z" });
    });

    const promise = msCalendarAdapter.createEvent(
      CALENDAR_ID,
      { linkId: "l1", blockId: "b1", title: "t", startsAt: "2026-07-12T00:00:00Z", endsAt: "2026-07-12T03:00:00Z" },
      SECRET,
    );
    await vi.advanceTimersByTimeAsync(1_000);
    const outcome = await promise;

    expect(callCount).toBe(2);
    expect(outcome.externalEventId).toBe("ev-1");
    vi.useRealTimers();
  });
});

describe("exchangeMsAuthorizationCode: 認可コード交換", () => {
  it("成功時は accessToken/refreshToken/expiresAt を返す", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { access_token: "at", refresh_token: "rt", expires_in: 3600 }));

    const result = await exchangeMsAuthorizationCode({
      clientId: "cid",
      clientSecret: "csecret",
      code: "auth-code",
      codeVerifier: "verifier",
      redirectUri: "https://example.com/callback",
    });

    expect(result.accessToken).toBe("at");
    expect(result.refreshToken).toBe("rt");
  });

  it("refresh_token が応答に含まれなければ refreshToken=null (呼び出し元が E720 判定する)", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { access_token: "at", expires_in: 3600 }));

    const result = await exchangeMsAuthorizationCode({
      clientId: "cid",
      clientSecret: "csecret",
      code: "auth-code",
      codeVerifier: "verifier",
      redirectUri: "https://example.com/callback",
    });

    expect(result.refreshToken).toBeNull();
  });
});

describe("fetchMsAccountEmail: mail ?? userPrincipalName (§8.2 手順3)", () => {
  it("mail があればそれを返す", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { mail: "owner@example.com", userPrincipalName: "owner@example.onmicrosoft.com" }));
    expect(await fetchMsAccountEmail("at")).toBe("owner@example.com");
  });

  it("mail が null なら userPrincipalName にフォールバックする", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, { mail: null, userPrincipalName: "owner@example.onmicrosoft.com" }));
    expect(await fetchMsAccountEmail("at")).toBe("owner@example.onmicrosoft.com");
  });

  it("両方とも無ければ null を返す (異常系。呼び出し元が KMB-E720 判定する)", async () => {
    fetchMock.mockImplementation(async () => jsonResponse(200, {}));
    expect(await fetchMsAccountEmail("at")).toBeNull();
  });

  it("GET /me が確定エラーなら例外を投げる (握り潰さない)", async () => {
    fetchMock.mockImplementation(async () => new Response("forbidden", { status: 403 }));
    await expect(fetchMsAccountEmail("at")).rejects.toThrow();
  });
});
