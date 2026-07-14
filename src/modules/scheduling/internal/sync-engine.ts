// scheduling/internal/sync-engine.ts — push (§8.4) / pull (§8.5) オーケストレーション。
// canonical: docs/design/crm-suite/03-scheduling.md §8.4/§8.5 (手順を一字一句遵守すること —
// この節が受入基準 C5〜C8 の実装源泉)。
//
// #54 (Google) は provider 引数を受け取り adapter (CalendarProviderAdapter) を差し替えるだけの
// provider 非依存設計で実装済み。#55 (Microsoft) はこのファイルへ google-api.ts に無い Graph 固有の
// 挙動 (時間窓 resolveSyncWindow / Graph 安全弁 isGraphSafetyValveApplicable) だけを最小分岐で
// 追加している — google 側の分岐 (isGraphSafetyValveApplicable=false / window=null) は無変更。
//
// 【最重要地雷、優先度順】
// 1. エコー棄却の破綻: echo.ts の時刻正規化漏れ → push 直後の pull で「変更あり」と誤認 →
//    再 push → 無限ループ。finalizePushSuccess と processOneChange が echo.ts の
//    computeWrittenHash/isSelfEcho を同一の正規化で共有していることを崩さないこと。
// 2. push_claimed_at claim の欠落: after() の 60 秒打ち切り等で createEvent 成功後・link
//    更新前にプロセスが死ぬと、次回起床で二重 createEvent が走る。claim 刻印 → 再 create 前
//    findByLinkId 照合を必ず実装する (pushOneLink 参照)。
// 3. 410 フル再同期時の link 重複: 部分一意 index (provider, external_event_id) が最後の砦だが、
//    それに頼らず external_event_id/iCalUID/出所マーキングの 3 経路で先に照合する
//    (processOneChange 参照)。
// 4. orphaned 生成 (逆方向突合) の実装漏れ: 「フル再同期のラウンド完了時のみ」という条件を
//    見落とすと、通常の増分 pull のたびに大量誤 orphaned 化する重大バグになる。
// 5. カレンダー 404 とイベント 404 の混同 (P20): 区別を怠ると専用カレンダー消失時に全 links を
//    誤って deleted_externally にする (checkCalendarExists 参照)。
// 6. 削除待ちリンクの外部 API 呼び出し禁止分岐: external_event_id が NULL の削除待ち link に
//    deleteEvent(null) を呼ぶ実装ミスを避ける明示分岐が必須 (pushOneLink 参照)。
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getEnv } from "@/lib/env";

