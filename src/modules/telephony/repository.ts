import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Result } from "@/modules/platform/contracts";
import { KMB_ERRORS, type KmbErrorCode } from "@/modules/platform/errors";

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
import { CALL_JOB_LEASE_TTL_MS, type AcquireLeaseRawResult } from "./internal/lease";
import { CALL_JOB_RUNNABLE_STATUSES } from "./internal/stage-machine";

/**
 * telephony モジュールの repository。calls / call_recordings / call_jobs への**唯一の**
 * 直接クエリ経路 (04-telephony.md §1.2 — facade.ts のみがここを import する)。
 *
 * #56 (DDL+契約+repository) のスコープは 3 webhook (voice/status/recording-status) の
 * INSERT/UPDATE/SELECT のみだった。#57 (本 Issue) で migration 0033 の lease/commit/retry RPC
 * (call_job_acquire_lease / call_job_commit_stage / call_job_retry) ラッパーと heartbeat 直
 * UPDATE・due job 一覧取得を追加した (下記「call_jobs — lease / commit / retry RPC」節)。
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

const KMB_ERROR_CODE_RE = /KMB-E\d+/;

/**
 * PostgREST/RPC のエラーを Result.code に写像する。
 * 1. メッセージに埋め込まれた `KMB-Exxx` を最優先で拾う (migration 0033 §2.3 の
 *    `call_job_retry` RPC が `raise exception 'KMB-E807: ...'` するため必須 —
 *    crm/repository.ts の埋め込みコード解析パターンと同型。0032 単体の 3 テーブル操作には
 *    埋め込みコードは出現しないが、0033 の RPC 経路は必ずこの分岐を通る)
 * 2. is_admin_or_service() ガード系 RPC の定型メッセージ ("permission denied: ...") は KMB-E202
 * 3. Postgres エラーコードによる既定写像 (23503 FK違反 / 42501 RLS拒否)
 * 4. 上記いずれにも該当しなければ KMB-E901 (DB 断・想定外エラー)
 */
function pgErrorToResult(error: PgError): { ok: false; code: KmbErrorCode; detail: string } {
  const embedded = KMB_ERROR_CODE_RE.exec(error.message)?.[0];
  if (embedded && Object.prototype.hasOwnProperty.call(KMB_ERRORS, embedded)) {
    return { ok: false, code: embedded as KmbErrorCode, detail: error.message };
  }
  if (error.message.startsWith("permission denied")) {
    return { ok: false, code: "KMB-E202", detail: error.message };
  }
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

// ============================================================
// call_jobs — lease / commit / retry RPC (migration 20260711000033、#57)
// ============================================================

/**
 * migration 0033 `call_job_acquire_lease` RPC (§2.3 lease 取得 CAS)。
 * 返り値は判別共用体変換前の生の行 (RPC は not_found でも `result_kind='not_found'` の
 * プレースホルダ行を必ず 1 行返す)。分岐は internal/lease.ts の `interpretAcquireLeaseResult()`
 * に委ねる (本関数は RPC 呼び出しと Result 化のみを担う)。
 */
export async function acquireCallJobLease(
  client: SupabaseClient,
  jobId: string,
): Promise<Result<AcquireLeaseRawResult>> {
  const { data, error } = await client.rpc("call_job_acquire_lease", { p_job_id: jobId });
  if (error) return pgErrorToResult(error);
  const row = Array.isArray(data) ? data[0] : data;
  return { ok: true, value: (row ?? null) as AcquireLeaseRawResult };
}

/**
 * heartbeat (§2.3 末尾: lease 延長は RPC 化せず worker が直接 UPDATE する設計)。
 * `lease_expires_at is not null` の行にのみ効く単純 CAS — lease が既に解放/失効している行を
 * 誤って再取得済みにしてしまうことはない。worker が 20 秒毎に呼ぶ (ベストエフォート)。
 */
export async function heartbeatCallJobLease(client: SupabaseClient, jobId: string): Promise<Result<void>> {
  const leaseExpiresAt = new Date(Date.now() + CALL_JOB_LEASE_TTL_MS).toISOString();
  const { error } = await client
    .from("call_jobs")
    .update({ lease_expires_at: leaseExpiresAt })
    .eq("id", jobId)
    .not("lease_expires_at", "is", null);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: undefined };
}

export type CommitCallJobStageInput = {
  jobId: string;
  expectedStatus: CallJobStatus;
  nextStatus: CallJobStatus;
  transcript?: CallTranscript | null;
  analysis?: CallAnalysis | null;
  linkResult?: CallJobLinkResult | null;
  aiCostDeltaMicroUsd?: number | null;
  errorCode?: string | null;
};

/**
 * migration 0033 `call_job_commit_stage` RPC (§2.3 commit — CAS + 成果物 UPSERT + status 前進 +
 * lease 解放 + stage_attempts=0 リセットを単一 UPDATE で原子的に行う)。CAS 不一致 (他の試行が
 * 既に commit 済み) の場合は RPC 側が現在値を冪等に返すだけなのでエラー扱いにしない
 * (呼び出し側は返り値の status をそのまま信用してよい)。
 */
