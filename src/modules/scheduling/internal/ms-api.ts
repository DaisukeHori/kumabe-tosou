// scheduling/internal/ms-api.ts — Microsoft Graph (カレンダー) API の薄い fetch ラッパ。
// canonical: docs/design/crm-suite/03-scheduling.md §3.3 (応答 zod) / §8.1 (表の Microsoft 列)。
// google-api.ts (#54) と同型構成 — provider 固有の差分だけをこのファイルに閉じる。
//
// 【最重要地雷】@microsoft/microsoft-graph-client パッケージの import は ESLint
// (no-restricted-imports / CALENDAR_SDK_PACKAGES) で全面禁止されている。素の fetch のみを使うこと。
// 【地雷】Graph はイベント ID がカレンダーに紐づかずグローバルなため、更新/削除は
// `/me/events/{id}` (calendarId を含まない) を叩く。作成のみ `/me/calendars/{id}/events`。
// 【地雷】extendedProperties 相当の出所マーキングは Graph では「既知問題のため」不使用
// (canonical §2.3 comment)。作成の冪等性は `transactionId` (サーバ側の重複作成防止) にのみ依存する。
// そのため findByLinkId は常に null を返す固定実装とする (#8.7 の照合は再送で代替する設計)。
import "server-only";

import { z } from "zod";

import type {
  CalendarProviderAdapter,
  ExternalEventChange,
  ExternalEventInput,
  PullPage,
  WriteOutcome,
} from "./provider";
import { AuthExpiredError, ConfirmedApiError, ConflictError, GoneError, OAuthTokenError } from "./provider";
import type { ProviderEnv } from "./provider";
import type { CalendarVaultSecret } from "./vault-names";

const GRAPH_API_BASE = "https://graph.microsoft.com/v1.0";
const MS_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const FETCH_TIMEOUT_MS = 15_000;
const APP_CALENDAR_NAME = "隈部塗装 作業予定";
const GRAPH_TIME_ZONE_NAME = "Tokyo Standard Time"; // Windows タイムゾーン名 (Graph の timeZone フィールド用)
// scope はスペース区切りの単一文字列。トークン交換 (exchangeMsAuthorizationCode) / refresh
// (refreshTokens) の 2 箇所で共用する。認可開始 URL 側 (route) は Google 版と同様に
// 独立して文字列を持つ (route は internal/ を参照しない既存規約 — google-calendar/start 前例)。
// User.Read は account_email 取得 (GET /me) 用 (§8.2 手順3)。
const MS_CALENDAR_SCOPE = "offline_access Calendars.ReadWrite User.Read";
// 読み出し時に全イベントの時刻を JST (DST なし固定オフセット) で統一して返させるヘッダ
// (§8.1 表末尾「読み時 Prefer: outlook.timezone=…」)。書込みは start/end.timeZone を明示するため不要。
const PREFER_JST_HEADER = { Prefer: `outlook.timezone="${GRAPH_TIME_ZONE_NAME}"` };

// ---------------------------------------------------------------------------
// 応答の最小 parse (§3.3。業務利用フィールドのみ検証。未知キーは strip)
// ---------------------------------------------------------------------------

export const zGraphEvent = z.object({
  id: z.string().optional(),
  "@removed": z.object({ reason: z.string().optional() }).optional(), // delta の削除通知
  changeKey: z.string().optional(),
  iCalUId: z.string().optional(),
  lastModifiedDateTime: z.string().optional(),
  subject: z.string().optional(),
  isAllDay: z.boolean().optional(), // 終日化検知 (P31 — §8.5)
  start: z.object({ dateTime: z.string(), timeZone: z.string() }).optional(),
  end: z.object({ dateTime: z.string(), timeZone: z.string() }).optional(),
});

/** create/update 応答専用: id は必ず返る前提のため必須化する (`as` キャスト無しで型を確定させる)。 */
const zGraphEventWritten = zGraphEvent.extend({ id: z.string() });

