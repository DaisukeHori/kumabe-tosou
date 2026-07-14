// scheduling/internal/google-api.ts — Google Calendar API の薄い fetch ラッパ。
// canonical: docs/design/crm-suite/03-scheduling.md §3.3 (応答 zod) / §8.1 (表の Google 列)。
//
// 【最重要地雷】googleapis パッケージの import は ESLint (no-restricted-imports /
// CALENDAR_SDK_PACKAGES) で全面禁止されている。素の fetch のみを使うこと。
// 【地雷】calendarList 系 API を一切呼ばない (calendarList.list/.get は app.created スコープ外で
// 403 になる — §1.4)。既存カレンダー確認は保存済み app_calendar_id への calendars.get のみ。
import "server-only";

import { z } from "zod";

import type { CalendarProviderAdapter, ExternalEventChange, ExternalEventInput, PullPage, WriteOutcome } from "./provider";
import { AuthExpiredError, ConfirmedApiError, ConflictError, GoneError, OAuthTokenError } from "./provider";
import type { ProviderEnv } from "./provider";
import type { CalendarVaultSecret } from "./vault-names";

const GOOGLE_API_BASE = "https://www.googleapis.com/calendar/v3";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FETCH_TIMEOUT_MS = 15_000;
const APP_CALENDAR_SUMMARY = "隈部塗装 作業予定";
const APP_CALENDAR_TIME_ZONE = "Asia/Tokyo";

// ---------------------------------------------------------------------------
// 応答の最小 parse (§3.3。業務利用フィールドのみ検証。未知キーは strip)
// ---------------------------------------------------------------------------

export const zGoogleEvent = z.object({
  id: z.string(),
  status: z.string().optional(), // 'cancelled' = 削除
  etag: z.string().optional(),
  iCalUID: z.string().optional(),
  updated: z.string().optional(),
  summary: z.string().optional(),
  start: z.object({ dateTime: z.string().optional(), date: z.string().optional() }).optional(),
  end: z.object({ dateTime: z.string().optional(), date: z.string().optional() }).optional(),
  extendedProperties: z
    .object({
      private: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
});

export const zGoogleEventsListResponse = z.object({
  items: z.array(zGoogleEvent).default([]),
  nextPageToken: z.string().optional(),
  nextSyncToken: z.string().optional(), // 最終ページのみ (ext-calendar §2.2)
});

export const zGoogleFreeBusyResponse = z.object({
  calendars: z.record(
    z.string(),
    z.object({
      busy: z.array(z.object({ start: z.string(), end: z.string() })).default([]),
    }),
  ),
});

export const zGoogleTokenResponse = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(), // refresh 時は返らないことがある (非ローテーション)
  id_token: z.string().optional(), // openid email 要求時のみ。account_email の取得源 (§8.2)
});

// ---------------------------------------------------------------------------
// fetch 共通ラッパ (§8.1 末尾: timeout 15秒、429/403 は 1 回だけ指数バックオフ後リトライ)
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function googleFetch(
  url: string,
  init: { method: string; accessToken: string; headers?: Record<string, string>; body?: string },
): Promise<Response> {
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
  const message = `Google Calendar API error (status=${res.status}): ${bodyText.slice(0, 500)}`;
  if (res.status === 410) throw new GoneError(message);
  if (res.status === 401) throw new AuthExpiredError(message);
  if (res.status === 412 || res.status === 409) throw new ConflictError(message, res.status);
  throw new ConfirmedApiError(message, res.status);
}

// ---------------------------------------------------------------------------
// 時刻表記 (§8.6 のハッシュ正規化とは独立 — 書込み専用の Asia/Tokyo offset 表記へ変換)
// ---------------------------------------------------------------------------

