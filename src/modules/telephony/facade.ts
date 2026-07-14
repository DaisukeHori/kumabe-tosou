import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getEnv, isTelephonyConfigured } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getSessionAndClient } from "@/lib/supabase/session";
import { crmFacade } from "@/modules/crm/facade";
import type { ExecutionContext, Paged, Result } from "@/modules/platform/contracts";
import { normalizeJpPhoneToE164 } from "@/modules/platform/text";
import { platformFacade } from "@/modules/platform/facade";
import { settingsFacade } from "@/modules/settings/facade";

import type {
  CallAnalysis,
  CallDetail,
  CallHandling,
  CallJobStatus,
  CallListItem,
  CallListItemView,
  CallRecordingSource,
  DialResultWebhook,
  InboundCallWebhook,
  RecordingWebhook,
} from "./contracts";
import { isWithinBusinessHours } from "./internal/business-hours";
import { estimateTwilioCostMicroUsd } from "./internal/cost";
import { formatDuration } from "./internal/prompts";
import { DEFAULT_TELEPHONY_SETTINGS, type TelephonySettings } from "./internal/settings-defaults";
import {
  buildAfterHoursTwiml,
  buildForwardTwiml,
  buildHangupTwiml,
  buildRecordedAckTwiml,
  buildVoicemailTwiml,
} from "./internal/twiml";
import {
  advanceCallJob as advanceCallJobStage,
  CALL_AUDIO_BUCKET,
  runTelephonyJobBatch,
} from "./internal/worker";
import {
  type CallListRow,
  type CallRow,
  type CallStatusCallbackPatch,
  countAmbiguousCalls,
  countFailedCallJobs,
  countStaleCallJobs,
  findCallByCallSid,
  getCallById,
  getCallRecordingById,
  insertCallJobIdempotent,
  insertRecordingOnConflictDoNothing,
  linkCallToCustomerRow,
  listCallJobsByCallId,
  listCallRecordingsByCallId,
  listCallsPage,
  retryCallJobRpc,
  updateCallHandling,
  updateCallMemo,
  updateCallOnStatusCallback,
  upsertCallOnConflictDoNothing,
} from "./repository";

/**
 * POST /api/jobs/telephony (§7.3) の after() から呼ばれる batch runner。distribution
 * (`runPublishWorkerBatch`) と同じ理由で facade から re-export する — route.ts は
 * module-contracts.md §2 の ESLint 境界により telephony/internal・telephony/repository を
 * 直 import できないため、facade 経由でのみ到達できる。
 */
export { runTelephonyJobBatch };

/**
 * telephony モジュールの公開 facade (契約書 §D8 / docs/design/crm-suite/04-telephony.md §7.1〜§7.2)。
 *
 * #56 (surface — 着信 webhook route + facade) の実装範囲: handleInboundCall /
 * handleCallStatus / registerRecording (D8 契約メソッド) + handleDialResult /
 * handleRecorded (契約外拡張 — §7.2、?step=dial_result / ?step=recorded から呼ばれる)。
 * #57 で advanceCallJob / retryCallJob を実装した (lease/commit/retry の制御フローのみ —
 * 4 ステージの実処理は internal/worker.ts の STAGE_HANDLERS 経由で #58 が担う)。
 * #59 (本 Issue) で createRecordingPlaybackUrl を実装 (#57/#58 まではスタブ) し、
 * 管理画面向けの契約外拡張 5 メソッド (listCalls/getCallDetail/linkCallToCustomer/
 * getTelephonySetupStatus/getCallAlertCounts — 04-telephony.md §7.2) を型宣言ごと新規に追加した。
 * 加えて saveCallMemo (§8.2-8 メモ欄) を追加 — canonical §7.4 の Server Actions 表に記載漏れが
 * あるが、計画書 issue-59.md 未解決点#2 の判断により安全側 (機能を欠落させない) で実装する。
 *
 * handleInboundCall/handleCallStatus/registerRecording/advanceCallJob は ctx: ExecutionContext
 * を必須で受け取る (D8 のシグネチャ通り ctx? ではない — webhook route は anon 起点のため常に
 * { mode: 'service' } で呼ぶ)。retryCallJob / createRecordingPlaybackUrl / 契約外拡張 5 メソッドは
 * いずれも D8 どおり ctx を取らない (admin セッション専用 — 内部で requireAdminClient() を使う)。
 */
export interface TelephonyFacade {
  handleInboundCall(input: InboundCallWebhook, ctx: ExecutionContext): Promise<Result<{ twiml: string }>>;
  handleCallStatus(
    input: { CallSid: string; CallStatus: string; CallDuration: number | null },
    ctx: ExecutionContext,
  ): Promise<Result<void>>;
  registerRecording(input: RecordingWebhook, ctx: ExecutionContext): Promise<Result<{ call_job_id: string }>>;
  advanceCallJob(callJobId: string, ctx: ExecutionContext): Promise<Result<{ status: CallJobStatus }>>;
  retryCallJob(callJobId: string): Promise<Result<void>>;

  /** #59 で実装 (#57/#58 まではスタブ)。requireAdminClient → service client で署名 URL 発行 (§7.1)。 */
  createRecordingPlaybackUrl(recordingId: string): Promise<Result<{ url: string; expires_at: string }>>;

