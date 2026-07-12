import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Result } from "@/modules/platform/contracts";
import type { KmbErrorCode } from "@/modules/platform/errors";

import type {
  CallAnalysis,
  CallDirection,
  CallHandling,
  CallJobLinkResult,
  CallJobStatus,
  CallMatchStatus,
  CallRecordingChannels,
  CallRecordingSource,
  CallTranscript,
  CallTranscriptCheckpoint,
} from "./contracts";

/**
 * telephony モジュールの repository。calls / call_recordings / call_jobs への**唯一の**
 * 直接クエリ経路 (04-telephony.md §1.2 — facade.ts のみがここを import する)。
 *
 * 本 Issue (#56 DDL+契約+repository) のスコープは 3 webhook (voice/status/recording-status) の
 * INSERT/UPDATE/SELECT のみ。lease/commit/retry RPC 呼び出し (call_job_acquire_lease 等) は
 * migration 0033 (#57) の担当で、本ファイルには含めない。
 *
 * client は facade が用途に応じて (session 付き server client / service_role client) 選んで渡す。
 * webhook はすべて service ctx で呼ばれるため、実質は service_role client のみが渡ってくる想定だが、
 * 本ファイルは渡された client をそのまま使う (01-crm/repository.ts §1.1 依存規約を踏襲)。
 *
 * 【地雷回避: エラー握り潰し厳禁】DB エラー/例外は Result.ok=false で正確に伝播する。
 * 冪等 INSERT (call_sid / recording_sid / recording_id の unique 制約) は
 * 「INSERT → 23505 捕捉 → 既存行 SELECT」方式に統一する (crm/repository.ts の確立パターン踏襲。
 * 対象 unique index は 3 つとも非部分 — where 句なし — のため NULLS DISTINCT の懸念もない)。
 */

// ============================================================
// 共通: エラー写像
// ============================================================

type PgError = { code?: string; message: string };

/**
 * PostgREST のエラーを Result.code に写像する。
 * 1. 23503 (FK 違反) → KMB-E101 (参照先が存在しない = 入力不正)
 * 2. 42501 (RLS 拒否) → KMB-E202
 * 3. 上記いずれにも該当しなければ KMB-E901 (DB 断・想定外エラー)
 * telephony の 3 テーブルには security definer RPC 由来の埋め込みエラーコード (KMB-Exxx 文字列) は
 * 存在しない (0032 に RPC を含まない — #57 の 0033 で導入予定) ため、crm/repository.ts のような
 * メッセージ埋め込み解析は不要。
 */
function pgErrorToResult(error: PgError): { ok: false; code: KmbErrorCode; detail: string } {
  if (error.code === "23503") {
    return { ok: false, code: "KMB-E101", detail: `参照先が存在しません: ${error.message}` };
  }
  if (error.code === "42501") {
    return { ok: false, code: "KMB-E202", detail: error.message };
  }
  return { ok: false, code: "KMB-E901", detail: error.message };
}

// ============================================================
// calls
// ============================================================

export type CallRow = {
  id: string;
  call_sid: string;
  direction: CallDirection;
  from_e164: string | null;
  from_raw: string | null;
  to_e164: string;
  twilio_status: string; // 外部語彙 (check なし — §2.6)
  handling: CallHandling | null;
  match_status: CallMatchStatus;
  customer_id: string | null;
  duration_seconds: number | null;
  started_at: string;
  ended_at: string | null;
  twilio_cost_estimate_micro_usd: number;
  ai_cost_micro_usd: number;
  memo: string | null;
  created_at: string;
  updated_at: string;
};

export type CallUpsertInput = {
  call_sid: string;
  direction: CallDirection;
  from_e164: string | null;
  from_raw: string | null;
  to_e164: string;
  twilio_status: string;
};

/**
 * voice webhook (root) の calls UPSERT (04-telephony §6.1 手順 2)。
 * call_sid unique 制約による冪等 INSERT — Twilio の同一リクエスト再送では既存行を返す
 * (`created:false`。DB は書き換えない — root webhook の 2 回目以降は業務的に no-op)。
 */
export async function upsertCallOnConflictDoNothing(
  client: SupabaseClient,
  input: CallUpsertInput,
): Promise<Result<{ row: CallRow; created: boolean }>> {
  const { data, error } = await client
    .from("calls")
    .insert(input)
    .select("*")
    .single();
  if (!error) return { ok: true, value: { row: data as CallRow, created: true } };

  if (error.code === "23505") {
    const { data: existing, error: selErr } = await client
      .from("calls")
      .select("*")
      .eq("call_sid", input.call_sid)
      .maybeSingle();
    if (selErr) return pgErrorToResult(selErr);
    if (existing) return { ok: true, value: { row: existing as CallRow, created: false } };
  }
  return pgErrorToResult(error);
}

export async function findCallByCallSid(
  client: SupabaseClient,
  callSid: string,
): Promise<Result<CallRow | null>> {
  const { data, error } = await client
    .from("calls")
    .select("*")
    .eq("call_sid", callSid)
    .maybeSingle();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data as CallRow | null) ?? null };
}

export async function getCallById(
  client: SupabaseClient,
  id: string,
): Promise<Result<CallRow | null>> {
  const { data, error } = await client.from("calls").select("*").eq("id", id).maybeSingle();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data as CallRow | null) ?? null };
}