export async function commitCallJobStage(
  client: SupabaseClient,
  input: CommitCallJobStageInput,
): Promise<Result<CallJobStatus>> {
  const { data, error } = await client.rpc("call_job_commit_stage", {
    p_job_id: input.jobId,
    p_expected_status: input.expectedStatus,
    p_next_status: input.nextStatus,
    p_transcript: input.transcript ?? null,
    p_analysis: input.analysis ?? null,
    p_link_result: input.linkResult ?? null,
    p_ai_cost_delta_micro_usd: input.aiCostDeltaMicroUsd ?? null,
    p_error_code: input.errorCode ?? null,
  });
  if (error) return pgErrorToResult(error);
  return { ok: true, value: data as CallJobStatus };
}

/**
 * `call_job_retry` RPC が KMB-E807 を raise した場合にのみ呼ぶ軽量な存在確認
 * (retryCallJobRpc 専用の内部ヘルパー)。RPC 自体は「対象が存在しない」場合と
 * 「status!=failed」場合をどちらも `raise exception 'KMB-E807: ...'` の同一経路で扱う
 * (migration 0033 §2.3 SQL コメント参照 — CAS/lease の実処理には無関係な単純 UPDATE のため、
 * この分岐そのものは RPC 側の意図的な設計。0019 教訓の対象である CAS/attempts リセットには
 * 触れない)。しかし 04-telephony.md §7.1 D8 契約表は retryCallJob について「E807(failed以外) /
 * E804(不存在 — RPC 例外を E807 と区別して変換)」を明示的に要求しているため、KMB-E807 の
 * ケースに限って対象行の存在を追加で SELECT 確認し、存在しなければ E804 へ変換する。
 *
 * 【地雷回避】この確認は KMB-E807 のときだけ行う。call_jobs の SELECT RLS
 * (`call_jobs_admin_select`) は admin 限定 — 非 admin authenticated からの呼び出しは
 * permission denied (→ KMB-E202) で RPC 自体が失敗するが、もしここで無条件に存在確認を
 * 行うと「RLS で行が見えない」を「行が存在しない」と誤認し、正しい E202 を E804 に
 * すり替えてしまう。KMB-E807 のみに絞ることでこの誤変換を避ける
 * (admin/service は SELECT RLS を通過 or バイパスするため正しく判定できる)。
 */
async function callJobRowExists(client: SupabaseClient, jobId: string): Promise<Result<boolean>> {
  const { data, error } = await client.from("call_jobs").select("id").eq("id", jobId).maybeSingle();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: data !== null };
}

/**
 * migration 0033 `call_job_retry` RPC (§2.3 再実行 — `failed` → `pending` のみ許可)。
 * RPC が成功すればそのまま返す。RPC が KMB-E807 で失敗した場合は `callJobRowExists` で
 * 対象行の存在を確認し、存在しなければ E804 (04-telephony.md §7.1 D8 契約表) へ変換する。
 * 存在すれば (= 本当に failed 以外) そのまま E807 を返す。存在確認クエリ自体が失敗した場合、
 * および KMB-E807 以外のエラー (E202 の permission denied 等) は (握り潰さず) 元のエラーを
 * そのまま `pgErrorToResult` で変換する — 存在有無を確定できないまま KMB-E804 を騙ることはしない。
 */
export async function retryCallJobRpc(client: SupabaseClient, jobId: string): Promise<Result<CallJobStatus>> {
  const { data, error } = await client.rpc("call_job_retry", { p_job_id: jobId });
  if (!error) return { ok: true, value: data as CallJobStatus };

  const mapped = pgErrorToResult(error);
  if (mapped.code !== "KMB-E807") return mapped;

  const existsResult = await callJobRowExists(client, jobId);
  if (existsResult.ok && existsResult.value === false) {
    return { ok: false, code: "KMB-E804", detail: `通話ジョブが見つかりません: ${jobId}` };
  }
  return mapped;
}

export type DueCallJobRow = { id: string };

/**
 * POST /api/jobs/telephony (§7.3) の due job 選定: 非終端 status かつ lease 未保持/失効の
 * ジョブを created_at 昇順で最大 limit 件返す。ここで返る id は「候補」に過ぎず、実際の
 * 排他取得 (CAS) は advanceCallJob → acquireCallJobLease の FOR UPDATE 行ロックが担う
 * (同時起床した複数プロセスが同じ候補を拾っても、後着はここで held/exhausted に落ちるだけで
 * 二重処理にはならない)。
 */
export async function listDueCallJobs(client: SupabaseClient, limit: number): Promise<Result<DueCallJobRow[]>> {
  const nowIso = new Date().toISOString();
  const { data, error } = await client
    .from("call_jobs")
    .select("id")
    .in("status", [...CALL_JOB_RUNNABLE_STATUSES])
    .or(`lease_expires_at.is.null,lease_expires_at.lt.${nowIso}`)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data ?? []) as DueCallJobRow[] };
}