  // ---- 契約外拡張 (facade.ts 内専用。04-telephony.md §7.2。他モジュールからの呼び出し禁止) ----
  handleDialResult(input: DialResultWebhook, ctx: ExecutionContext): Promise<Result<{ twiml: string }>>;
  handleRecorded(input: { CallSid: string }, ctx: ExecutionContext): Promise<Result<{ twiml: string }>>;

  // ---- 契約外拡張 (admin UI 専用。04-telephony.md §7.2。#59 で型宣言ごと新規追加) ----
  /**
   * keyset (started_at desc, id desc)。needsReview = match_status='ambiguous'。E201/E202/E901。
   * 戻り値は CallListItemView (CallListItem の契約外拡張 — §8.1 の要確認バッジ/error_code
   * ツールチップ/要約冒頭40字用。D7 §4.13 の CallListItem 自体は変更しない)。
   */
  listCalls(input: {
    cursor: string | null;
    filter?: { handling?: CallHandling; needsReview?: boolean; jobFailed?: boolean };
  }): Promise<Result<Paged<CallListItemView>>>;
  /** calls + recordings + jobs (transcript/analysis/link_result parse 済み) の集約読み。E804/E201/E202 */
  getCallDetail(callId: string): Promise<Result<CallDetail>>;
  /**
   * 手動紐づけ/付け替え/解除。楽観排他 updated_at 生文字列 (不一致 KMB-E103)。
   * customerId 非 null: calls.customer_id/match_status='manual' 更新 + appendActivity('call') (冪等) +
   *   relinkActivity で links を新顧客へ張り替え。customerId null: 紐づけ解除
   *   (match_status='manual' のまま customer_id null 化。既存 'call' activity があれば links を全解除)。
   * E603 (顧客不存在 — crm から透過)
   */
  linkCallToCustomer(callId: string, customerId: string | null, expectedUpdatedAt: string): Promise<Result<void>>;
  /** 設定画面/バナー用 (E802 degrade 表示の判定素材)。staleJobs は getCallAlertCounts.stalled と同一 query。 */
  getTelephonySetupStatus(): Promise<
    Result<{ envConfigured: boolean; numberConfigured: boolean; forwardConfigured: boolean; staleJobs: number }>
  >;
  /** ダッシュボード集計 (§8.4)。呼び出し元は /admin ホーム (crm フェーズの app 層)。E201/E202/E901 */
  getCallAlertCounts(): Promise<Result<{ failed: number; needsReview: number; stalled: number }>>;
  /**
   * メモ欄保存 (§8.2-8)。canonical §7.4 の Server Actions 表に記載漏れがあるが、
   * §8.2 本文の明示要求のため #59 で追加実装 (repository.ts の判断根拠コメント参照)。
   * 楽観排他 updated_at 生文字列 (不一致 KMB-E103)。E804 (通話不存在) / E201/E202。
   */
  saveCallMemo(callId: string, memo: string | null, expectedUpdatedAt: string): Promise<Result<void>>;
}

/** statusCallback の CallStatus のうち「通話終了」を意味する値 (§6.3)。 */
const TERMINAL_CALL_STATUSES = new Set(["completed", "busy", "no-answer", "failed", "canceled"]);

/**
 * ExecutionContext から DB client を解決する (ai-providers/internal/router.ts と同型のパターン)。
 * webhook は常に { mode: 'service' } で呼ばれるため実質は service client のみが渡ってくるが、
 * D8 のシグネチャは ExecutionContext 全体を受けるため session 分岐も残す。
 */
