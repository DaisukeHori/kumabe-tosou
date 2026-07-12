import { z } from "zod";

import { zShortText } from "@/modules/platform/contracts";

/**
 * canonical: docs/design/crm-suite/07-contracts-delta.md §4.13 (D7) — telephony の値契約。
 * §3.2 以下は 04-telephony.md 側の追加分 (webhook 契約・内部 jsonb 契約・parity 用 enum)。
 * 各セクション冒頭のコメント参照。乖離時は 07-contracts-delta.md が正。
 */

/* ============================================================
 * §4.13 canonical 写経部 (07-contracts-delta.md D7、行814-906)。
 * 一字一句コピー — 乖離時は契約書 (07-contracts-delta.md) が正。
 * ============================================================ */

export const zCallDirection = z.enum(["inbound", "outbound"]); // outbound は Phase 2 予約
export const zCallHandling = z.enum(["forwarded", "voicemail", "after_hours_voicemail", "missed"]);
export const zCallJobStatus = z.enum([
  "pending", "downloading", "transcribing", "analyzing", "linking", "done", "failed",
]);

/** Twilio Voice webhook の受信契約 (application/x-www-form-urlencoded を parse した後の最小部分集合。
 *  署名検証 validateRequest は「全パラメータ変形なし」が必須のため route が生 params を保持し、
 *  本スキーマは検証後の業務利用分のみ)。
 *  route 共通則 (v1.6 — 04-telephony §6.1-5): 実 Twilio POST は AccountSid/ApiVersion/Direction/
 *  RecordingSource 等 10+ の未契約パラメータを含むため、署名検証後に**契約キーのみ pick + 欠落キーは
 *  null 補完**してから parse する (.strict() は pick 後の集合に対して有効。生 Record を直 parse すると
 *  unrecognized_keys で全 webhook が KMB-E803 になる)。zCallStatusWebhook / zDialResultWebhook
 *  (telephony 所有 — 04 §3.2) の欠落し得る数値フィールドは preprocess で undefined→null を吸収する */
export const zInboundCallWebhook = z.object({
  CallSid: z.string().min(10).max(64),
  From: z.string().max(30).nullable(),           // 非通知は Twilio が 'anonymous' 等の文字列を送る —
                                                 // null になるのは route の欠落キー補完時のみ。
                                                 // 非通知判定・E.164 正規化は facade 内 (from_e164=null 化)
  To: z.string().max(30),
  CallStatus: z.string().max(30),
}).strict();

export const zRecordingWebhook = z.object({
  CallSid: z.string().min(10).max(64),
  RecordingSid: z.string().min(10).max(64),
  RecordingUrl: z.string().url(),
  RecordingDuration: z.coerce.number().int().min(0),
  RecordingChannels: z.coerce.number().int().min(1).max(2),
}).strict();

/** 転写結果 (call_jobs.transcript jsonb)。デュアルチャネルは channel 0=相手 / 1=こちら */
export const zCallTranscript = z.object({
  segments: z.array(z.object({
    channel: z.number().int().min(0).max(1),
    index: z.number().int().min(0),
    text: z.string().max(50_000),
  }).strict()).max(200),
  full_text: z.string().max(200_000),
}).strict();

/** AI 議事録 (generateText + responseSchema の structured output。
 *  JSON Schema は z.toJSONSchema() で本スキーマから生成 — 手書き禁止) */
export const zCallMinutes = z.object({
  summary: z.string().min(1).max(2000),
  caller_intent: z.enum(["estimate_request", "order", "inquiry", "schedule", "complaint", "sales_call", "other"]),
  key_points: z.array(z.string().max(300)).max(20),
  customer_name_guess: z.string().max(60).nullable(),
  callback_required: z.boolean(),
  callback_note: z.string().max(300).nullable(),
}).strict();

export const zExtractedCallTask = z.object({
  title: zShortText(120),
  detail: z.string().max(1000).nullable(),
  due_hint: z.string().max(100).nullable(),      // 「明日中に折り返し」等。日付確定は admin
}).strict();

