// scheduling/internal/provider.ts — google/microsoft の共通抽象 (契約は internal に閉じる)
// canonical: docs/design/crm-suite/03-scheduling.md §8.1 (interface 定義)。
//
// この Issue (#54) で確定させる契約。#55 (Microsoft 実装) がそのまま使う前提のため、
// 既存メンバーのシグネチャは変えない (実装計画書の指示)。ただし canonical §8.1 の型定義には
// 2 点の実装上のギャップがあり、この Issue の範囲でシグネチャを「安全側に補完」した
// (メンバー追加のみ・既存メンバーの型は変更していないため #55 への破壊的変更にはならない):
//
// 1. `ExternalEventInput` に `blockId` を追加した。canonical §8.1 の型定義本体には無いが、
//    同じ §8.1 の一覧表 (作成行) は「extendedProperties.private = { kumabe_link_id,
//    kumabe_block_id, kumabe_origin: 'app' }」を要求しており、kumabe_block_id (再接続後の
//    link 再構築キー — §8.5) を書き込むには入力型に blockId が必要。linkId だけでは
//    表の要求を満たせないため、契約内の矛盾を実装可能な形に解消した
//    (オーケストレーターへ報告済み — plan の未解決点扱いではなく実装時の契約補完)。
// 2. `CalendarProviderAdapter` に `calendarExists` を追加した。push の 404 分岐 (P20:
//    カレンダー 404 とイベント 404 の区別) は「実在確認のみ (作成しない)」操作を必要とするが、
//    既存の `ensureAppCalendar` は「実在検証 → 無ければ作成」であり、これを push のエラー
//    ハンドリングから呼ぶと専用カレンダー消失時に admin の同意なく新しいカレンダーを
//    自動作成してしまう (§5.2/§8.8 が想定する「admin の『作り直す』操作」を迂回する
//    重大なデータ影響 — 旧カレンダーのイベントが黙って見えなくなる)。副作用のない
//    実在確認専用メソッドを追加してこれを避けた。
import type { CalendarVaultSecret } from "./vault-names";

export type ExternalEventInput = {
  linkId: string;              // 出所マーキング (Google: extendedProperties / MS: transactionId)
  blockId: string;             // 出所マーキング (Google: kumabe_block_id — 再接続後の link 再構築キー §8.5)
  title: string;
  startsAt: string;            // ISO (UTC)。書込時に Asia/Tokyo 表記へ変換
  endsAt: string;
};

export type ExternalEventChange = {
  externalEventId: string;
  etagOrChangeKey: string | null;
  icalUid: string | null;
  externalUpdatedAt: string | null;
  title: string | null;
  startsAt: string | null;     // removed=true / isAllDay=true のとき null
  endsAt: string | null;
  removed: boolean;            // Google: status='cancelled' / Graph: @removed
  isAllDay: boolean;           // 終日化検知 (Google: start.date のみ / Graph: isAllDay=true) — P31。
                               // 時刻としては取り込まず §8.5 が pending_push 化して再送復元
  appLinkId: string | null;    // 出所マーキングから復元できた場合 (Google のみ確実)
  appBlockId: string | null;   // kumabe_block_id (Google のみ)。再接続後の link 再構築用 (§8.5)
};

export type PullPage = {
  changes: ExternalEventChange[];
  nextPageCursor: string | null;   // 継続あり
  nextSyncToken: string | null;    // ラウンド完了 (最終ページのみ)
};

export type WriteOutcome = {
  externalEventId: string;
  etagOrChangeKey: string | null;
  externalUpdatedAt: string | null;
  icalUid: string | null;
};

/** refreshTokens に渡す OAuth クライアント資格情報。provider ごとに env から解決する
 *  (google: GOOGLE_CALENDAR_CLIENT_ID/SECRET。#55 が microsoft 分の解決を追加する)。 */
export type ProviderEnv = {
  clientId: string;
  clientSecret: string;
};

/** HTTP 応答を受信できた「確定エラー」の基底 (distribution/internal/publish-error-classify.ts の
 *  ConfirmedApiError と同型パターン)。fetch 例外 (timeout/断) はこれらを介さずそのまま throw され、
 *  sync-error-classify.ts が結果不明 (KMB-E724) に分類する。 */