export const zGraphDeltaResponse = z.object({
  value: z.array(zGraphEvent).default([]),
  "@odata.nextLink": z.string().optional(),
  "@odata.deltaLink": z.string().optional(),
});

export const zGraphScheduleResponse = z.object({
  value: z
    .array(
      z.object({
        scheduleItems: z
          .array(
            z.object({
              status: z.string().optional(), // 'busy' | 'tentative' | 'free' | 'oof' | 'workingElsewhere'
              start: z.object({ dateTime: z.string(), timeZone: z.string() }),
              end: z.object({ dateTime: z.string(), timeZone: z.string() }),
            }),
          )
          .default([]),
      }),
    )
    .default([]),
});

export const zGraphTokenResponse = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(), // MSA は毎回新しい値 → 必ず上書き保存 (§8.3)
});

const zGraphMeResponse = z.object({
  mail: z.string().nullable().optional(),
  userPrincipalName: z.string().optional(),
});

const zGraphCalendarResponse = z.object({ id: z.string() });
const zGraphCalendarListResponse = z.object({
  value: z.array(z.object({ id: z.string() })).default([]),
});
const zGraphCalendarViewResponse = z.object({
  value: z
    .array(
      z.object({
        start: z.object({ dateTime: z.string(), timeZone: z.string() }).optional(),
        end: z.object({ dateTime: z.string(), timeZone: z.string() }).optional(),
        showAs: z.string().optional(),
      }),
    )
    .default([]),
  "@odata.nextLink": z.string().optional(),
});

// ---------------------------------------------------------------------------
// fetch 共通ラッパ (§8.1 末尾: timeout 15秒、429/403 は 1 回だけ指数バックオフ後リトライ)
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** pathOrUrl が絶対 URL (nextLink/deltaLink は Graph がフル URL で返す) ならそのまま使う。 */
async function msFetch(
  pathOrUrl: string,
  init: { method: string; accessToken: string; headers?: Record<string, string>; body?: string },
): Promise<Response> {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${GRAPH_API_BASE}${pathOrUrl}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${init.accessToken}`,
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(init.headers ?? {}),
  };
  const doFetch = () =>
    fetch(url, {
      method: init.method,
      headers,
      body: init.body,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

  let res = await doFetch();
  if (res.status === 429 || res.status === 403) {
    await sleep(1_000);
    res = await doFetch();
  }
  return res;
}

async function throwForStatus(res: Response): Promise<never> {
  const bodyText = await res.text().catch(() => "");
  const message = `Microsoft Graph API error (status=${res.status}): ${bodyText.slice(0, 500)}`;
  if (res.status === 410) throw new GoneError(message);
  if (res.status === 401) throw new AuthExpiredError(message);
  if (res.status === 412 || res.status === 409) throw new ConflictError(message, res.status);
  throw new ConfirmedApiError(message, res.status);
}

// ---------------------------------------------------------------------------
// 時刻表記
// ---------------------------------------------------------------------------

/** ISO (UTC 等) → JST 壁時計表記 (timeZone は別フィールドで渡すため offset は付けない)。 */
function toGraphLocalDateTime(isoUtc: string): string {
  const utcMs = new Date(isoUtc).getTime();
  const jst = new Date(utcMs + 9 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = jst.getUTCFullYear();
  const mm = pad(jst.getUTCMonth() + 1);
  const dd = pad(jst.getUTCDate());
  const hh = pad(jst.getUTCHours());
  const mi = pad(jst.getUTCMinutes());
  const ss = pad(jst.getUTCSeconds());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`;
}

/**
 * Graph の壁時計表記 (小数秒付き、offset なし) → UTC ISO。
 * `Prefer: outlook.timezone="Tokyo Standard Time"` を必ず付けて呼ぶため、JST (+09:00 固定・
 * DST なし) の壁時計として解釈してよい (google-api.ts の toJstRfc3339 の逆変換に相当)。
 */