/** analyzing ステージの出力契約 (KMB-E821 の検証対象) */
export const zCallAnalysis = z.object({
  minutes: zCallMinutes,
  tasks: z.array(zExtractedCallTask).max(10),
}).strict();

export type CallListItem = {
  id: string;
  direction: z.infer<typeof zCallDirection>;
  from_e164: string | null;    // zTelE164 準拠 (非通知は null)
  customer_id: string | null;
  customer_name: string | null; // 解決は CrmFacade.getCustomerRef (merged 終端解決込み — D8。calls.customer_id の直 join 禁止)
  handling: z.infer<typeof zCallHandling> | null;
  duration_seconds: number | null;
  job_status: z.infer<typeof zCallJobStatus> | null;
  started_at: string;
};

/* 型 alias (v1.2 — D8 参照分) */
export type CallDirection = z.infer<typeof zCallDirection>;
export type CallHandling = z.infer<typeof zCallHandling>;
export type CallJobStatus = z.infer<typeof zCallJobStatus>;
export type InboundCallWebhook = z.infer<typeof zInboundCallWebhook>;
export type RecordingWebhook = z.infer<typeof zRecordingWebhook>;
export type CallTranscript = z.infer<typeof zCallTranscript>;
export type CallMinutes = z.infer<typeof zCallMinutes>;
export type ExtractedCallTask = z.infer<typeof zExtractedCallTask>;
export type CallAnalysis = z.infer<typeof zCallAnalysis>;

/* ============================================================
 * 04-telephony.md §3.2 追加分 (行673-759)。telephony 所有の webhook 追加契約 +
 * jsonb 内部契約 + DB check ↔ Zod parity 用 enum。
 * zTelephonySettings (Δ2) は settings 所有のため本ファイルでは再定義しない —
 * 実体は src/modules/settings/contracts.ts の SETTINGS_SCHEMAS.telephony (実装済み)。
 * telephony モジュールから使うときは @/modules/settings/facade 経由で import する。
 * ============================================================ */

/** 通話終了 statusCallback (D8 handleCallStatus の入力を Zod 化)。
 *  webhook 契約共通則 (§6.1-5): route は署名検証後に「契約キーのみ pick + 欠落キーは null 補完」
 *  してから parse する (form-urlencoded はキー自体が欠落 = undefined になり得るため、
 *  .nullable() だけでは受けられない。欠落し得る数値フィールドは preprocess で undefined→null を吸収) */
export const zCallStatusWebhook = z.object({
  CallSid: z.string().min(10).max(64),
  CallStatus: z.string().max(30),
  CallDuration: z.preprocess(
    (v) => v ?? null,
    z.coerce.number().int().min(0).nullable(),
  ), // 終了系イベント以外はパラメータごと欠落し得る (undefined → null)
}).strict();

/** <Dial action> callback (?step=dial_result — §6.1)。voicemail フォールバック判定に使う。
 *  DialCallDuration は Dial が応答されなかった場合 (busy/no-answer/failed/canceled) に
 *  Twilio がパラメータ自体を送らない想定 (★実装前に Twilio 公式 Doc の <Dial> action callback
 *  パラメータ表で欠落条件を裏取りし、本コメントに引用 URL を残すこと)。
 *  ここが parse 失敗すると留守電フォールバック (§10-2) が Fallback URL 切断に化けるため、
 *  欠落を必ず受けられる形にする (BLOCKER 級) */
export const zDialResultWebhook = z.object({
  CallSid: z.string().min(10).max(64),
  DialCallStatus: z.enum(["completed", "answered", "busy", "no-answer", "failed", "canceled"]),
  DialCallDuration: z.preprocess(
    (v) => v ?? null,
    z.coerce.number().int().min(0).nullable(),
  ),
}).strict();

export type CallStatusWebhook = z.infer<typeof zCallStatusWebhook>;
export type DialResultWebhook = z.infer<typeof zDialResultWebhook>;

