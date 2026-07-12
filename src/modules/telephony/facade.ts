import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getSessionAndClient } from "@/lib/supabase/session";
import type { ExecutionContext, Result } from "@/modules/platform/contracts";
import { normalizeJpPhoneToE164 } from "@/modules/platform/text";
import { settingsFacade } from "@/modules/settings/facade";

import type {
  CallJobStatus,
  CallRecordingSource,
  DialResultWebhook,
  InboundCallWebhook,
  RecordingWebhook,
} from "./contracts";
import { isWithinBusinessHours } from "./internal/business-hours";
import { estimateTwilioCostMicroUsd } from "./internal/cost";
import { DEFAULT_TELEPHONY_SETTINGS, type TelephonySettings } from "./internal/settings-defaults";
import {
  buildAfterHoursTwiml,
  buildForwardTwiml,
  buildHangupTwiml,
  buildRecordedAckTwiml,
  buildVoicemailTwiml,
} from "./internal/twiml";
import { advanceCallJob as advanceCallJobStage, runTelephonyJobBatch } from "./internal/worker";
import {
  type CallStatusCallbackPatch,
  findCallByCallSid,
  insertCallJobIdempotent,
  insertRecordingOnConflictDoNothing,
  retryCallJobRpc,
  updateCallHandling,
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
 * #57 (本 Issue) で advanceCallJob / retryCallJob を実装した (lease/commit/retry の
 * 制御フローのみ — 4 ステージの実処理は internal/worker.ts の STAGE_HANDLERS 経由で #58 が担う)。
 * createRecordingPlaybackUrl は引き続き D8 のシグネチャのみ満たす明示スタブ (実体は #58/#59)。
 *
 * handleInboundCall/handleCallStatus/registerRecording/advanceCallJob は ctx: ExecutionContext
 * を必須で受け取る (D8 のシグネチャ通り ctx? ではない — webhook route は anon 起点のため常に
 * { mode: 'service' } で呼ぶ)。retryCallJob は D8 どおり ctx を取らない (admin セッション専用)。
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

  // ---- D8 契約メソッドのうち本 Issue のスコープ外 (#58/#59) — 型のみ宣言 ----
  createRecordingPlaybackUrl(recordingId: string): Promise<Result<{ url: string; expires_at: string }>>;

  // ---- 契約外拡張 (facade.ts 内専用。04-telephony.md §7.2。他モジュールからの呼び出し禁止) ----
  handleDialResult(input: DialResultWebhook, ctx: ExecutionContext): Promise<Result<{ twiml: string }>>;
  handleRecorded(input: { CallSid: string }, ctx: ExecutionContext): Promise<Result<{ twiml: string }>>;
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

  async createRecordingPlaybackUrl() {
    return { ok: false, code: "KMB-E901", detail: "not implemented (#58/#59 で実装)" };
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
};