function fromGraphLocalDateTime(dateTime: string): string {
  const base = dateTime.split(".")[0] ?? dateTime; // 小数秒 (最大7桁) を切り捨て — 分単位の粒度で足りる
  return new Date(`${base}+09:00`).toISOString();
}

function buildGraphEventBody(input: ExternalEventInput): Record<string, unknown> {
  return {
    subject: input.title,
    start: { dateTime: toGraphLocalDateTime(input.startsAt), timeZone: GRAPH_TIME_ZONE_NAME },
    end: { dateTime: toGraphLocalDateTime(input.endsAt), timeZone: GRAPH_TIME_ZONE_NAME },
  };
}

function toWriteOutcome(event: z.infer<typeof zGraphEventWritten>): WriteOutcome {
  return {
    externalEventId: event.id,
    etagOrChangeKey: event.changeKey ?? null,
    externalUpdatedAt: event.lastModifiedDateTime ?? null,
    icalUid: event.iCalUId ?? null,
  };
}

function toExternalEventChange(event: z.infer<typeof zGraphEvent>): ExternalEventChange {
  const removed = Boolean(event["@removed"]);
  const isAllDay = !removed && Boolean(event.isAllDay); // P31 (Graph は isAllDay を明示するため Google より単純)
  const startsAt = !removed && !isAllDay && event.start?.dateTime ? fromGraphLocalDateTime(event.start.dateTime) : null;
  const endsAt = !removed && !isAllDay && event.end?.dateTime ? fromGraphLocalDateTime(event.end.dateTime) : null;
  return {
    // delta の @removed 通知でも id は付随する (Graph 仕様)。万一欠落していたら空文字列にはせず
    // 例外にする (parse 側で id を必須化していないのはここが唯一の消費箇所であるため)。
    externalEventId: event.id ?? (() => {
      throw new Error("Graph delta 応答に id が含まれていません (@removed 通知でも必須のはず)");
    })(),
    etagOrChangeKey: event.changeKey ?? null,
    icalUid: event.iCalUId ?? null,
    externalUpdatedAt: event.lastModifiedDateTime ?? null,
    title: event.subject ?? null,
    startsAt,
    endsAt,
    removed,
    isAllDay,
    // Graph は拡張プロパティに依存しない設計 (canonical §2.3 comment — 既知問題のため)。
    // 出所マーキングからの復元は Google のみ確実 (§8.1 の appLinkId/appBlockId 注記)。
    appLinkId: null,
    appBlockId: null,
  };
}

// ---------------------------------------------------------------------------
// CalendarProviderAdapter 実装
// ---------------------------------------------------------------------------

async function ensureAppCalendar(secret: CalendarVaultSecret, knownCalendarId: string | null): Promise<string> {
  if (knownCalendarId) {
    const res = await msFetch(`/me/calendars/${encodeURIComponent(knownCalendarId)}`, {
      method: "GET",
      accessToken: secret.access_token,
    });
    if (res.ok) return knownCalendarId;
    if (res.status !== 404) await throwForStatus(res);
    // 404 → 未保存扱いでフォールスルー (Google 版と同型)
  }

  // 未保存時のみ名前で検索する (§8.1 の Microsoft 列: 「未保存時のみ GET /me/calendars?$filter=…」)
  const searchParams = new URLSearchParams();
  searchParams.set("$filter", `name eq '${APP_CALENDAR_NAME}'`);
  const searchRes = await msFetch(`/me/calendars?${searchParams.toString()}`, {
    method: "GET",
    accessToken: secret.access_token,
  });
  if (!searchRes.ok) await throwForStatus(searchRes);
  const searchJson: unknown = await searchRes.json();
  const searchParsed = zGraphCalendarListResponse.parse(searchJson);
  if (searchParsed.value.length > 0) return searchParsed.value[0].id;

  const createRes = await msFetch(`/me/calendars`, {
    method: "POST",
    accessToken: secret.access_token,
    body: JSON.stringify({ name: APP_CALENDAR_NAME }),
  });
  if (!createRes.ok) await throwForStatus(createRes);
  const createJson: unknown = await createRes.json();
  return zGraphCalendarResponse.parse(createJson).id;
}