/**
 * handling 確定の反映 (04-telephony §6.1 手順 5 の voicemail/after_hours_voicemail、
 * および §6.3 手順 3 の missed)。対象行が存在しない場合は KMB-E804 (対象の通話が見つかりません)
 * — webhook route はこれを受けて console.error のうえ 200 で吸収する設計 (facade の責務)。
 */
export async function updateCallHandling(
  client: SupabaseClient,
  callId: string,
  handling: CallHandling,
): Promise<Result<CallRow>> {
  const { data, error } = await client
    .from("calls")
    .update({ handling })
    .eq("id", callId)
    .select("*")
    .maybeSingle();
  if (error) return pgErrorToResult(error);
  if (!data) return { ok: false, code: "KMB-E804", detail: `通話が見つかりません: ${callId}` };
  return { ok: true, value: data as CallRow };
}

export type CallStatusCallbackPatch = {
  twilio_status: string;
  duration_seconds: number | null;
  ended_at: string | null;
  handling?: CallHandling; // handling が null のまま終了した場合のみ 'missed' を渡す (§5.2(b))
  twilio_cost_estimate_micro_usd: number;
};

/**
 * 通話終了 statusCallback の反映 (04-telephony §6.3 手順 2〜4)。
 * 呼び出し元 (facade) が事前に findCallByCallSid で存在確認する想定だが、
 * レース (webhook 同時到達等) に備えて本関数側でも 0 行更新を KMB-E804 として正確に返す
 * (握り潰して ok:true を返さない)。
 */
export async function updateCallOnStatusCallback(
  client: SupabaseClient,
  callId: string,
  patch: CallStatusCallbackPatch,
): Promise<Result<CallRow>> {
  const { data, error } = await client
    .from("calls")
    .update(patch)
    .eq("id", callId)
    .select("*")
    .maybeSingle();
  if (error) return pgErrorToResult(error);
  if (!data) return { ok: false, code: "KMB-E804", detail: `通話が見つかりません: ${callId}` };
  return { ok: true, value: data as CallRow };
}

// ============================================================
// call_recordings
// ============================================================

export type CallRecordingRow = {
  id: string;
  call_id: string;
  recording_sid: string;
  source: CallRecordingSource;
  twilio_url: string;
  duration_seconds: number;
  channels: CallRecordingChannels;
  storage_path: string | null;
  byte_size: number | null;
  twilio_deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CallRecordingInsertInput = {
  call_id: string;
  recording_sid: string;
  source: CallRecordingSource;
  twilio_url: string;
  duration_seconds: number;
  channels: CallRecordingChannels;
};

/**
 * recording-status webhook の call_recordings INSERT (04-telephony §6.4 手順 2)。
 * recording_sid unique 制約による冪等 INSERT (webhook 再配信は既存行を返す。書き換えない)。
 */
export async function insertRecordingOnConflictDoNothing(
  client: SupabaseClient,
  input: CallRecordingInsertInput,
): Promise<Result<{ row: CallRecordingRow; created: boolean }>> {
  const { data, error } = await client
    .from("call_recordings")
    .insert(input)
    .select("*")
    .single();
  if (!error) return { ok: true, value: { row: data as CallRecordingRow, created: true } };

  if (error.code === "23505") {
    const { data: existing, error: selErr } = await client
      .from("call_recordings")
      .select("*")
      .eq("recording_sid", input.recording_sid)
      .maybeSingle();
    if (selErr) return pgErrorToResult(selErr);
    if (existing) return { ok: true, value: { row: existing as CallRecordingRow, created: false } };
  }
  return pgErrorToResult(error);
}

// ============================================================
// call_jobs
// ============================================================

export type CallJobRow = {
  id: string;
  call_id: string;
  recording_id: string;
  status: CallJobStatus;
  transcript: CallTranscript | null;
  analysis: CallAnalysis | null;
  link_result: CallJobLinkResult | null;
  transcript_partial: CallTranscriptCheckpoint | null;
  error_code: string | null;
  ai_cost_micro_usd: number;
  stage_attempts: number;
  lease_expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CallJobInsertInput = {
  call_id: string;
  recording_id: string;
  /** RecordingDuration=0 → 'done' (空 done ジョブ) / RecordingDuration>0 → 'pending' (§6.4 手順 3) */
  status: Extract<CallJobStatus, "pending" | "done">;
};

/**
 * recording-status webhook の call_jobs INSERT (04-telephony §6.4 手順 3〜4)。
 * unique (recording_id) 制約による冪等 INSERT — 既存 job があれば status を書き換えず返す
 * (「既存行の status は書き換えない」— §6.4 手順 4 の明示規約)。
 */
export async function insertCallJobIdempotent(
  client: SupabaseClient,
  input: CallJobInsertInput,
): Promise<Result<{ row: CallJobRow; created: boolean }>> {
  const { data, error } = await client
    .from("call_jobs")
    .insert(input)
    .select("*")
    .single();
  if (!error) return { ok: true, value: { row: data as CallJobRow, created: true } };

  if (error.code === "23505") {
    const { data: existing, error: selErr } = await client
      .from("call_jobs")
      .select("*")
      .eq("recording_id", input.recording_id)
      .maybeSingle();
    if (selErr) return pgErrorToResult(selErr);
    if (existing) return { ok: true, value: { row: existing as CallJobRow, created: false } };
  }
  return pgErrorToResult(error);
}