export class ConfirmedApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ConfirmedApiError";
  }
}

/** 410 Gone (pull の sync token/deltaLink 失効。§8.5 KMB-E722 の発生源) */
export class GoneError extends ConfirmedApiError {
  constructor(message: string) {
    super(message, 410);
    this.name = "GoneError";
  }
}

/** 401 Unauthorized (アクセストークン失効。push/pull 双方で 1 回だけ refresh → 再試行の対象) */
export class AuthExpiredError extends ConfirmedApiError {
  constructor(message: string, status = 401) {
    super(message, status);
    this.name = "AuthExpiredError";
  }
}

/** 412 Precondition Failed / 409 Conflict (updateEvent の If-Match 不一致。§8.4 KMB-E721) */
export class ConflictError extends ConfirmedApiError {
  constructor(message: string, status = 412) {
    super(message, status);
    this.name = "ConflictError";
  }
}

/**
 * OAuth token endpoint (refreshTokens) の確定エラー。応答 JSON の `error` フィールド
 * (invalid_grant / invalid_client 等) を保持し、token.ts が §8.3 手順 5/6 の分岐
 * (invalid_grant → expired+E720 / invalid_client → error+E723) に使う。
 * 応答が JSON でパースできない、または `error` フィールドが無い場合は oauthError=null
 * (token.ts は status のみで安全側に倒す)。
 */
export class OAuthTokenError extends ConfirmedApiError {
  constructor(
    message: string,
    status: number,
    public readonly oauthError: string | null,
  ) {
    super(message, status);
    this.name = "OAuthTokenError";
  }
}

/**
 * provider 抽象 (google/microsoft の共通契約)。実装は internal/google-api.ts (#54) /
 * internal/ms-api.ts (#55)。
 *
 * 例外規約: HTTP 応答を受信できた確定エラーは上記の型付き例外 (status 保持)。
 * fetch 例外 (timeout/断) はそのまま throw → sync-engine が結果不明 (KMB-E724) に分類する。
 */
export interface CalendarProviderAdapter {
  ensureAppCalendar(secret: CalendarVaultSecret, knownCalendarId: string | null): Promise<string>;
    // 保存済み id を calendars.get / GET /me/calendars/{id} で実在検証 → 404/未保存なら新規作成。
    // calendarList 系 API は呼ばない (app.created スコープで呼べない — §1.4)
  /** knownCalendarId の実在確認のみ (作成しない)。§8.4 の 404 分岐 (カレンダー404 vs イベント404) 専用
   *  (このメソッドを追加した理由は本ファイル冒頭のコメント 2 を参照)。 */
  calendarExists(calendarId: string, secret: CalendarVaultSecret): Promise<boolean>;
  createEvent(calendarId: string, input: ExternalEventInput, secret: CalendarVaultSecret): Promise<WriteOutcome>;
  updateEvent(calendarId: string, externalEventId: string, input: ExternalEventInput,
              ifMatch: string | null, secret: CalendarVaultSecret): Promise<WriteOutcome>; // 412/409 → ConflictError
  deleteEvent(calendarId: string, externalEventId: string, secret: CalendarVaultSecret): Promise<void>; // 404/410 は成功扱い
  pullChanges(calendarId: string, syncToken: string | null, pageCursor: string | null,
              window: { start: string; end: string } | null, secret: CalendarVaultSecret): Promise<PullPage>;
  findByLinkId(calendarId: string, linkId: string, secret: CalendarVaultSecret):
    Promise<ExternalEventChange | null>;  // E724 照合用 (Google: privateExtendedProperty 検索 /
                                          // MS: null 固定 — transactionId 再送で代替 §8.7)
  getBusy(range: { start: string; end: string }, secret: CalendarVaultSecret): Promise<Array<{ start: string; end: string }>>;
  refreshTokens(secret: CalendarVaultSecret, env: ProviderEnv): Promise<CalendarVaultSecret>;
    // MSA: 応答の refresh_token を必ず新 secret に反映 (呼び出し側が Vault 上書き)
}