/** ISO (UTC 等) → Asia/Tokyo (+09:00 固定、DST なし) の RFC3339 表記へ変換 (§8.2 書込み表記)。 */
function toJstRfc3339(isoUtc: string): string {
  const utcMs = new Date(isoUtc).getTime();
  const jst = new Date(utcMs + 9 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = jst.getUTCFullYear();
  const mm = pad(jst.getUTCMonth() + 1);
  const dd = pad(jst.getUTCDate());
  const hh = pad(jst.getUTCHours());
  const mi = pad(jst.getUTCMinutes());
  const ss = pad(jst.getUTCSeconds());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}+09:00`;
}

function buildEventBody(input: ExternalEventInput): Record<string, unknown> {
  return {
    summary: input.title,
    start: { dateTime: toJstRfc3339(input.startsAt), timeZone: APP_CALENDAR_TIME_ZONE },
    end: { dateTime: toJstRfc3339(input.endsAt), timeZone: APP_CALENDAR_TIME_ZONE },
    extendedProperties: {
      private: {
        kumabe_link_id: input.linkId,
        kumabe_block_id: input.blockId,
        kumabe_origin: "app",
      },
    },
  };
}

function toWriteOutcome(event: z.infer<typeof zGoogleEvent>): WriteOutcome {
  return {
    externalEventId: event.id,
    etagOrChangeKey: event.etag ?? null,
    externalUpdatedAt: event.updated ?? null,
    icalUid: event.iCalUID ?? null,
  };
}

function toExternalEventChange(event: z.infer<typeof zGoogleEvent>): ExternalEventChange {
  const removed = event.status === "cancelled";
  // 終日イベント (P31) は start.date のみが立ち、start.dateTime が無い。
  const isAllDay = !removed && Boolean(event.start?.date) && !event.start?.dateTime;
  const startsAt = !removed && !isAllDay && event.start?.dateTime ? new Date(event.start.dateTime).toISOString() : null;
  const endsAt = !removed && !isAllDay && event.end?.dateTime ? new Date(event.end.dateTime).toISOString() : null;
  const priv = event.extendedProperties?.private ?? {};
  return {
    externalEventId: event.id,
    etagOrChangeKey: event.etag ?? null,
    icalUid: event.iCalUID ?? null,
    externalUpdatedAt: event.updated ?? null,
    title: event.summary ?? null,
    startsAt,
    endsAt,
    removed,
    isAllDay,
    appLinkId: priv.kumabe_link_id ?? null,
    appBlockId: priv.kumabe_block_id ?? null,
  };
}

// ---------------------------------------------------------------------------
// CalendarProviderAdapter 実装
// ---------------------------------------------------------------------------

async function ensureAppCalendar(secret: CalendarVaultSecret, knownCalendarId: string | null): Promise<string> {
  if (knownCalendarId) {
    const res = await googleFetch(`${GOOGLE_API_BASE}/calendars/${encodeURIComponent(knownCalendarId)}`, {
      method: "GET",
      accessToken: secret.access_token,
    });
    if (res.ok) return knownCalendarId;
    if (res.status !== 404) await throwForStatus(res);
    // 404 → 未保存扱いで新規作成へフォールスルー
  }

  const res = await googleFetch(`${GOOGLE_API_BASE}/calendars`, {
    method: "POST",
    accessToken: secret.access_token,
    body: JSON.stringify({ summary: APP_CALENDAR_SUMMARY, timeZone: APP_CALENDAR_TIME_ZONE }),
  });
  if (!res.ok) await throwForStatus(res);
  const json: unknown = await res.json();
  const parsed = z.object({ id: z.string() }).parse(json);
  return parsed.id;
}

async function calendarExists(calendarId: string, secret: CalendarVaultSecret): Promise<boolean> {
  const res = await googleFetch(`${GOOGLE_API_BASE}/calendars/${encodeURIComponent(calendarId)}`, {
    method: "GET",
    accessToken: secret.access_token,
  });
  if (res.ok) return true;
  if (res.status === 404) return false;
  return throwForStatus(res);
}

async function createEvent(calendarId: string, input: ExternalEventInput, secret: CalendarVaultSecret): Promise<WriteOutcome> {
  const res = await googleFetch(`${GOOGLE_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: "POST",
    accessToken: secret.access_token,
    body: JSON.stringify(buildEventBody(input)),
  });
  if (!res.ok) await throwForStatus(res);
  const json: unknown = await res.json();
  return toWriteOutcome(zGoogleEvent.parse(json));
}

async function updateEvent(
  calendarId: string,
  externalEventId: string,
  input: ExternalEventInput,
  ifMatch: string | null,
  secret: CalendarVaultSecret,
): Promise<WriteOutcome> {
  const res = await googleFetch(
    `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(externalEventId)}`,
    {
      method: "PUT",
      accessToken: secret.access_token,
      headers: ifMatch ? { "If-Match": ifMatch } : undefined,
      body: JSON.stringify(buildEventBody(input)),
    },
  );
  if (!res.ok) await throwForStatus(res);
  const json: unknown = await res.json();
  return toWriteOutcome(zGoogleEvent.parse(json));
}

async function deleteEvent(calendarId: string, externalEventId: string, secret: CalendarVaultSecret): Promise<void> {
  const res = await googleFetch(
    `${GOOGLE_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(externalEventId)}`,
    { method: "DELETE", accessToken: secret.access_token },
  );
  if (res.ok || res.status === 404 || res.status === 410) return; // 404/410 は成功扱い (§8.1)
  await throwForStatus(res);
}

async function pullChanges(
  calendarId: string,
  syncToken: string | null,
  pageCursor: string | null,
  _window: { start: string; end: string } | null,
  secret: CalendarVaultSecret,
): Promise<PullPage> {
  const params = new URLSearchParams();
  params.set("maxResults", "250");
  // timeMin/timeMax は付けない (syncToken と併用不可 — §8.1)
  if (syncToken) params.set("syncToken", syncToken);
  if (pageCursor) params.set("pageToken", pageCursor);

  const res = await googleFetch(`${GOOGLE_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`, {
    method: "GET",
    accessToken: secret.access_token,
  });
  if (!res.ok) {
    if (res.status === 410) throw new GoneError("Google sync token expired (410)");
    await throwForStatus(res);
  }
  const json: unknown = await res.json();
  const parsed = zGoogleEventsListResponse.parse(json);
  return {
    changes: parsed.items.map(toExternalEventChange),
    nextPageCursor: parsed.nextPageToken ?? null,
    nextSyncToken: parsed.nextSyncToken ?? null,
  };
}