/** linking の監査スナップショット。参照整合は持たせない (FK は calls.customer_id が正)。
 *  再実行時の冪等判定は appendActivity の (type, ref_table, ref_id) 一意性が担う */
export const zCallJobLinkResult = z.object({
  outcome: z.enum(["matched", "created", "ambiguous", "no_number"]), // calls.match_status へ反映した値
  customer_id: z.string().uuid().nullable(),
  activity_id: z.string().uuid().nullable(),  // ambiguous / no_number は null (activity 未作成)
  activity_created: z.boolean(),              // appendActivity の created フラグ (false = 再実行だった)
  task_ids: z.array(z.string().uuid()).max(10),
  warning: z.string().max(300).nullable(),    // 例: 'KMB-E823: 候補 2 件' (detail 要約)
}).strict();
export type CallJobLinkResult = z.infer<typeof zCallJobLinkResult>;

/** セグメント単位の転写チェックポイント (00-overview §3.1.4-8 の実装 — §6.5.2-4)。
 *  (channel, index) が再開カーソル。完了セグメントのみ追記され、
 *  全完了時に zCallTranscript へ組み立てて commit する */
export const zCallTranscriptCheckpoint = z.object({
  segments: z.array(z.object({
    channel: z.number().int().min(0).max(1),
    index: z.number().int().min(0),
    text: z.string().max(50_000),
  }).strict()).max(200),
}).strict();
export type CallTranscriptCheckpoint = z.infer<typeof zCallTranscriptCheckpoint>;

/* ---------- DB check ↔ Zod parity 用 enum (call_recordings — §2.6/§12.2 の parity テスト対象) ---------- */

export const zCallRecordingSource = z.enum(["dial", "voicemail"]); // 2ch='dial' / 1ch='voicemail' (§6.4-2)
export const zCallRecordingChannels = z.union([z.literal(1), z.literal(2)]);
export type CallRecordingSource = z.infer<typeof zCallRecordingSource>;
export type CallRecordingChannels = z.infer<typeof zCallRecordingChannels>;

/**
 * calls.match_status (§5.2.2 / migration 0032 check 制約) の Zod enum。
 *
 * 【canonical の記載漏れ (計画書 issue-56.md §8 未解決点 #1 — 実装時の判断)】
 * 07-contracts-delta.md §4.13 および 04-telephony.md §3.1/§3.2 のコードブロックには
 * match_status 用の export が存在しない (direction/handling/jobStatus/recordingSource/
 * recordingChannels は明記されているが match_status のみ抜けている)。一方で 04-telephony.md
 * §2.6「自モジュール所有の enum は DB check ↔ Zod enum 1:1 で parity テストに追加する」は
 * match_status を明示的に含む (calls.match_status は自モジュール所有 enum の列挙の1つ)。
 * 軽微な記載漏れと判断し、DDL (migration 20260711000032 — 04-telephony §2.2) の
 * `check (match_status in (...))` と 1:1 になるよう本ファイルに追加 export する。
 * 値の並び順は DDL の記載順 (§5.2.2 の状態遷移図とも整合)。
 */
export const zCallMatchStatus = z.enum([
  "pending", "matched", "created", "ambiguous", "no_number", "manual",
]);
export type CallMatchStatus = z.infer<typeof zCallMatchStatus>;

/*
 * 以下は contracts.ts には置かない (04-telephony.md §3.2 末尾の明示規約 — 契約面の最小化):
 *   internal/lease.ts    … CALL_JOB_LEASE_TTL_MS / CALL_JOB_HEARTBEAT_INTERVAL_MS / CALL_JOB_MAX_ATTEMPTS ほか
 *   internal/cost.ts     … TWILIO_RATES_MICRO_USD_PER_MIN
 *   internal/segmenter.ts … SEGMENT_MAX_SECONDS ほか
 * これらの定数は本 Issue (#56 DDL+契約+repository) のスコープ外 (#57/#58 が internal/ 配下に実ファイルを作る)。
 */