async function resolveDbClient(ctx: ExecutionContext): Promise<Result<SupabaseClient>> {
  if (ctx.mode === "service") {
    try {
      return { ok: true, value: ctx.client ?? createSupabaseServiceClient() };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  }
  return { ok: true, value: await createSupabaseServerClient() };
}

function baseUrl(): string {
  return getEnv().NEXT_PUBLIC_SITE_URL;
}

/** business_hours / telephony の 2 キーを service ctx で読み、未設定は既定値へ degrade する (§6.1 手順 3)。 */
async function resolveInboundSettings(
  ctx: ExecutionContext,
): Promise<{ withinBusinessHours: boolean; telephonySettings: TelephonySettings }> {
  const [businessHoursResult, telephonyResult] = await Promise.all([
    settingsFacade.get("business_hours", ctx),
    settingsFacade.get("telephony", ctx),
  ]);

  // KMB-E901 (未設定/parse不一致) はここでエラーとして伝播させず、既定値へ degrade する
  // (§6.1 手順 3 の明示規約 — ゼロ設定でも留守電が成立する)。
  const withinBusinessHours = businessHoursResult.ok
    ? isWithinBusinessHours(new Date(), businessHoursResult.value)
    : true;
  const telephonySettings = telephonyResult.ok ? telephonyResult.value : DEFAULT_TELEPHONY_SETTINGS;

  return { withinBusinessHours, telephonySettings };
}

// ============================================================
// #59: 管理画面向け契約外拡張 5 メソッド + createRecordingPlaybackUrl の共通ヘルパー
// ============================================================

/** /admin/calls 一覧のページサイズ (04-telephony.md §8.1: DataTable keyset 50 件)。 */
const CALLS_PAGE_SIZE = 50;

/**
 * 契約外拡張 5 メソッド + createRecordingPlaybackUrl 用の admin 確認 + client 解決
 * (計画書: 「いずれも ctx を取らない — 内部で getSessionAndClient()/platformFacade.requireAdmin()
 * を使う」)。
 *
 * 【判断根拠】calls/call_recordings/call_jobs の SELECT RLS は admin 限定 (`is_admin()`) だが、
 * 「authenticated だが非 admin」なユーザーが呼んだ場合 RLS は黙って 0 行を返すだけで明示的な
 * permission denied にはならない (retryCallJob が経由する RPC の is_admin_or_service() ガードの
 * ような防御が無い)。「権限が無いだけ」を「データが無い (空一覧/KMB-E804)」に化けさせないため、
 * repository 呼び出し前に明示的な admin 判定を行う。`platformFacade.requireAdmin()` を直接
 * 呼ばずに本関数を用意したのは、それが内部で自前の `getSessionAndClient()` を再度呼び出す設計
 * (`client` を呼び出し元へ返さない) であり、ここでは repository へ渡す `client` も同時に必要な
 * ため二重のセッション往復を避ける目的 (`platformFacade.isAdmin()` で同じ profile 判定を再利用)。
 */
async function requireAdminClient(): Promise<Result<{ client: SupabaseClient; userId: string }>> {
  try {
    const { supabase, user } = await getSessionAndClient();
    if (!user) return { ok: false, code: "KMB-E201" };
    const isAdmin = await platformFacade.isAdmin(user.id);
    if (!isAdmin) return { ok: false, code: "KMB-E202" };
    return { ok: true, value: { client: supabase, userId: user.id } };
  } catch (err) {
    return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * calls.customer_id 群を CrmFacade.getCustomerRef (merged 終端解決込み) へ通し customer_name を
 * 解決する (D8 規約: calls.customer_id の直 join 禁止 — 計画書必須要件)。1 ページ最大 50 件のため
 * Promise.all で十分 (計画書の指示どおり。追加のバッチ API は crm 側に無い)。
 *
 * 【判断根拠 — openIssues 記載】customer_id が非 null な行の getCustomerRef が個別に失敗した場合
 * (calls.customer_id は on delete set null の FK のため通常起こり得ないが、マージ処理との競合等の
 * 理論上のケースを排除できない)、listCalls/getCallDetail 全体を失敗させると「1 件の参照解決不良」
 * で一覧全体が admin から見えなくなる (可用性の毀損 — 「機能を壊さない」に反する)。calls 自体
 * (主資料) の読み取りは既に成功しているため、customer_name はその行だけ null に degrade する
 * (UI は既存の「E.164 表示 or 番号非通知」フォールバックへ自然に倒れる — customer_id 自体は
 * そのまま返すため、UI 側で顧客ページへのリンクは維持できる)。失敗は console.error で必ず可視化し
 * 握り潰さない (resolveInboundSettings の既存 degrade パターンと同じ設計判断)。
 */
async function resolveCustomerNames(customerIds: string[]): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(customerIds)];
  const resolved = await Promise.all(
    uniqueIds.map(async (id) => ({ id, result: await crmFacade.getCustomerRef(id, { mode: "service" }) })),
  );
  const map = new Map<string, string>();
  for (const { id, result } of resolved) {
    if (result.ok) {
      map.set(id, result.value.name);
    } else {
      console.error(
        `[${result.code}] telephony listCalls/getCallDetail: customer_name 解決に失敗 (customer=${id}):`,
        result.detail,
      );
    }
  }
  return map;
}

function toCallListItem(row: CallListRow, customerNames: Map<string, string>): CallListItem {
  return {
    id: row.id,
    direction: row.direction,
    from_e164: row.from_e164,
    customer_id: row.customer_id,
    customer_name: row.customer_id ? (customerNames.get(row.customer_id) ?? null) : null,
    handling: row.handling,
    duration_seconds: row.duration_seconds,
    job_status: row.job_status,
    started_at: row.started_at,
  };
}

/** analysis.minutes.summary の冒頭40字 (§8.1)。40字超は「…」を付けて切り詰めを明示する。 */
function summarizePreview(analysis: CallAnalysis | null | undefined): string | null {
  if (!analysis) return null;
  const summary = analysis.minutes.summary;
  return summary.length > 40 ? `${summary.slice(0, 40)}…` : summary;
}

/**
 * /admin/calls 一覧専用 (§8.1)。CallListItemView は CallListItem の契約外拡張 (telephony/contracts.ts
 * 参照 — レビュー指摘対応で追加)。listCallsPage が返す row にのみ job_error_code/job_analysis が
 * populate される (getCallDetail 経由の toCallListItem 呼び出しは job_status のみで足りる)。
 */
function toCallListItemView(row: CallListRow, customerNames: Map<string, string>): CallListItemView {
  return {
    ...toCallListItem(row, customerNames),
    match_status: row.match_status,
    job_error_code: row.job_error_code ?? null,
    summary_preview: summarizePreview(row.job_analysis),
  };
}

/**
 * linkCallToCustomer が (稀に) 新規 'call' activity を作る際の title/body 構築
 * (internal/worker.ts の buildCallActivityTitle/buildCallActivityBody と同じ表記ルール — §6.6。
 * worker.ts 側は非 export のため重複実装になるが、facade.ts と internal/worker.ts で
 * 「同一 activity_type='call' の title/body 生成」という同じ関心事を別の入力データ (AI 解析済み
 * vs 手動操作時点の最良データ) から行う都合上、無理に共通化すると分岐が増えて可読性が落ちる
 * ため許容する)。
 *
 * 【判断根拠】admin の手動紐づけは AI 議事録 (analysis) が未生成のまま (match_status='pending' の
 * 通話を先回りして紐づける等、状態図 §5.2.2 が明示的に禁止していない遷移) 呼ばれる可能性を
 * 排除できない。analysis があれば要約を使い、無ければ「AI 議事録は未生成」の文言へ安全側で
 * フォールバックする (データを欠落させたまま例外にはしない — 「エラー握り潰し厳禁」は「実際に
 * 起きたエラーの隠蔽」が対象であり、「まだ存在しないデータの穏当なプレースホルダ表示」は
 * これに当たらない)。
 */
function buildManualLinkActivityTitle(call: CallRow): string {
  const name = call.from_e164 ? `番号${call.from_e164.slice(-4)}` : "番号非通知";
  return `電話 (着信) ${name} ${formatDuration(call.duration_seconds)}`.slice(0, 120);
}

function buildManualLinkActivityBody(analysis: CallAnalysis | null): string {
  if (!analysis) return "（AI 議事録は未生成です。管理画面で手動紐づけされました）";
  const keyPoints =
    analysis.minutes.key_points.length > 0
      ? analysis.minutes.key_points.map((p) => `・${p}`).join("\n")
      : "（要点なし）";
  return [analysis.minutes.summary, "", "— 要点 —", keyPoints].join("\n");
}

export const telephonyFacade: TelephonyFacade = {
  async handleInboundCall(input, ctx) {
    const clientResult = await resolveDbClient(ctx);
    if (!clientResult.ok) return clientResult;
    const supabase = clientResult.value;

    // (1) From を normalizeJpPhoneToE164() — 失敗時 from_e164=null (非通知 'anonymous' 等)
    const fromE164 = input.From ? normalizeJpPhoneToE164(input.From) : null;

    // (2) calls UPSERT (call_sid unique の冪等 INSERT — Twilio の同一リクエスト再送に対応)
    const upsertResult = await upsertCallOnConflictDoNothing(supabase, {
      call_sid: input.CallSid,
      direction: "inbound",
      from_e164: fromE164,
      from_raw: input.From,
      to_e164: input.To,
      twilio_status: input.CallStatus,
    });
    if (!upsertResult.ok) return upsertResult;
    const call = upsertResult.value.row;

    // (3) settings read (service ctx) — 未設定は既定値へ degrade
    const { withinBusinessHours, telephonySettings } = await resolveInboundSettings(ctx);
    const url = baseUrl();

    // (4) JST 判定 + (5) handling 確定分の反映 + (6) TwiML 生成
    if (!withinBusinessHours) {
      const handlingResult = await updateCallHandling(supabase, call.id, "after_hours_voicemail");
      if (!handlingResult.ok) return handlingResult;
      return {
        ok: true,
        value: {
          twiml: buildAfterHoursTwiml({
            afterHoursGreetingText: telephonySettings.after_hours_greeting_text,
            consentEnabled: telephonySettings.consent_announcement_enabled,
            consentText: telephonySettings.consent_announcement_text,
            voicemailMaxSeconds: telephonySettings.voicemail_max_seconds,
            baseUrl: url,
          }),
        },
      };
    }

    if (telephonySettings.forward_to_e164) {
      // handling は dial_result (?step=dial_result — handleDialResult) 到達時に
      // 'forwarded' / 'voicemail' へ確定する。root 応答時点では未確定のまま (null)。
      return {
        ok: true,
        value: {
          twiml: buildForwardTwiml({
            consentEnabled: telephonySettings.consent_announcement_enabled,
            consentText: telephonySettings.consent_announcement_text,
            forwardToE164: telephonySettings.forward_to_e164,
            baseUrl: url,
          }),
        },
      };
    }

    // 転送先未設定 → 即留守電
    const handlingResult = await updateCallHandling(supabase, call.id, "voicemail");
    if (!handlingResult.ok) return handlingResult;
    return {
      ok: true,
      value: {
        twiml: buildVoicemailTwiml({
          greetingText: telephonySettings.in_hours_greeting_text,
          consentEnabled: telephonySettings.consent_announcement_enabled,
          consentText: telephonySettings.consent_announcement_text,
          fromDialFallback: false,
          voicemailMaxSeconds: telephonySettings.voicemail_max_seconds,
          baseUrl: url,
        }),
      },
    };
  },

  async handleCallStatus(input, ctx) {
    const clientResult = await resolveDbClient(ctx);
    if (!clientResult.ok) return clientResult;
    const supabase = clientResult.value;

    const callResult = await findCallByCallSid(supabase, input.CallSid);
    if (!callResult.ok) return callResult;
    const call = callResult.value;

    if (!call) {
      // Twilio に 4xx/5xx を返しても意味がない — route が 200 で吸収する設計 (§6.3 手順 1)。
      console.error(`KMB-E804: /api/telephony/status で対象の通話が見つかりません (CallSid=${input.CallSid})`);
      return { ok: false, code: "KMB-E804", detail: `通話が見つかりません: ${input.CallSid}` };
    }

    const isTerminal = TERMINAL_CALL_STATUSES.has(input.CallStatus);
    // handling: null のまま終了 → 'missed'。既に確定済み (forwarded/voicemail/after_hours_voicemail)
    // はそのまま (録音有無は問わない — §6.3 手順 3)。
    const nextHandling = call.handling === null && isTerminal ? ("missed" as const) : undefined;
    const effectiveHandling = nextHandling ?? call.handling;

    const patch: CallStatusCallbackPatch = {
      twilio_status: input.CallStatus,
      duration_seconds: input.CallDuration,
      ended_at: isTerminal ? new Date().toISOString() : call.ended_at,
      twilio_cost_estimate_micro_usd: estimateTwilioCostMicroUsd(input.CallDuration ?? 0, effectiveHandling),
    };
    if (nextHandling) {
      patch.handling = nextHandling;
    }

    const updateResult = await updateCallOnStatusCallback(supabase, call.id, patch);
    if (!updateResult.ok) return updateResult;
    return { ok: true, value: undefined };
  },

  async registerRecording(input, ctx) {
    const clientResult = await resolveDbClient(ctx);
    if (!clientResult.ok) return clientResult;
    const supabase = clientResult.value;

    const callResult = await findCallByCallSid(supabase, input.CallSid);
    if (!callResult.ok) return callResult;
    let call = callResult.value;

    if (!call) {
      // 理論上のみ発生 (voice webhook が先行しなかった場合の防御 — §6.4 手順 1)。
      console.warn(
        `KMB-E804: /api/telephony/recording-status で対象の通話が見つかりません` +
          ` (CallSid=${input.CallSid})。防御的にプレースホルダ行を作成します`,
      );
      const placeholderResult = await upsertCallOnConflictDoNothing(supabase, {
        call_sid: input.CallSid,
        direction: "inbound",
        from_e164: null,
        from_raw: null,
        to_e164: "unknown", // recording-status webhook には To が含まれないため不明値
        twilio_status: "completed",
      });
      if (!placeholderResult.ok) return placeholderResult;
      call = placeholderResult.value.row;
    }

    // zRecordingWebhook.RecordingChannels は z.coerce.number().min(1).max(2) のため実行時には
    // 1|2 に絞られているが、coerce.number() は型上ただの number しか返さない (07-delta の
    // 記載漏れではなく zod v4 の coerce 型推論の制約)。DB check (channels in (1,2)) と 1:1 の
    // CallRecordingSource/channels 型に渡す前に明示的に絞り込む (as で潰さない)。
    const channels = input.RecordingChannels;
    if (channels !== 1 && channels !== 2) {
      return {
        ok: false,
        code: "KMB-E803",
        detail: `RecordingChannels が不正です (1 または 2 のみ許容): ${channels}`,
      };
    }

    // source: 2ch='dial' (転送録音) / 1ch='voicemail' (§6.4 手順 2)
    const source: CallRecordingSource = channels === 2 ? "dial" : "voicemail";

    const recordingResult = await insertRecordingOnConflictDoNothing(supabase, {
      call_id: call.id,
      recording_sid: input.RecordingSid,
      source,
      twilio_url: input.RecordingUrl,
      duration_seconds: input.RecordingDuration,
      channels,
    });
    if (!recordingResult.ok) return recordingResult;
    const recording = recordingResult.value.row;

    // RecordingDuration=0 (ビープ前切断等) → status='done' の空ジョブ / >0 → 'pending' (§6.4 手順 3)
    const jobResult = await insertCallJobIdempotent(supabase, {
      call_id: call.id,
      recording_id: recording.id,
      status: input.RecordingDuration === 0 ? "done" : "pending",
    });
    if (!jobResult.ok) return jobResult;

    return { ok: true, value: { call_job_id: jobResult.value.row.id } };
  },

  async advanceCallJob(callJobId, ctx) {
    // 薄いラッパー: ctx → client 解決のみ担当し、lease/commit 制御フローの実体は
    // internal/worker.ts の advanceCallJob (STAGE_HANDLERS 経由の 1 呼び出し=1 ステージ) に委ねる
    // (04-telephony.md §6.5 共通則 / §7.1 D8)。
    const clientResult = await resolveDbClient(ctx);
    if (!clientResult.ok) return clientResult;
    return advanceCallJobStage(clientResult.value, callJobId);
  },

  async retryCallJob(callJobId) {
    // D8 どおり ctx を取らない (admin セッション専用)。RPC 自体が is_admin_or_service() で
    // ガードされるため、ここでのロール判定は user 有無 (KMB-E201) のみでよい (§7.1)。
    try {
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const result = await retryCallJobRpc(supabase, callJobId);
      if (!result.ok) return result;
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async createRecordingPlaybackUrl(recordingId) {
    // D8 どおり ctx を取らない (admin セッション専用)。RPC を経由しないため repository 側で
    // 明示的に admin ロールを確認する必要がある (#58 のコメントで
    // 「requireAdmin → service client で createSignedUrl」と明記されている — 計画書踏襲)。
    const adminResult = await requireAdminClient();
    if (!adminResult.ok) return adminResult;
    const { client } = adminResult.value;

    const recordingResult = await getCallRecordingById(client, recordingId);
    if (!recordingResult.ok) return recordingResult;
    const recording = recordingResult.value;
    if (!recording) {
      return { ok: false, code: "KMB-E804", detail: `録音が見つかりません: ${recordingId}` };
    }
    if (recording.storage_path === null) {
      // 未ダウンロード (downloading ステージ未完了)。§7.1 の E805 規約。
      return { ok: false, code: "KMB-E805", detail: "録音はまだダウンロードされていません" };
    }

    // 署名 URL 発行は service client 必須: call-audio バケットはポリシー無し = service 専用
    // (migration 20260711000032 §4)。admin セッションの server client では発行そのものが
    // 失敗する (計画書の明示規約)。
    let serviceClient: SupabaseClient;
    try {
      serviceClient = createSupabaseServiceClient();
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }

    const { data, error } = await serviceClient.storage
      .from(CALL_AUDIO_BUCKET)
      .createSignedUrl(recording.storage_path, 600);
    if (error || !data) {
      return { ok: false, code: "KMB-E805", detail: error?.message ?? "署名付き URL の発行に失敗しました" };
    }

    // Supabase の createSignedUrl は expiresIn (秒) しか受け取らず expires_at を返さないため、
    // 呼び出し側で計算する (計画書の明示規約。TTL 600 秒 = 10 分)。
    return {
      ok: true,
      value: { url: data.signedUrl, expires_at: new Date(Date.now() + 600_000).toISOString() },
    };
  },

  // ---- 契約外拡張 (04-telephony.md §7.2) ----

  async handleDialResult(input, ctx) {
    const clientResult = await resolveDbClient(ctx);
    if (!clientResult.ok) return clientResult;
    const supabase = clientResult.value;

    const callResult = await findCallByCallSid(supabase, input.CallSid);
    if (!callResult.ok) return callResult;
    const call = callResult.value;
    if (!call) {
      console.error(
        `KMB-E804: /api/telephony/voice?step=dial_result で対象の通話が見つかりません (CallSid=${input.CallSid})`,
      );
      return { ok: false, code: "KMB-E804", detail: `通話が見つかりません: ${input.CallSid}` };
    }

    const dialSucceeded = input.DialCallStatus === "completed" || input.DialCallStatus === "answered";

    if (dialSucceeded) {
      const handlingResult = await updateCallHandling(supabase, call.id, "forwarded");
      if (!handlingResult.ok) return handlingResult;
      return { ok: true, value: { twiml: buildHangupTwiml() } };
    }

    // 不成立 (busy/no-answer/failed/canceled) → 留守電フォールバック (§6.2-c。同意アナウンスなし)
    const handlingResult = await updateCallHandling(supabase, call.id, "voicemail");
    if (!handlingResult.ok) return handlingResult;

    const telephonyResult = await settingsFacade.get("telephony", ctx);
    const telephonySettings = telephonyResult.ok ? telephonyResult.value : DEFAULT_TELEPHONY_SETTINGS;

    return {
      ok: true,
      value: {
        twiml: buildVoicemailTwiml({
          greetingText: null, // fromDialFallback=true 時は無視される (固定文言)
          consentEnabled: telephonySettings.consent_announcement_enabled,
          consentText: telephonySettings.consent_announcement_text,
          fromDialFallback: true,
          voicemailMaxSeconds: telephonySettings.voicemail_max_seconds,
          baseUrl: baseUrl(),
        }),
      },
    };
  },

  async handleRecorded() {
    return { ok: true, value: { twiml: buildRecordedAckTwiml() } };
  },

  // ---- 契約外拡張 (admin UI 専用。04-telephony.md §7.2。#59 で新規実装) ----

  async listCalls(input) {
    const adminResult = await requireAdminClient();
    if (!adminResult.ok) return adminResult;
    const { client } = adminResult.value;

    const pageResult = await listCallsPage(
      client,
      {
        handling: input.filter?.handling,
        needsReview: input.filter?.needsReview,
        jobFailed: input.filter?.jobFailed,
      },
      { cursor: input.cursor, limit: CALLS_PAGE_SIZE },
    );
    if (!pageResult.ok) return pageResult;

    const customerIds = pageResult.value.items
      .map((row) => row.customer_id)
      .filter((id): id is string => id !== null);
    const customerNames = await resolveCustomerNames(customerIds);

    return {
      ok: true,
      value: {
        items: pageResult.value.items.map((row) => toCallListItemView(row, customerNames)),
        next_cursor: pageResult.value.next_cursor,
      },
    };
  },

  async getCallDetail(callId) {
    const adminResult = await requireAdminClient();
    if (!adminResult.ok) return adminResult;
    const { client } = adminResult.value;

    const [callResult, recordingsResult, jobsResult] = await Promise.all([
      getCallById(client, callId),
      listCallRecordingsByCallId(client, callId),
      listCallJobsByCallId(client, callId),
    ]);
    if (!callResult.ok) return callResult;
    if (!recordingsResult.ok) return recordingsResult;
    if (!jobsResult.ok) return jobsResult;
    const call = callResult.value;
    if (!call) return { ok: false, code: "KMB-E804", detail: `通話が見つかりません: ${callId}` };

    const customerNames = call.customer_id ? await resolveCustomerNames([call.customer_id]) : new Map<string, string>();

    // 「処理状態」の代表値は最新 (created_at 最大) の job の status を採用する (listCalls の
    // job_status 集約と同じ規約 — §8.1/§8.2)。1 通話に複数 call_jobs があり得る (§10-15)。
    const latestJob =
      jobsResult.value.length > 0
        ? jobsResult.value.reduce((latest, job) => (job.created_at > latest.created_at ? job : latest))
        : null;

    const detail: CallDetail = {
      call: {
        ...toCallListItem({ ...call, job_status: latestJob?.status ?? null }, customerNames),
        memo: call.memo,
        match_status: call.match_status,
        twilio_cost_estimate_micro_usd: call.twilio_cost_estimate_micro_usd,
        ai_cost_micro_usd: call.ai_cost_micro_usd,
        updated_at: call.updated_at,
      },
      recordings: recordingsResult.value.map((r) => ({
        id: r.id,
        source: r.source,
        duration_seconds: r.duration_seconds,
        storage_path: r.storage_path,
      })),
      jobs: jobsResult.value.map((j) => ({
        id: j.id,
        status: j.status,
        error_code: j.error_code,
        transcript: j.transcript,
        analysis: j.analysis,
        link_result: j.link_result,
        created_at: j.created_at,
        updated_at: j.updated_at,
      })),
    };
    return { ok: true, value: detail };
  },

  async linkCallToCustomer(callId, customerId, expectedUpdatedAt) {
    const adminResult = await requireAdminClient();
    if (!adminResult.ok) return adminResult;
    const { client } = adminResult.value;

    // CAS 更新前に旧 customer_id を読んでおく (解除操作でどの顧客のタイムラインからリンクを
    // 外すべきか特定するため — CAS 更新後は customer_id が上書き済みで追跡できなくなる)。
    const beforeResult = await getCallById(client, callId);
    if (!beforeResult.ok) return beforeResult;
    if (!beforeResult.value) return { ok: false, code: "KMB-E804", detail: `通話が見つかりません: ${callId}` };
    const previousCustomerId = beforeResult.value.customer_id;

    // calls の CAS 更新を先に行う (E103/E804 を確定させてから crm 側へ波及させる — 逆順だと
    // CAS が失敗したときに crm の links だけ書き換わってしまう非一貫を避けるため。§7.2 の
    // 記述順「calls 更新 → appendActivity」とも整合する)。
    //
    // 【判断根拠 — レビュー指摘 (MAJOR) 対応・残存する既知の制約】この CAS 更新が成功した後に
    // 下の crmFacade.appendActivity/relinkActivity が失敗すると、calls.customer_id は新値のまま
    // crm 側の activity_links だけが未更新になる (2 つの別モジュール/別トランザクションにまたがる
    // 操作のため、真の原子性は無い)。calls 側を先に元へ書き戻すロールバックも検討したが、
    // linkCallToCustomerRow は match_status を常に 'manual' に固定する仕様 (直前の任意の
    // match_status — ambiguous/no_number/pending 等 — への復元には repository のシグネチャ変更が
    // 要り、そのロールバック UPDATE 自体が再度失敗し得るため「安全」にならない)。
    // admin が同じ操作 (同じ customerId へ向けて再実行) をやり直せば、calls 側は既に新値になって
    // いるため CAS は再度成功し、crm 側 (appendActivity は ref_table/ref_id で冪等) も追いつく
    // = 自己修復可能。これを踏まえ、UI 側 (CustomerLinkSection.tsx) でこの経路のエラー発生時に
    // 「もう一度同じ操作をやり直してください」の案内を明示する対応とする (Result の code/detail は
    // 既存の契約どおり — telephony-facade-calls.test.ts の既存アサーションを変えない)。
    const updateResult = await linkCallToCustomerRow(client, callId, customerId, expectedUpdatedAt);
    if (!updateResult.ok) return updateResult;
    const call = updateResult.value;

    // 【判断根拠 — openIssues に詳細】新旧 customerId のどちらか非 null な方を「probe」として
    // crmFacade.appendActivity の冪等キー (activity_type='call', ref_table='calls', ref_id=callId)
    // 検索に使い、既存の 'call' activity の id を取得する。zAppendActivityInput.links は
    // min(1) 制約があり空配列を渡せない (customerId=null の解除操作では appendActivity 単独で
    // 「探すだけ」ができない) ため、この probe 方式で回避する。取得した activity_id へ続けて
    // created===false (冪等ヒット = 既存 activity があった = 付け替え/解除) の場合のみ
    // relinkActivity(desiredLinks) を呼び、最終的な links を確定させる (appendActivity は
    // 冪等ヒット時に links を「追加」するだけで旧リンクを外さない — 01-crm.md §6.6-6 — ため
    // relinkActivity による全置換が必須)。
    //
    // 【レビュー指摘 (MAJOR) 是正 — 修正前は created の真偽を問わず常に relinkActivity を呼んで
    // いた】created===true (ambiguous/no_number からの初回確定) では、直前の appendActivity が
    // 既に links=[probeCustomerId] (= customerId 非 null 時は customerId そのもの = desiredLinks
    // と同一) で新規作成済みのため、relinkActivity は本質的に無意味な再置換になる。
    // crm/facade.ts の relinkActivity は呼ばれるたびに 'system' activity (title:'リンク付け替え')
    // を無条件に追記するため、これを毎回呼ぶと手動紐づけのたびに顧客タイムラインへ意味の無い
    // 監査行が積み上がってしまう (04-telephony.md §7.2 / 07-contracts-delta.md D8 の
    // relinkActivity コメントも「用途は telephony の通話『付け替え/解除』のみ」と明記 — 初回確定は
    // 対象外)。created===false のときのみ呼ぶよう限定する。
    const probeCustomerId = customerId ?? previousCustomerId;
    if (probeCustomerId === null) {
      // 新旧どちらも null = この通話は一度も顧客に紐づいたことがない。crm 側に触れる対象が無い。
      return { ok: true, value: undefined };
    }

    const [recordingsResult, jobsResult] = await Promise.all([
      listCallRecordingsByCallId(client, callId),
      listCallJobsByCallId(client, callId),
    ]);
    if (!recordingsResult.ok) return recordingsResult;
    if (!jobsResult.ok) return jobsResult;

    const latestAnalysis = jobsResult.value.reduce<CallAnalysis | null>((acc, job) => job.analysis ?? acc, null);
    const durationSeconds =
      call.duration_seconds ?? recordingsResult.value.reduce((sum, r) => sum + r.duration_seconds, 0);
    const desiredLinks = customerId !== null ? [{ customer_id: customerId, company_id: null, deal_id: null }] : [];

    const appendResult = await crmFacade.appendActivity(
      {
        activity_type: "call",
        occurred_at: call.started_at,
        title: buildManualLinkActivityTitle(call),
        body: buildManualLinkActivityBody(latestAnalysis),
        payload: {
          call_id: call.id,
          direction: call.direction,
          duration_seconds: durationSeconds,
          has_recording: recordingsResult.value.length > 0,
          summary: latestAnalysis ? latestAnalysis.minutes.summary.slice(0, 2000) : null,
        },
        ref_table: "calls",
        ref_id: callId,
        links: [{ customer_id: probeCustomerId, company_id: null, deal_id: null }],
      },
      { mode: "service" },
    );
    if (!appendResult.ok) return appendResult;

    if (!appendResult.value.created) {
      const relinkResult = await crmFacade.relinkActivity(appendResult.value.activity_id, desiredLinks, {
        mode: "service",
      });
      if (!relinkResult.ok) return relinkResult;
    }

    return { ok: true, value: undefined };
  },

  async getTelephonySetupStatus() {
    const adminResult = await requireAdminClient();
    if (!adminResult.ok) return adminResult;
    const { client } = adminResult.value;

    const [telephonyResult, staleResult] = await Promise.all([
      settingsFacade.get("telephony", { mode: "service" }),
      countStaleCallJobs(client),
    ]);
    if (!staleResult.ok) return staleResult;

    // 未設定 (KMB-E901) は「ゼロ設定でも壊れない」既定値へ degrade する (resolveInboundSettings と
    // 同じ確立済みパターン)。本メソッド自体が「未設定を報告する」ためのものであり、未設定を
    // エラーとして跳ね返すのは目的と矛盾する。
    const telephonySettings = telephonyResult.ok ? telephonyResult.value : DEFAULT_TELEPHONY_SETTINGS;

    return {
      ok: true,
      value: {
        envConfigured: isTelephonyConfigured(),
        numberConfigured: telephonySettings.phone_number_e164 !== null,
        forwardConfigured: telephonySettings.forward_to_e164 !== null,
        staleJobs: staleResult.value,
      },
    };
  },

  async getCallAlertCounts() {
    const adminResult = await requireAdminClient();
    if (!adminResult.ok) return adminResult;
    const { client } = adminResult.value;

    const [failedResult, needsReviewResult, stalledResult] = await Promise.all([
      countFailedCallJobs(client),
      countAmbiguousCalls(client),
      countStaleCallJobs(client),
    ]);
    if (!failedResult.ok) return failedResult;
    if (!needsReviewResult.ok) return needsReviewResult;
    if (!stalledResult.ok) return stalledResult;

    return {
      ok: true,
      value: {
        failed: failedResult.value,
        needsReview: needsReviewResult.value,
        stalled: stalledResult.value,
      },
    };
  },

  async saveCallMemo(callId, memo, expectedUpdatedAt) {
    const adminResult = await requireAdminClient();
    if (!adminResult.ok) return adminResult;
    const { client } = adminResult.value;

    const result = await updateCallMemo(client, callId, memo, expectedUpdatedAt);
    if (!result.ok) return result;
    return { ok: true, value: undefined };
  },
};