async function calendarExists(calendarId: string, secret: CalendarVaultSecret): Promise<boolean> {
  const res = await msFetch(`/me/calendars/${encodeURIComponent(calendarId)}`, {
    method: "GET",
    accessToken: secret.access_token,
  });
  if (res.ok) return true;
  if (res.status === 404) return false;
  return throwForStatus(res);
}

async function createEvent(calendarId: string, input: ExternalEventInput, secret: CalendarVaultSecret): Promise<WriteOutcome> {
  const body = {
    ...buildGraphEventBody(input),
    // リトライによる二重作成防止 (§8.1/§8.4「MS: transactionId でサーバ側防止」)。
    // 同じ linkId で再送すると Graph が既存イベントを返す (findByLinkId=null を補う仕組み)。
    transactionId: `kmb-${input.linkId}`,
  };
  const res = await msFetch(`/me/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    accessToken: secret.access_token,
    body: JSON.stringify(body),
  });
  if (!res.ok) await throwForStatus(res);
  const json: unknown = await res.json();
  return toWriteOutcome(zGraphEventWritten.parse(json));
}

async function updateEvent(
  _calendarId: string,
  externalEventId: string,
  input: ExternalEventInput,
  ifMatch: string | null,
  secret: CalendarVaultSecret,
): Promise<WriteOutcome> {
  // Graph のイベント ID はグローバル (カレンダーに紐づかない) — §8.1 の Microsoft 列どおり
  // /me/events/{id} を直接叩く (calendarId は使わない)。
  const res = await msFetch(`/me/events/${encodeURIComponent(externalEventId)}`, {
    method: "PATCH",
    accessToken: secret.access_token,
    headers: ifMatch ? { "If-Match": ifMatch } : undefined,
    body: JSON.stringify(buildGraphEventBody(input)),
  });
  if (!res.ok) await throwForStatus(res);
  const json: unknown = await res.json();
  return toWriteOutcome(zGraphEventWritten.parse(json));
}

async function deleteEvent(_calendarId: string, externalEventId: string, secret: CalendarVaultSecret): Promise<void> {
  const res = await msFetch(`/me/events/${encodeURIComponent(externalEventId)}`, {
    method: "DELETE",
    accessToken: secret.access_token,
  });
  if (res.ok || res.status === 404 || res.status === 410) return; // 404/410 は成功扱い (§8.1)
  await throwForStatus(res);
}

async function pullChanges(
  calendarId: string,
  syncToken: string | null,
  pageCursor: string | null,
  window: { start: string; end: string } | null,
  secret: CalendarVaultSecret,
): Promise<PullPage> {
  let url: string;
  if (pageCursor) {
    url = pageCursor; // 継続ページ (nextLink はフル URL — §8.5 途中終了からの継続)
  } else if (syncToken) {
    url = syncToken; // 増分同期の起点 (deltaLink はフル URL)
  } else {
    // 初回フル同期。Graph の calendarView/delta は時間窓必須 (§1.4/§8.1 — syncToken 併用不可の
    // Google とは異なり、時間窓は増分同期でも「窓の初期化」としてラウンド開始時に必須)。
    if (!window) {
      throw new Error(
        "Graph delta の初回同期には時間窓 (calendar_connections.meta.sync_window_start/end) が必要です。" +
          "OAuth 接続が正しく完了していない可能性があります。",
      );
    }
    const params = new URLSearchParams();
    params.set("startDateTime", window.start);
    params.set("endDateTime", window.end);
    url = `${GRAPH_API_BASE}/me/calendars/${encodeURIComponent(calendarId)}/calendarView/delta?${params.toString()}`;
  }

  const res = await msFetch(url, { method: "GET", accessToken: secret.access_token, headers: PREFER_JST_HEADER });
  if (!res.ok) {
    if (res.status === 410) throw new GoneError("Graph delta link expired (410)");
    await throwForStatus(res);
  }
  const json: unknown = await res.json();
  const parsed = zGraphDeltaResponse.parse(json);
  return {
    changes: parsed.value.map(toExternalEventChange),
    nextPageCursor: parsed["@odata.nextLink"] ?? null,
    nextSyncToken: parsed["@odata.deltaLink"] ?? null,
  };
}

/**
 * MS: 常に null を返す固定実装 (§8.1/§8.7)。Graph は拡張プロパティに依存しない設計のため
 * privateExtendedProperty 相当の検索手段が無く、E724 の照合は `transactionId` を使った
 * 再送 (createEvent の再実行 = pending_push へ戻すだけ) で代替する
 * (facade.reconcilePushUnknown が「未発見 → pending_push に戻して再送」分岐へ自然に落ちる)。
 */
async function findByLinkId(): Promise<ExternalEventChange | null> {
  return null;
}

async function fetchAccountEmail(accessToken: string): Promise<string | null> {
  const res = await msFetch("/me", { method: "GET", accessToken });
  if (!res.ok) await throwForStatus(res);
  const json: unknown = await res.json();
  const parsed = zGraphMeResponse.parse(json);
  return parsed.mail ?? parsed.userPrincipalName ?? null;
}

/** getSchedule 経由の busy 帯取得 (§8.1 の Microsoft 列本来のパス)。 */
async function getBusyViaSchedule(range: { start: string; end: string }, secret: CalendarVaultSecret): Promise<Array<{ start: string; end: string }>> {
  const email = await fetchAccountEmail(secret.access_token);
  if (!email) throw new Error("getSchedule に必要な account_email を取得できませんでした (GET /me)");

  const res = await msFetch("/me/calendar/getSchedule", {
    method: "POST",
    accessToken: secret.access_token,
    // 【BLOCKER 修正】Prefer: outlook.timezone は request body の startTime/endTime.timeZone とは
    // 独立に、応答 scheduleItems[].start/end の表記を制御する (Microsoft Learn: getSchedule の
    // Request headers 表「If not specified, those time values are returned in UTC.」)。付けないと
    // 応答は UTC 壁時計で返るが fromGraphLocalDateTime は常に「+09:00 (JST) の壁時計」として
    // 解釈するため、全 busy 帯が 9 時間ずれる (pullChanges/getBusyViaCalendarView と同型で必須)。
    headers: PREFER_JST_HEADER,
    body: JSON.stringify({
      schedules: [email],
      startTime: { dateTime: toGraphLocalDateTime(range.start), timeZone: GRAPH_TIME_ZONE_NAME },
      endTime: { dateTime: toGraphLocalDateTime(range.end), timeZone: GRAPH_TIME_ZONE_NAME },
      availabilityViewInterval: 30,
    }),
  });
  if (!res.ok) await throwForStatus(res);
  const json: unknown = await res.json();
  const parsed = zGraphScheduleResponse.parse(json);
  const items = parsed.value[0]?.scheduleItems ?? [];
  return items
    .filter((item) => item.status !== "free")
    .map((item) => ({ start: fromGraphLocalDateTime(item.start.dateTime), end: fromGraphLocalDateTime(item.end.dateTime) }));
}

/**
 * getSchedule のフォールバック: 主カレンダー calendarView から busy 帯を合成する
 * (§1.4 「MSA の delegated では getSchedule が Not supported」への対処。Calendars.ReadWrite
 * スコープで到達可能)。showAs='free' のイベントは busy から除外する。最大 10 ページ (安全弁)。
 */
async function getBusyViaCalendarView(range: { start: string; end: string }, secret: CalendarVaultSecret): Promise<Array<{ start: string; end: string }>> {
  const results: Array<{ start: string; end: string }> = [];
  const initialParams = new URLSearchParams();
  initialParams.set("startDateTime", range.start);
  initialParams.set("endDateTime", range.end);
  initialParams.set("$select", "start,end,showAs");
  initialParams.set("$top", "100");
  let url: string | null = `${GRAPH_API_BASE}/me/calendarView?${initialParams.toString()}`;

  for (let page = 0; page < 10 && url; page++) {
    const res = await msFetch(url, { method: "GET", accessToken: secret.access_token, headers: PREFER_JST_HEADER });
    if (!res.ok) await throwForStatus(res);
    const json: unknown = await res.json();
    const parsed = zGraphCalendarViewResponse.parse(json);
    for (const event of parsed.value) {
      if (event.showAs === "free") continue;
      if (!event.start?.dateTime || !event.end?.dateTime) continue;
      results.push({ start: fromGraphLocalDateTime(event.start.dateTime), end: fromGraphLocalDateTime(event.end.dateTime) });
    }
    url = parsed["@odata.nextLink"] ?? null;
  }
  return results;
}

/**
 * busy 帯取得 (§8.1)。getSchedule → (MSA delegated で Not supported 等の場合) calendarView 合成
 * フォールバック → (それも失敗) busy 帯なしで degrade、の 3 段構成 (§1.4/§18 R1 — canonical が
 * 明示する縮退設計であり黙殺ではない。ログは必ず残す)。
 *
 * 【判断根拠 (未解決点への対応 — オーケストレーターへ報告)】
 * canonical はフォールバック条件を「403 / MailboxNotEnabledForRESTAPI 等の確定失敗」と例示するのみで
 * 網羅列挙していない (実運用の Graph エラーコードは未確認)。ここでは AuthExpiredError 以外の
 * 全エラー (4xx/5xx/timeout 含む) でフォールバックする安全側の実装とした — 判定条件を狭めて
 * 本来フォールバックすべきケースを取りこぼす方が「MSA ユーザーの busy 表示が恒久的に効かない」
 * という実害が大きく、フォールバックを広く取っても最悪 calendarView への 1 回の無駄な追加呼び出しで
 * 済むため。AuthExpiredError のみ除外するのは、同じ secret で calendarView を叩いても
 * 同じ 401 になるだけでフォールバックの意味が無く、呼び出し元 (facade.getExternalBusy) の
 * 既存の E720 変換ロジックへそのまま伝播させたほうが正しいため。
 * 2 段目 (calendarView) も失敗した場合は busy 帯なしで degrade する (§8.1 の明示的な縮退仕様)。
 * この場合の UI 注記表示 (接続カードへの「busy 帯取得不可」バナー) は本 Issue のスコープ外
 * (openIssues 参照)。
 */
async function getBusy(range: { start: string; end: string }, secret: CalendarVaultSecret): Promise<Array<{ start: string; end: string }>> {
  try {
    return await getBusyViaSchedule(range, secret);
  } catch (err) {
    if (err instanceof AuthExpiredError) throw err;
    console.warn(
      `[scheduling] ms-api.getBusy: getSchedule に失敗しました。calendarView 合成へフォールバックします (§1.4): ${err instanceof Error ? err.message : String(err)}`,
    );
    try {
      return await getBusyViaCalendarView(range, secret);
    } catch (fallbackErr) {
      if (fallbackErr instanceof AuthExpiredError) throw fallbackErr;
      console.error(
        `[scheduling] ms-api.getBusy: calendarView フォールバックも失敗しました。busy 帯なしで degrade します (§8.1/§18 R1): ${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`,
      );
      return [];
    }
  }
}

async function refreshTokens(secret: CalendarVaultSecret, env: ProviderEnv): Promise<CalendarVaultSecret> {
  const body = new URLSearchParams({
    client_id: env.clientId,
    client_secret: env.clientSecret,
    grant_type: "refresh_token",
    refresh_token: secret.refresh_token,
    scope: MS_CALENDAR_SCOPE,
  });
  const res = await fetch(MS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    let oauthError: string | null = null;
    try {
      const parsedBody: unknown = JSON.parse(bodyText);
      if (parsedBody && typeof parsedBody === "object" && "error" in parsedBody) {
        const rawError = (parsedBody as { error?: unknown }).error;
        if (typeof rawError === "string") oauthError = rawError;
      }
    } catch {
      // 応答が JSON でない場合は oauthError=null のまま (token.ts が status のみで安全側判定)
    }
    throw new OAuthTokenError(
      `Microsoft token refresh failed (status=${res.status}): ${bodyText.slice(0, 500)}`,
      res.status,
      oauthError,
    );
  }
  const json: unknown = await res.json();
  const parsed = zGraphTokenResponse.parse(json);
  return {
    access_token: parsed.access_token,
    // MSA ローテーション: 応答に refresh_token があれば必ず採用する (拘束条件 §8.3 手順3)。
    // 応答に無い場合のみ既存値を維持する (MSA では通常必ず新しい値が返る想定)。
    refresh_token: parsed.refresh_token ?? secret.refresh_token,
    expires_at: new Date(Date.now() + parsed.expires_in * 1000).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// OAuth 接続 (§8.2)。CalendarProviderAdapter の対象外 (push/pull ではなく接続開始時にのみ使う) —
// facade.ts の completeMsCalendarOAuthCallback が呼ぶ (google-api.ts の
// exchangeGoogleAuthorizationCode/decodeGoogleIdTokenEmail と同型パターン)。
// ---------------------------------------------------------------------------

export type MsAuthorizationCodeResult = {
  accessToken: string;
  refreshToken: string | null; // 応答に含まれない場合は null (呼び出し元が E720 判定)
  expiresAt: string;
};

/** 認可コード → トークン交換 (grant_type=authorization_code + PKCE code_verifier)。 */
export async function exchangeMsAuthorizationCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<MsAuthorizationCodeResult> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    code_verifier: input.codeVerifier,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
    scope: MS_CALENDAR_SCOPE,
  });
  const res = await fetch(MS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    let oauthError: string | null = null;
    try {
      const parsedBody: unknown = JSON.parse(bodyText);
      if (parsedBody && typeof parsedBody === "object" && "error" in parsedBody) {
        const rawError = (parsedBody as { error?: unknown }).error;
        if (typeof rawError === "string") oauthError = rawError;
      }
    } catch {
      // 応答が JSON でない場合は oauthError=null のまま
    }
    throw new OAuthTokenError(
      `Microsoft authorization code exchange failed (status=${res.status}): ${bodyText.slice(0, 500)}`,
      res.status,
      oauthError,
    );
  }
  const json: unknown = await res.json();
  const parsed = zGraphTokenResponse.parse(json);
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token ?? null,
    expiresAt: new Date(Date.now() + parsed.expires_in * 1000).toISOString(),
  };
}

/**
 * account_email の取得 (§8.2 手順3「MS は GET /me の mail ?? userPrincipalName (User.Read)」)。
 * Google の decodeGoogleIdTokenEmail (id_token をローカルデコード) と異なり実際に Graph へ
 * 1 回 API 呼び出しが要る (Microsoft は openid/id_token を要求しないスコープ構成のため)。
 * ネットワーク/認可エラーは例外を投げる (呼び出し元 facade の catch が KMB-E901 に変換)。
 * 応答は成功したが mail も userPrincipalName も無い異常系のみ null を返す
 * (呼び出し元が Google と同様に KMB-E720 判定できるようにするため)。
 */
export async function fetchMsAccountEmail(accessToken: string): Promise<string | null> {
  return fetchAccountEmail(accessToken);
}

export const msCalendarAdapter: CalendarProviderAdapter = {
  ensureAppCalendar,
  calendarExists,
  createEvent,
  updateEvent,
  deleteEvent,
  pullChanges,
  findByLinkId,
  getBusy,
  refreshTokens,
};