async function findByLinkId(calendarId: string, linkId: string, secret: CalendarVaultSecret): Promise<ExternalEventChange | null> {
  const params = new URLSearchParams();
  params.set("privateExtendedProperty", `kumabe_link_id=${linkId}`);
  const res = await googleFetch(`${GOOGLE_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`, {
    method: "GET",
    accessToken: secret.access_token,
  });
  if (!res.ok) await throwForStatus(res);
  const json: unknown = await res.json();
  const parsed = zGoogleEventsListResponse.parse(json);
  const found = parsed.items.find((item) => item.status !== "cancelled");
  return found ? toExternalEventChange(found) : null;
}

async function getBusy(range: { start: string; end: string }, secret: CalendarVaultSecret): Promise<Array<{ start: string; end: string }>> {
  const res = await googleFetch(`${GOOGLE_API_BASE}/freeBusy`, {
    method: "POST",
    accessToken: secret.access_token,
    body: JSON.stringify({ timeMin: range.start, timeMax: range.end, items: [{ id: "primary" }] }),
  });
  if (!res.ok) await throwForStatus(res);
  const json: unknown = await res.json();
  const parsed = zGoogleFreeBusyResponse.parse(json);
  const primary = parsed.calendars.primary;
  return (primary?.busy ?? []).map((b) => ({ start: b.start, end: b.end }));
}

async function refreshTokens(secret: CalendarVaultSecret, env: ProviderEnv): Promise<CalendarVaultSecret> {
  const body = new URLSearchParams({
    client_id: env.clientId,
    client_secret: env.clientSecret,
    grant_type: "refresh_token",
    refresh_token: secret.refresh_token,
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
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
      `Google token refresh failed (status=${res.status}): ${bodyText.slice(0, 500)}`,
      res.status,
      oauthError,
    );
  }
  const json: unknown = await res.json();
  const parsed = zGoogleTokenResponse.parse(json);
  return {
    access_token: parsed.access_token,
    // Google は refresh 応答に refresh_token が含まれないことがある (非ローテーション) →
    // その場合は既存値を維持する (§8.3 手順 3)。
    refresh_token: parsed.refresh_token ?? secret.refresh_token,
    expires_at: new Date(Date.now() + parsed.expires_in * 1000).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// OAuth 接続 (§8.2)。CalendarProviderAdapter の対象外 (push/pull ではなく接続開始時にのみ使う) —
// facade.ts の completeGoogleCalendarOAuthCallback (#54 UI 実装分) が呼ぶ。
// ---------------------------------------------------------------------------

export type GoogleAuthorizationCodeResult = {
  accessToken: string;
  refreshToken: string | null; // 応答に含まれない場合は null (呼び出し元が E720 判定)
  expiresAt: string;
  idToken: string | null;
};

/** 認可コード → トークン交換 (grant_type=authorization_code + PKCE code_verifier)。 */
export async function exchangeGoogleAuthorizationCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<GoogleAuthorizationCodeResult> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    code_verifier: input.codeVerifier,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
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
      `Google authorization code exchange failed (status=${res.status}): ${bodyText.slice(0, 500)}`,
      res.status,
      oauthError,
    );
  }
  const json: unknown = await res.json();
  const parsed = zGoogleTokenResponse.parse(json);
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token ?? null,
    expiresAt: new Date(Date.now() + parsed.expires_in * 1000).toISOString(),
    idToken: parsed.id_token ?? null,
  };
}

/**
 * id_token (JWT) の payload から email claim を取り出す。署名検証は行わない —
 * token endpoint (https://oauth2.googleapis.com/token) への直接 HTTPS 通信の応答であり、
 * Google 自身が TLS 経由で直接返した値であるため X/Meta の既存 OAuth 実装 (Google 公式 SDK 不使用・
 * 応答を直接信頼) と同水準のセキュリティレベルでよいという実装判断
 * (実装計画書「未解決点1」— オーケストレーターへ報告事項として明記)。
 * userinfo/calendarList は呼ばない (app.created スコープでは calendarList が 403 になるため — §1.4)。
 */
export function decodeGoogleIdTokenEmail(idToken: string): string | null {
  try {
    const payloadSegment = idToken.split(".")[1];
    if (!payloadSegment) return null;
    const json = Buffer.from(payloadSegment, "base64url").toString("utf-8");
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object" && "email" in parsed) {
      const email = (parsed as { email?: unknown }).email;
      return typeof email === "string" ? email : null;
    }
    return null;
  } catch {
    return null;
  }
}

export const googleCalendarAdapter: CalendarProviderAdapter = {
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