import type { CalendarConnectionMeta, CalendarProvider } from "../contracts";
import { zCalendarConnectionMeta } from "../contracts";
import * as repo from "../repository";
import type { CalendarConnectionRow, CalendarEventLinkRow, PendingPushLinkRow } from "../repository";
import { computeWrittenHash, isSelfEcho } from "./echo";
import { PULL_MAX_PAGES, PUSH_BATCH_LIMIT, PUSH_MAX_ATTEMPTS, SYNC_LEASE_TTL_MS } from "./lease";
import type { CalendarProviderAdapter, ExternalEventChange, ExternalEventInput, ProviderEnv, WriteOutcome } from "./provider";
import { AuthExpiredError, GoneError } from "./provider";
import { classifySyncError } from "./sync-error-classify";
import { canAutoRevertConflictOnPull, isAutoProcessLocked } from "./sync-state";
import { forceRefreshCalendarSecret, getValidCalendarSecret, TokenClientMisconfiguredError, TokenExpiredError } from "./token";
import type { CalendarVaultSecret } from "./vault-names";

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * provider ごとの OAuth クライアント資格情報を env から解決する。
 * facade.ts (getExternalBusy/reconcilePushUnknown 等、runPush/runPull を経由しない箇所) も
 * 同じ解決ロジックを必要とするため export する (#54 UI 実装分)。
 */
export function resolveProviderEnv(provider: CalendarProvider): ProviderEnv {
  const env = getEnv();
  if (provider === "google") {
    return { clientId: env.GOOGLE_CALENDAR_CLIENT_ID ?? "", clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET ?? "" };
  }
  // provider === "microsoft" (#55)。CalendarProvider は "google" | "microsoft" の 2 値のみ
  // (zCalendarProvider) なので網羅的。
  return { clientId: env.MS_CALENDAR_CLIENT_ID ?? "", clientSecret: env.MS_CALENDAR_CLIENT_SECRET ?? "" };
}

/**
 * pull の増分同期の起点となる時間窓を provider ごとに解決する (§8.1)。
 * Google は syncToken 単独で全量を賄えるため窓を使わない (timeMin/timeMax は syncToken と
 * 併用不可 — google-api.ts pullChanges のコメント参照)。Microsoft (Graph) の
 * calendarView/delta は時間窓が必須 (§1.4) なため、接続時に初期化した
 * meta.sync_window_start/end (今日−30日〜+180日 — §8.2) を採用する。
 * 未初期化 (旧データ・OAuth 未完了等の防御) の場合は null を返し、ms-api.ts 側が
 * 「初回同期には時間窓が必要」の例外で安全に停止する (握り潰さない)。
 */
function resolveSyncWindow(provider: CalendarProvider, meta: CalendarConnectionMeta): { start: string; end: string } | null {
  if (provider !== "microsoft") return null;
  if (!meta.sync_window_start || !meta.sync_window_end) return null;
  return {
    start: `${meta.sync_window_start}T00:00:00Z`,
    end: `${meta.sync_window_end}T00:00:00Z`,
  };
}

function isSameJstDay(isoA: string, b: Date): boolean {
  const jstOffsetMs = 9 * 60 * 60 * 1000;
  const dayA = new Date(new Date(isoA).getTime() + jstOffsetMs).toISOString().slice(0, 10);
  const dayB = new Date(b.getTime() + jstOffsetMs).toISOString().slice(0, 10);
  return dayA === dayB;
}

// ===========================================================================
// push (§8.4)
// ===========================================================================

export type RunPushResult = { pushed: number; conflicts: number };

/** 実在確認のみ (§8.4 P20)。確認自体が失敗した場合は安全側 (実在すると仮定) に倒す —
 *  専用カレンダーが実在するのに誤って全 links を deleted_externally にしないため。 */
async function checkCalendarExists(
  adapter: CalendarProviderAdapter,
  appCalendarId: string,
  secret: CalendarVaultSecret,
): Promise<boolean> {
  try {
    return await adapter.calendarExists(appCalendarId, secret);
  } catch {
    return true;
  }
}

async function finalizePushSuccess(
  serviceClient: SupabaseClient,
  link: PendingPushLinkRow,
  outcome: WriteOutcome,
  title: string,
  startsAt: string,
  endsAt: string,
): Promise<void> {
  const hash = computeWrittenHash({ startsAt, endsAt, title });
  const markResult = await repo.markLinkSynced(serviceClient, link.id, {
    external_event_id: outcome.externalEventId,
    etag_or_change_key: outcome.etagOrChangeKey,
    external_updated_at: outcome.externalUpdatedAt,
    external_ical_uid: outcome.icalUid,
    last_written_hash: hash,
  });
  if (!markResult.ok) {
    throw new Error(`push 成功後の link 更新に失敗しました: ${markResult.code} ${markResult.detail ?? ""}`);
  }
}

async function pushOneLink(
  serviceClient: SupabaseClient,
  adapter: CalendarProviderAdapter,
  appCalendarId: string,
  secret: CalendarVaultSecret,
  link: PendingPushLinkRow,
): Promise<"pushed" | "deleted"> {
  const isDeletionMark = link.block_starts_at === null || link.block_status === "cancelled";

  if (isDeletionMark) {
    if (!link.external_event_id) {
      // 一度も push されていない削除待ち → 外部 API を呼ばず行削除のみ (§8.4 明示分岐)
      const deleteResult = await repo.deleteCalendarEventLink(serviceClient, link.id);
      if (!deleteResult.ok) throw new Error(`link 削除に失敗しました: ${deleteResult.code} ${deleteResult.detail ?? ""}`);
      return "deleted";
    }
    await adapter.deleteEvent(appCalendarId, link.external_event_id, secret);
    const deleteResult = await repo.deleteCalendarEventLink(serviceClient, link.id);
    if (!deleteResult.ok) throw new Error(`link 削除に失敗しました: ${deleteResult.code} ${deleteResult.detail ?? ""}`);
    return "deleted";
  }

  const title = link.block_title ?? link.block_work_type_label;
  const startsAt = link.block_starts_at as string; // isDeletionMark=false のため非 NULL (DB check 保証)
  const endsAt = link.block_ends_at as string;
  const input: ExternalEventInput = { linkId: link.id, blockId: link.work_block_id, title, startsAt, endsAt };

  let outcome: WriteOutcome;
  if (!link.external_event_id) {
    if (link.push_claimed_at) {
      // 前回 kill 疑い (§2.3 コメント) → 再 create の前に findByLinkId で照合
      const found = await adapter.findByLinkId(appCalendarId, link.id, secret);
      if (found) {
        // 発見 → その external_event_id/etag を採用して update 経路へ (§8.4「二重イベント防止」)。
        // MAJOR 修正: found の値をそのまま synced 化すると、interrupted create からこの recovery
        // までの間に block が動かされていた場合 (placeBlock 等)、外部イベントは古い create 時点の
        // 内容のままなのに DB だけ「現在の block 内容で synced 済み」と誤って記録され、以後二度と
        // push されなくなる (外部カレンダーが黙って古いまま)。adapter.updateEvent を必ず経由して
        // 現在の block 内容 (input) を外部へ反映してから finalizePushSuccess する。
        outcome = await adapter.updateEvent(appCalendarId, found.externalEventId, input, found.etagOrChangeKey, secret);
        await finalizePushSuccess(serviceClient, link, outcome, title, startsAt, endsAt);
        return "pushed";
      }
      // 未発見 → create へ進む (claim 刻印し直し)
    }
    const claimResult = await repo.claimPushForLink(serviceClient, link.id);
    if (!claimResult.ok) throw new Error(`push claim に失敗しました: ${claimResult.code} ${claimResult.detail ?? ""}`);
    outcome = await adapter.createEvent(appCalendarId, input, secret);
  } else {
    outcome = await adapter.updateEvent(appCalendarId, link.external_event_id, input, link.etag_or_change_key, secret);
  }

  await finalizePushSuccess(serviceClient, link, outcome, title, startsAt, endsAt);
  return "pushed";
}

type PushLinkOutcome =
  | { kind: "success"; result: "pushed" | "deleted"; secret: CalendarVaultSecret }
  | { kind: "authFailed"; secret: CalendarVaultSecret }
  | { kind: "error"; err: unknown; secret: CalendarVaultSecret };

/** 401 → refresh 1 回 → 再試行 → なお 401 → connection expired (§8.4)。 */
async function pushOneLinkWithAuthRetry(
  serviceClient: SupabaseClient,
  provider: CalendarProvider,
  adapter: CalendarProviderAdapter,
  env: ProviderEnv,
  appCalendarId: string,
  secret: CalendarVaultSecret,
  link: PendingPushLinkRow,
): Promise<PushLinkOutcome> {
  try {
    const result = await pushOneLink(serviceClient, adapter, appCalendarId, secret, link);
    return { kind: "success", result, secret };
  } catch (err) {
    if (!(err instanceof AuthExpiredError)) return { kind: "error", err, secret };

    let refreshedSecret: CalendarVaultSecret;
    try {
      refreshedSecret = await forceRefreshCalendarSecret(serviceClient, provider, adapter, env);
    } catch {
      // forceRefreshCalendarSecret (token.ts) が既に connection.status を更新済み
      return { kind: "authFailed", secret };
    }

    try {
      const retryResult = await pushOneLink(serviceClient, adapter, appCalendarId, refreshedSecret, link);
      return { kind: "success", result: retryResult, secret: refreshedSecret };
    } catch (retryErr) {
      if (retryErr instanceof AuthExpiredError) {
        const updateResult = await repo.updateCalendarConnectionStatus(
          serviceClient,
          provider,
          "expired",
          "KMB-E720",
          "アクセストークンの更新後も401が続きました",
        );
        if (!updateResult.ok) {
          console.error(
            `[scheduling] pushOneLinkWithAuthRetry: connection expired 更新に失敗しました (provider=${provider}): ${updateResult.code} ${updateResult.detail ?? ""}`,
          );
        }
        return { kind: "authFailed", secret: refreshedSecret };
      }
      return { kind: "error", err: retryErr, secret: refreshedSecret };
    }
  }
}

/**
 * push (§8.4)。対象: sync_status='pending_push' の links (provider 毎、1 起床最大 20 件、
 * created_at 昇順)。provider 単位の業務エラー (E720〜E724) は connection/link に記録し、
 * この関数は例外を投げない (呼び出し元の facade.runCalendarSync が report[] に合成する)。
 * インフラ異常 (DB 読み取り自体の失敗) のみ例外を投げる (エラー握り潰し禁止)。
 */
export async function runPush(
  serviceClient: SupabaseClient,
  provider: CalendarProvider,
  adapter: CalendarProviderAdapter,
  options?: { limit?: number },
): Promise<RunPushResult> {
  const connectionResult = await repo.getCalendarConnection(serviceClient, provider);
  if (!connectionResult.ok) {
    throw new Error(`calendar_connections の読み取りに失敗しました: ${connectionResult.code} ${connectionResult.detail ?? ""}`);
  }
  const connection = connectionResult.value;
  if (!connection || connection.status !== "connected") return { pushed: 0, conflicts: 0 };

  const metaResult = zCalendarConnectionMeta.safeParse(connection.meta);
  if (!metaResult.success || !metaResult.data.app_calendar_id) {
    // connected 中は meta.app_calendar_id が非 NULL のはずの不変条件 (§5.2) 違反。一時的な
    // メタ不整合の可能性があるため connection をエラー化はせず、今回は push を諦める
    // (継続すれば push の calendar 404 分岐 (P20) が本物の消失として拾う)。
    return { pushed: 0, conflicts: 0 };
  }
  const appCalendarId = metaResult.data.app_calendar_id;

  const linksResult = await repo.listPendingPushLinks(serviceClient, provider, options?.limit ?? PUSH_BATCH_LIMIT);
  if (!linksResult.ok) {
    throw new Error(`pending_push links の読み取りに失敗しました: ${linksResult.code} ${linksResult.detail ?? ""}`);
  }
  const links = linksResult.value;
  if (links.length === 0) return { pushed: 0, conflicts: 0 };

  const env = resolveProviderEnv(provider);
  let secret: CalendarVaultSecret;
  try {
    secret = await getValidCalendarSecret(serviceClient, provider, adapter, env);
  } catch (err) {
    if (err instanceof TokenExpiredError || err instanceof TokenClientMisconfiguredError) {
      // token.ts が既に connection.status を更新済み (地雷: 二重にエラー処理しない)
      return { pushed: 0, conflicts: 0 };
    }
    throw err;
  }

  let pushed = 0;
  let conflicts = 0;

  for (const link of links) {
    const outcome = await pushOneLinkWithAuthRetry(serviceClient, provider, adapter, env, appCalendarId, secret, link);
    secret = outcome.secret;

    if (outcome.kind === "success") {
      if (outcome.result === "pushed") pushed++;
      continue;
    }
    if (outcome.kind === "authFailed") {
      break; // この provider の残り links はスキップ (§8.4)
    }

    const classification = classifySyncError(outcome.err);
    if (classification.kind === "not_found") {
      const calendarStillExists = await checkCalendarExists(adapter, appCalendarId, secret);
      if (!calendarStillExists) {
        const updateResult = await repo.updateCalendarConnectionStatus(
          serviceClient,
          provider,
          "error",
          "KMB-E723",
          "アプリ専用カレンダーが見つかりません",
        );
        if (!updateResult.ok) {
          console.error(`[scheduling] runPush: connection error 更新に失敗しました: ${updateResult.code} ${updateResult.detail ?? ""}`);
        }
        break; // P20: カレンダー 404 → この provider の残り links はスキップ
      }
      const markResult = await repo.markLinkDeletedExternally(serviceClient, link.id);
      if (!markResult.ok) {
        console.error(`[scheduling] runPush: markLinkDeletedExternally 失敗 (link=${link.id}): ${markResult.code} ${markResult.detail ?? ""}`);
      }
      continue;
    }
    if (classification.kind === "conflict") {
      const markResult = await repo.markLinkConflict(serviceClient, link.id, "KMB-E721");
      if (!markResult.ok) {
        console.error(`[scheduling] runPush: markLinkConflict(E721) 失敗 (link=${link.id}): ${markResult.code} ${markResult.detail ?? ""}`);
      }
      conflicts++;
      continue;
    }
    if (classification.kind === "confirmed_error") {
      const nextAttempts = link.push_attempts + 1;
      const becameConflict = nextAttempts >= PUSH_MAX_ATTEMPTS;
      const recordResult = await repo.recordPushAttemptFailure(serviceClient, link.id, nextAttempts, becameConflict);
      if (!recordResult.ok) {
        console.error(`[scheduling] runPush: recordPushAttemptFailure 失敗 (link=${link.id}): ${recordResult.code} ${recordResult.detail ?? ""}`);
      }
      if (becameConflict) conflicts++;
      continue;
    }
    // classification.kind === "unknown" (timeout/ネットワーク断) → 結果不明。KMB-E724。自動再開禁止
    const markResult = await repo.markLinkConflict(serviceClient, link.id, "KMB-E724");
    if (!markResult.ok) {
      console.error(`[scheduling] runPush: markLinkConflict(E724) 失敗 (link=${link.id}): ${markResult.code} ${markResult.detail ?? ""} (err=${errMessage(outcome.err)})`);
    }
    conflicts++;
  }

  if (pushed > 0) {
    const touchResult = await repo.touchCalendarConnectionAfterPush(serviceClient, provider);
    if (!touchResult.ok) {
      console.error(`[scheduling] runPush: touchCalendarConnectionAfterPush 失敗: ${touchResult.code} ${touchResult.detail ?? ""}`);
    }
  }

  return { pushed, conflicts };
}

// ===========================================================================
// pull (§8.5)
// ===========================================================================

export type RunPullResult = {
  pulled: number;
  echoes_rejected: number;
  full_resync: boolean;
  skipped_running: boolean;
};

type ChangeResult = "pulled" | "echo" | "skipped";

/** P15: 変更元以外の接続済み provider の link を pending_push 化する。この Issue は Google の
 *  みが接続対象のため実質 no-op だが、#55 (Microsoft) が有効化するだけで済むよう provider を
 *  ループする形にしておく (実装計画書の指示)。 */
async function propagateTimeChangeToOtherProviders(
  serviceClient: SupabaseClient,
  workBlockId: string,
  sourceProvider: CalendarProvider,
): Promise<void> {
  const allProviders: CalendarProvider[] = ["google", "microsoft"];
  for (const otherProvider of allProviders) {
    if (otherProvider === sourceProvider) continue;
    const otherLinkResult = await repo.getCalendarEventLink(serviceClient, workBlockId, otherProvider);
    if (!otherLinkResult.ok || !otherLinkResult.value) continue; // 未接続/未リンクなら何もしない
    if (isAutoProcessLocked(otherLinkResult.value)) continue; // E724 は自動処理しない (§5.3 不変条件3)
    const markResult = await repo.markLinkPendingPush(serviceClient, otherLinkResult.value.id);
    if (!markResult.ok) {
      console.error(
        `[scheduling] runPull: P15 pending_push 伝播に失敗しました (block=${workBlockId}, provider=${otherProvider}): ${markResult.code} ${markResult.detail ?? ""}`,
      );
    }
  }
}

async function resolveLinkForChange(
  serviceClient: SupabaseClient,
  provider: CalendarProvider,
  adapter: CalendarProviderAdapter,
  appCalendarId: string,
  secret: CalendarVaultSecret,
  change: ExternalEventChange,
): Promise<CalendarEventLinkRow | "duplicate_cleaned" | null> {
  const byExternalId = await repo.findLinkByExternalEventId(serviceClient, provider, change.externalEventId);
  if (!byExternalId.ok) {
    throw new Error(`link 解決 (external_event_id) に失敗しました: ${byExternalId.code} ${byExternalId.detail ?? ""}`);
  }
  if (byExternalId.value) return byExternalId.value;

  if (change.icalUid) {
    const byIcalUid = await repo.findLinkByIcalUid(serviceClient, provider, change.icalUid);
    if (!byIcalUid.ok) {
      throw new Error(`link 解決 (ical_uid) に失敗しました: ${byIcalUid.code} ${byIcalUid.detail ?? ""}`);
    }
    if (byIcalUid.value) return byIcalUid.value;
  }

  if (change.appLinkId) {
    const byAppLinkId = await repo.getCalendarEventLinkById(serviceClient, change.appLinkId);
    if (!byAppLinkId.ok) {
      throw new Error(`link 解決 (appLinkId) に失敗しました: ${byAppLinkId.code} ${byAppLinkId.detail ?? ""}`);
    }
    if (byAppLinkId.value) {
      if (byAppLinkId.value.external_event_id && byAppLinkId.value.external_event_id !== change.externalEventId) {
        // link は既に別の external_event_id を持つ (kill 後再 create 等の重複)。link の既存 id を
        // 正とし、change 側のイベントを削除する (§8.5 重複掃除)。
        if (!change.removed) {
          try {
            await adapter.deleteEvent(appCalendarId, change.externalEventId, secret);
          } catch (err) {
            console.error(`[scheduling] runPull: 重複イベントの削除に失敗しました (event=${change.externalEventId}): ${errMessage(err)}`);
          }
        }
        return "duplicate_cleaned";
      }
      return byAppLinkId.value;
    }
  }

  return null;
}

async function processOneChange(
  serviceClient: SupabaseClient,
  provider: CalendarProvider,
  adapter: CalendarProviderAdapter,
  appCalendarId: string,
  secret: CalendarVaultSecret,
  change: ExternalEventChange,
): Promise<ChangeResult> {
  const resolved = await resolveLinkForChange(serviceClient, provider, adapter, appCalendarId, secret, change);
  if (resolved === "duplicate_cleaned") return "skipped";

  const link = resolved;
  if (!link) {
    // link 未解決: kumabe_origin='app' かつ appBlockId が実在の配置済みブロックを指し、
    // (block, provider) に link が無い場合は link を再構築する (disconnect→再接続後の
    // 二重イベント防止 — §8.5/§6.2)。それ以外は生イベント (P19): skip
    if (!change.removed && change.appBlockId) {
      const existingLink = await repo.getCalendarEventLink(serviceClient, change.appBlockId, provider);
      if (existingLink.ok && !existingLink.value) {
        const insertResult = await repo.insertReconstructedLink(serviceClient, {
          work_block_id: change.appBlockId,
          provider,
          external_event_id: change.externalEventId,
          etag_or_change_key: change.etagOrChangeKey,
          external_updated_at: change.externalUpdatedAt,
          external_ical_uid: change.icalUid,
        });
        if (!insertResult.ok) {
          console.error(
            `[scheduling] runPull: link 再構築に失敗しました (block=${change.appBlockId}): ${insertResult.code} ${insertResult.detail ?? ""}`,
          );
          return "skipped";
        }
        return "pulled";
      }
    }
    return "skipped"; // P19: アプリ管理外の手作りイベント
  }

  // 自己エコー判定 (§8.6)
  if (
    isSelfEcho(
      {
        etagOrChangeKey: change.etagOrChangeKey,
        externalUpdatedAt: change.externalUpdatedAt,
        startsAt: change.startsAt,
        endsAt: change.endsAt,
        title: change.title,
      },
      link,
    )
  ) {
    return "echo";
  }

  if (change.removed) {
    const markResult = await repo.markLinkDeletedExternally(serviceClient, link.id);
    if (!markResult.ok) {
      console.error(`[scheduling] runPull: markLinkDeletedExternally 失敗 (link=${link.id}): ${markResult.code} ${markResult.detail ?? ""}`);
    }
    return "pulled";
  }

  if (change.isAllDay) {
    // P31: 時刻としては取り込まない。block 不変のまま pending_push 化し、次回 push で
    // アプリの時刻付きイベントを再送して復元する。
    const applyResult = await repo.applyPullObservedFields(serviceClient, link.id, {
      etag_or_change_key: change.etagOrChangeKey,
      external_updated_at: change.externalUpdatedAt,
      external_ical_uid: change.icalUid,
      sync_status: "pending_push",
    });
    if (!applyResult.ok) {
      console.error(`[scheduling] runPull: isAllDay pending_push 化に失敗しました (link=${link.id}): ${applyResult.code} ${applyResult.detail ?? ""}`);
    }
    return "pulled";
  }

  // 時刻変更かどうかは実際の starts_at/ends_at を比較して判定する (external_updated_at の
  // 差分だけでは判定しない — Google はタイトルのみの編集でも updated を進めるため、
  // external_updated_at 差分を time change の判定に使うとタイトルのみ変更 (P18) を
  // 誤って時刻変更として扱ってしまう)。
  const currentTimesResult = await repo.getWorkBlockTimes(serviceClient, link.work_block_id);
  if (!currentTimesResult.ok) {
    throw new Error(`work_blocks の現在時刻取得に失敗しました (block=${link.work_block_id}): ${currentTimesResult.code} ${currentTimesResult.detail ?? ""}`);
  }
  const currentTimes = currentTimesResult.value;
  // エポック ms で比較する (Postgres timestamptz の文字列表記 "+00:00" と
  // toISOString() の "Z" など、同一時刻でも表記が揺れるため文字列そのままの比較はしない —
  // echo.ts の computeWrittenHash と同じ正規化方針)。
  const timeChanged =
    change.startsAt !== null &&
    change.endsAt !== null &&
    currentTimes !== null &&
    currentTimes.starts_at !== null &&
    currentTimes.ends_at !== null &&
    (new Date(currentTimes.starts_at).getTime() !== new Date(change.startsAt).getTime() ||
      new Date(currentTimes.ends_at).getTime() !== new Date(change.endsAt).getTime());

  if (timeChanged) {
    // フィールド所有権原則: 時刻・存在は外部の直近操作が正 (§8.5)
    const blockUpdateResult = await repo.updateWorkBlockExternalTimeChange(
      serviceClient,
      link.work_block_id,
      change.startsAt as string,
      change.endsAt as string,
    );
    if (!blockUpdateResult.ok) {
      console.error(
        `[scheduling] runPull: work_blocks 時刻更新に失敗しました (block=${link.work_block_id}): ${blockUpdateResult.code} ${blockUpdateResult.detail ?? ""}`,
      );
    }

    // conflict+E721 だった場合のみ自動で pending_push に戻す (E723/E724 は admin 操作のみ —
    // §5.3 不変条件3 の解釈を E721 以外へ拡張しない。internal/sync-state.ts 参照)。
    const revertToPendingPush = canAutoRevertConflictOnPull(link);
    const applyResult = await repo.applyPullObservedFields(serviceClient, link.id, {
      etag_or_change_key: change.etagOrChangeKey,
      external_updated_at: change.externalUpdatedAt,
      external_ical_uid: change.icalUid,
      sync_status: revertToPendingPush ? "pending_push" : link.sync_status === "synced" ? "synced" : undefined,
    });
    if (!applyResult.ok) {
      console.error(`[scheduling] runPull: link 更新 (時刻変更) に失敗しました (link=${link.id}): ${applyResult.code} ${applyResult.detail ?? ""}`);
    }

    await propagateTimeChangeToOtherProviders(serviceClient, link.work_block_id, provider);
    return "pulled";
  }

  // タイトルのみ変更 (P18): 内容はアプリが正。etag 類だけ記録し block/sync_status は不変
  const applyResult = await repo.applyPullObservedFields(serviceClient, link.id, {
    etag_or_change_key: change.etagOrChangeKey,
    external_updated_at: change.externalUpdatedAt,
    external_ical_uid: change.icalUid,
  });
  if (!applyResult.ok) {
    console.error(`[scheduling] runPull: link 更新 (etag のみ) に失敗しました (link=${link.id}): ${applyResult.code} ${applyResult.detail ?? ""}`);
  }
  return "pulled";
}

/** フル再同期の逆方向突合用スナップショットを読み込む (§8.5)。external_event_id → link.id。 */
async function loadResyncSnapshot(serviceClient: SupabaseClient, provider: CalendarProvider): Promise<Map<string, string>> {
  const snapshotResult = await repo.listLinksWithExternalEventId(serviceClient, provider);
  if (!snapshotResult.ok) {
    throw new Error(`フル再同期スナップショットの取得に失敗しました: ${snapshotResult.code} ${snapshotResult.detail ?? ""}`);
  }
  return new Map(snapshotResult.value.map((l) => [l.external_event_id, l.id]));
}

async function runPullLoop(
  serviceClient: SupabaseClient,
  provider: CalendarProvider,
  adapter: CalendarProviderAdapter,
  connection: CalendarConnectionRow,
  appCalendarId: string,
  window: { start: string; end: string } | null,
  initialSecret: CalendarVaultSecret,
  maxPages: number,
): Promise<RunPullResult> {
  let secret = initialSecret;
  let token = connection.sync_token;
  let cursor = connection.sync_page_cursor;
  let fullResyncTriggered = token === null;

  // フル再同期の逆方向突合用スナップショット (§8.5 地雷4: ラウンド完了時のみ使う)
  let snapshotLinkIds: Map<string, string> | null = null; // external_event_id -> link.id
  const observedExternalEventIds = new Set<string>();

  if (fullResyncTriggered) snapshotLinkIds = await loadResyncSnapshot(serviceClient, provider);

  let pulled = 0;
  let echoesRejected = 0;
  let roundCompleted = false;
  let lastError: { code: string; detail: string } | null = null;

  // Graph 安全弁 (P22/§8.5)。「同一 skiptoken が2回連続」or「ページ上限に達してもラウンド未完了」
  // を無限ページングの兆候とみなし KMB-E725 で中断する。Google の syncToken 方式にはこの種の
  // 既知バグ報告がない (§8.1 注記「Google 実装は E725 を発火させない」) ため、provider==="microsoft"
  // のみに限定するガードで Google 側の挙動を一切変えない (上位指示の「最小限の分岐追加」)。
  const isGraphSafetyValveApplicable = provider === "microsoft";
  let previousPageCursor: string | null = null;
  let pagesConsumed = 0;
  let graphSafetyValveTriggered = false;

  for (let page = 0; page < maxPages; page++) {
    let pullPage;
    try {
      pullPage = await adapter.pullChanges(appCalendarId, token, cursor, window, secret);
    } catch (err) {
      if (err instanceof GoneError) {
        // 410 → KMB-E722: token/cursor を NULL 化しフル再同期を即時開始 (links は保持)
        token = null;
        cursor = null;
        fullResyncTriggered = true;
        // ページ系列が仕切り直しになるため、直前ラウンドの nextPageCursor との比較 (Graph 安全弁) も
        // リセットする — 旧系列の cursor と新系列の cursor がたまたま一致して誤検知しないように。
        previousPageCursor = null;
        if (!snapshotLinkIds) snapshotLinkIds = await loadResyncSnapshot(serviceClient, provider);
        lastError = { code: "KMB-E722", detail: "sync token expired (410)。フル再同期を実行しました" };
        continue;
      }
      if (err instanceof AuthExpiredError) {
        try {
          secret = await forceRefreshCalendarSecret(serviceClient, provider, adapter, resolveProviderEnv(provider));
          continue; // 同じページを新トークンで再試行
        } catch {
          break; // token.ts が既に connection.status を更新済み
        }
      }
      // その他の確定エラー/結果不明は今回の pull を打ち切り、次回起床に委ねる
      // (cursor/token は変更しない — 部分的な破棄をしない)。
      console.error(`[scheduling] runPull: pullChanges に失敗しました (provider=${provider}): ${errMessage(err)}`);
      break;
    }

    pagesConsumed++;

    if (isGraphSafetyValveApplicable && pullPage.nextPageCursor !== null && pullPage.nextPageCursor === previousPageCursor) {
      // 同一 skiptoken (nextLink) が2回連続で返った → サーバ側の無限ページングバグの疑い (P22)
      graphSafetyValveTriggered = true;
      break;
    }
    previousPageCursor = pullPage.nextPageCursor;

    for (const change of pullPage.changes) {
      observedExternalEventIds.add(change.externalEventId);
      const result = await processOneChange(serviceClient, provider, adapter, appCalendarId, secret, change);
      if (result === "pulled") pulled++;
      if (result === "echo") echoesRejected++;
    }

    if (pullPage.nextSyncToken) {
      token = pullPage.nextSyncToken;
      cursor = null;
      roundCompleted = true;
      break;
    }
    if (pullPage.nextPageCursor) {
      cursor = pullPage.nextPageCursor;
      continue;
    }
    // ページも継続トークンも無い = このラウンドは実質完了 (Google は nextSyncToken が最終ページ
    // のみ付くため通常はここに到達しない防御分岐)
    roundCompleted = true;
    break;
  }

  // P22 後段判定: Graph で maxPages を使い切ってもラウンドが完了しなかった場合を「20 ページ超過」
  // として安全弁を発動する。Google の「途中終了 → sync_page_cursor 保存 → 次起床で継続」という
  // 通常の部分同期と明確に区別する (§8.5 本文が Graph に限定してこの扱いを指示している —
  // Google はこの分岐に達しても isGraphSafetyValveApplicable=false のため何も起きない)。
  if (isGraphSafetyValveApplicable && !roundCompleted && !graphSafetyValveTriggered && pagesConsumed >= maxPages) {
    graphSafetyValveTriggered = true;
  }

  if (graphSafetyValveTriggered) {
    // cursor と sync_token (deltaLink) を両方破棄 + 中断 (§8.5)。runPull 先頭の同一 JST 日内
    // スキップにより毎 5 分の無駄打ちは防げるため、この時点ではデータ損失や無限ループそのものは
    // 発生しない (安全側)。復旧 (実際に同期が再開すること) は日次 maintenance の窓切り直し
    // (facade.ts runCalendarMaintenanceTasks task2 — last_error_code='KMB-E725' を発火条件として
    // 窓を切り直し、sync_token=null により次回 runPull を fullResyncTriggered 経路へ乗せ、
    // last_error_code をクリアする) が担う。
    token = null;
    cursor = null;
    lastError = {
      code: "KMB-E725",
      detail: "Graph delta ページングで無限ループの疑いを検知したため中断しました (skiptoken 再来 or ページ上限超過)",
    };
  }

  let fullResyncCompleted = false;
  if (roundCompleted && fullResyncTriggered && snapshotLinkIds) {
    const orphanedLinkIds = [...snapshotLinkIds.entries()]
      .filter(([externalEventId]) => !observedExternalEventIds.has(externalEventId))
      .map(([, linkId]) => linkId);
    const markResult = await repo.markLinksOrphaned(serviceClient, orphanedLinkIds);
    if (!markResult.ok) {
      console.error(`[scheduling] runPull: markLinksOrphaned に失敗しました: ${markResult.code} ${markResult.detail ?? ""}`);
    }
    fullResyncCompleted = true;
  }

  const updateResult = await repo.updateCalendarConnectionAfterPull(serviceClient, provider, {
    sync_token: token,
    sync_page_cursor: roundCompleted ? null : cursor,
    ...(fullResyncCompleted ? { last_full_resync_at: new Date().toISOString() } : {}),
    ...(lastError ? { last_error_code: lastError.code, last_error_detail: lastError.detail } : {}),
  });
  if (!updateResult.ok) {
    console.error(`[scheduling] runPull: connection cursor 更新に失敗しました: ${updateResult.code} ${updateResult.detail ?? ""}`);
  }

  return { pulled, echoes_rejected: echoesRejected, full_resync: fullResyncTriggered, skipped_running: false };
}

/**
 * pull (§8.5)。connection ごと (status='connected' のみ)。sync リース (TTL 90 秒) を取得できた
 * ときのみ実行し、finally で必ず解放する。
 */
export async function runPull(
  serviceClient: SupabaseClient,
  provider: CalendarProvider,
  adapter: CalendarProviderAdapter,
  options?: { maxPages?: number },
): Promise<RunPullResult> {
  const connectionResult = await repo.getCalendarConnection(serviceClient, provider);
  if (!connectionResult.ok) {
    throw new Error(`calendar_connections の読み取りに失敗しました: ${connectionResult.code} ${connectionResult.detail ?? ""}`);
  }
  const connection = connectionResult.value;
  if (!connection || connection.status !== "connected") {
    return { pulled: 0, echoes_rejected: 0, full_resync: false, skipped_running: false };
  }

  const metaResult = zCalendarConnectionMeta.safeParse(connection.meta);
  if (!metaResult.success || !metaResult.data.app_calendar_id) {
    return { pulled: 0, echoes_rejected: 0, full_resync: false, skipped_running: false };
  }
  const appCalendarId = metaResult.data.app_calendar_id;
  const window = resolveSyncWindow(provider, metaResult.data);

  // KMB-E725 安全弁のバックオフ: 同一 JST 日内は当該 provider の pull を skip (§8.5)。
  // Google は E725 を発火させない (runPullLoop の isGraphSafetyValveApplicable ガード —
  // provider==="microsoft" 限定) が、この skip 判定自体は provider 非依存のまま置いておいて安全
  // (google 側は last_error_code='KMB-E725' に到達しないため実質 no-op)。
  if (connection.last_error_code === "KMB-E725" && isSameJstDay(connection.updated_at, new Date())) {
    return { pulled: 0, echoes_rejected: 0, full_resync: false, skipped_running: false };
  }

  const leaseResult = await repo.claimCalendarSyncLease(serviceClient, provider, SYNC_LEASE_TTL_MS);
  if (!leaseResult.ok) {
    throw new Error(`sync lease の取得に失敗しました: ${leaseResult.code} ${leaseResult.detail ?? ""}`);
  }
  if (!leaseResult.value) {
    return { pulled: 0, echoes_rejected: 0, full_resync: false, skipped_running: true };
  }

  try {
    const env = resolveProviderEnv(provider);
    let secret: CalendarVaultSecret;
    try {
      secret = await getValidCalendarSecret(serviceClient, provider, adapter, env);
    } catch (err) {
      if (err instanceof TokenExpiredError || err instanceof TokenClientMisconfiguredError) {
        return { pulled: 0, echoes_rejected: 0, full_resync: false, skipped_running: false };
      }
      throw err;
    }
    return await runPullLoop(serviceClient, provider, adapter, connection, appCalendarId, window, secret, options?.maxPages ?? PULL_MAX_PAGES);
  } finally {
    const releaseResult = await repo.releaseCalendarSyncLease(serviceClient, provider);
    if (!releaseResult.ok) {
      console.error(
        `[scheduling] runPull: sync lease の解放に失敗しました (provider=${provider}): ${releaseResult.code} ${releaseResult.detail ?? ""}`,
      );
    }
  }
}
