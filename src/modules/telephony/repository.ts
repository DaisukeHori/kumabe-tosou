import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Paged, Pagination, Result } from "@/modules/platform/contracts";
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

/**
 * call_jobs の全カラム取得 (04-telephony.md §6.5.3-1/§6.5.4-1 の再入ガード用)。
 *
 * 【地雷回避】`AcquireLeaseRawResult` (migration 0033 `call_job_acquire_lease` の RETURNS TABLE)
 * には `transcript`/`analysis` は含まれるが `link_result`/`transcript_partial` は含まれない
 * (RPC の返却列そのものが DDL レベルでこの 2 列を返さない設計 — 計画書「未解決点#1」参照)。
 * analyzing ステージの再入ガード (`analysis` 参照) と linking ステージの再入ガード
 * (`link_result` 参照) は、acquire の生返り値 `row` だけでは判定できないため、本関数で
 * 追加 SELECT する必要がある (RPC シグネチャ自体は変更しない方針)。
 */
export async function getCallJobById(client: SupabaseClient, jobId: string): Promise<Result<CallJobRow | null>> {
  const { data, error } = await client.from("call_jobs").select("*").eq("id", jobId).maybeSingle();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data as CallJobRow | null) ?? null };
}

// ============================================================
// call_recordings / call_jobs — #58 追加分 (downloading/transcribing/linking ステージ実装用)
// ============================================================

/**
 * call_recordings の単一行取得 (§6.5.1-1 downloading 再入ガード・DL 元 URL 取得用)。
 */
export async function getCallRecordingById(
  client: SupabaseClient,
  id: string,
): Promise<Result<CallRecordingRow | null>> {
  const { data, error } = await client.from("call_recordings").select("*").eq("id", id).maybeSingle();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data as CallRecordingRow | null) ?? null };
}

export type UpdateCallRecordingStoragePatch = {
  storage_path: string;
  byte_size: number;
  /** 省略時は既存値を保持。明示的に渡した場合のみ更新する (§6.5.1-5: 削除完了時刻の反映)。 */
  twilio_deleted_at?: string | null;
};

/**
 * downloading commit 直前の反映 (§6.5.1 手順4/5): Storage 保存後の storage_path/byte_size
 * (+ 設定 ON 時は twilio_deleted_at) を書き込む。対象行が無ければ KMB-E804 (握り潰さない)。
 */
export async function updateCallRecordingStorage(
  client: SupabaseClient,
  recordingId: string,
  patch: UpdateCallRecordingStoragePatch,
): Promise<Result<CallRecordingRow>> {
  const updatePayload: Partial<Pick<CallRecordingRow, "storage_path" | "byte_size" | "twilio_deleted_at">> = {
    storage_path: patch.storage_path,
    byte_size: patch.byte_size,
  };
  if (patch.twilio_deleted_at !== undefined) {
    updatePayload.twilio_deleted_at = patch.twilio_deleted_at;
  }

  const { data, error } = await client
    .from("call_recordings")
    .update(updatePayload)
    .eq("id", recordingId)
    .select("*")
    .maybeSingle();
  if (error) return pgErrorToResult(error);
  if (!data) return { ok: false, code: "KMB-E804", detail: `録音が見つかりません: ${recordingId}` };
  return { ok: true, value: data as CallRecordingRow };
}

/**
 * transcribing のセグメント別チェックポイント追記 (§6.5.2-4(b))。heartbeat 同型の
 * lease 保持中の service 直接 UPDATE — commit RPC は使わない。`lease_expires_at is not null`
 * の行にのみ効く単純 CAS (heartbeatCallJobLease と同型の防御。他プロセスへの横取り防止は
 * acquire/commit の CAS が担うため、本関数自体は排他の主体ではない)。
 */
export async function updateCallJobTranscriptPartial(
  client: SupabaseClient,
  jobId: string,
  checkpoint: CallTranscriptCheckpoint,
): Promise<Result<void>> {
  const { error } = await client
    .from("call_jobs")
    .update({ transcript_partial: checkpoint })
    .eq("id", jobId)
    .not("lease_expires_at", "is", null);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: undefined };
}

/**
 * call_id 単位で call_recordings を全件取得する (§6.5.4-3 の duration_seconds フォールバック用)。
 * 通話 1 本に録音が複数あり得る (転送録音 + フォールバック留守電 — §10-15) ため、当該 job の
 * recording_id だけでなく call_id で全件集計する必要がある (計画書「未解決点#3」の解釈どおり)。
 */
export async function listCallRecordingsByCallId(
  client: SupabaseClient,
  callId: string,
): Promise<Result<CallRecordingRow[]>> {
  const { data, error } = await client.from("call_recordings").select("*").eq("call_id", callId);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data ?? []) as CallRecordingRow[] };
}

export type ReflectLinkResultPatch = {
  customerId: string | null;
  matchStatus: CallMatchStatus;
  aiCostDeltaMicroUsd: number;
};

/**
 * call_id 単位で call_jobs.ai_cost_micro_usd を SUM 集計する (§6.5.4-5「call_jobs の累計を
 * 合算転記」/ migration 0032 §1 の calls.ai_cost_micro_usd 列コメント「通話に紐づく全 call_jobs
 * の AI 実測コスト合算」どおりの再集計)。各 call_jobs 行自身の ai_cost_micro_usd は
 * commitCallJobStage RPC の CAS 経由でのみ更新される (二重計上されない) ため、この SUM は
 * 何度呼び出しても同じ結果になる (冪等)。
 */
async function sumCallJobsAiCostMicroUsd(client: SupabaseClient, callId: string): Promise<Result<number>> {
  const { data, error } = await client.from("call_jobs").select("ai_cost_micro_usd").eq("call_id", callId);
  if (error) return pgErrorToResult(error);
  const rows = (data ?? []) as { ai_cost_micro_usd: number }[];
  return { ok: true, value: rows.reduce((sum, row) => sum + row.ai_cost_micro_usd, 0) };
}

/**
 * linking 手順5 (§6.5.4-5): calls への customer_id/match_status/ai_cost_micro_usd 反映。
 *
 * 【手動確定保護ガード (§5.2.2 v1.1 不変条件 — 敵対レビュー BLOCKER 対応)】反映前に現在値を読み、
 * canonical §6.5.4-5 が明示する OR 条件のとおり `match_status='manual'` **または**
 * `customer_id が非 null かつ match_status != 'pending'` (= 既に matched/created で確定済み) の
 * いずれかに該当する場合は customer_id/match_status を上書きせず ai_cost_micro_usd の反映のみ
 * 行い `{skipped:true}` を返す。後者の条件は 1 通話に複数 call_jobs (転送録音 + 留守電フォール
 * バック等 — §10-15) が存在し得ることへの保護であり、先に完了した job の matched/created 結果を
 * 後発 job が ambiguous/別顧客で上書きする事故を防ぐ (`match_status==='manual'` だけを見ると
 * この二重ジョブレースを素通ししてしまう — BLOCKER 指摘の核心)。manual 以外かつ未確定
 * (customer_id null または match_status='pending'。ambiguous/no_number も customer_id は常に
 * null — §5.2.2 不変条件 — のためこの分岐に該当し、自動再解決の余地を残す) の場合は 3 列を
 * 一括更新し `{skipped:false}` を返す。この読取→分岐→更新はレース的に完全排他ではない
 * (read-then-write) が、admin 手動操作との衝突は実運用上まれなため許容する
 * (計画書 §5.2.2 の設計判断どおり)。
 *
 * 【ai_cost_micro_usd の冪等反映 (敵対レビュー MAJOR 対応)】旧実装は `current.ai_cost_micro_usd +
 * patch.aiCostDeltaMicroUsd` の加算方式だったため、reflectLinkResultToCalls 成功直後・
 * commitCallJobStage (linking→done) 成功前にプロセスがクラッシュすると call_jobs.link_result は
 * 未確定のまま lease が失効し、次起床で handleLinking がゼロから再実行されて同じ delta が
 * 二重加算されてしまっていた (call_jobs 側の commit は CAS 保護されるが calls 側の加算は保護
 * されていなかったため)。本関数は patch.aiCostDeltaMicroUsd を現在値へ加算するのではなく、
 * `sumCallJobsAiCostMicroUsd` で call_id に紐づく全 call_jobs.ai_cost_micro_usd を都度 SUM
 * 再集計して書き込む方式に変更した — 再集計は何度呼び出しても同じ結果になる (冪等) ため、
 * 上記クラッシュ再入シナリオでも二重加算が起きない。`patch.aiCostDeltaMicroUsd` は worker.ts
 * 側の呼び出しインターフェース互換のため型に残すが、本関数はこの値を使わない
 * (呼び出し側の改修を避けつつ挙動は SUM 集計を正とする意図的な設計)。
 */
export async function reflectLinkResultToCalls(
  client: SupabaseClient,
  callId: string,
  patch: ReflectLinkResultPatch,
): Promise<Result<{ skipped: boolean }>> {
  const currentResult = await getCallById(client, callId);
  if (!currentResult.ok) return currentResult;
  const current = currentResult.value;
  if (!current) return { ok: false, code: "KMB-E804", detail: `通話が見つかりません: ${callId}` };

  const totalCostResult = await sumCallJobsAiCostMicroUsd(client, callId);
  if (!totalCostResult.ok) return totalCostResult;
  const nextAiCostMicroUsd = totalCostResult.value;

  const isProtected = current.match_status === "manual" || (current.customer_id !== null && current.match_status !== "pending");

  if (isProtected) {
    const { error } = await client
      .from("calls")
      .update({ ai_cost_micro_usd: nextAiCostMicroUsd })
      .eq("id", callId);
    if (error) return pgErrorToResult(error);
    return { ok: true, value: { skipped: true } };
  }

  const { error } = await client
    .from("calls")
    .update({
      customer_id: patch.customerId,
      match_status: patch.matchStatus,
      ai_cost_micro_usd: nextAiCostMicroUsd,
    })
    .eq("id", callId);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: { skipped: false } };
}

// ============================================================
// calls — 一覧 / 詳細 / 集計 (#59: TelephonyFacade 契約外拡張 listCalls / getCallDetail /
// linkCallToCustomer / getTelephonySetupStatus / getCallAlertCounts の実データ源。
// 04-telephony.md §7.2 / §8.1 / §8.4)
// ============================================================

type StartedAtCursor = { startedAt: string; id: string };

function encodeStartedAtCursor(c: StartedAtCursor): string {
  return Buffer.from(JSON.stringify(c), "utf-8").toString("base64url");
}

function decodeStartedAtCursor(raw: string | null | undefined): StartedAtCursor | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf-8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { startedAt?: unknown }).startedAt === "string" &&
      typeof (parsed as { id?: unknown }).id === "string"
    ) {
      return parsed as StartedAtCursor;
    }
    return null;
  } catch {
    return null;
  }
}

function pageByStartedAt<Row extends { started_at: string; id: string }>(
  rows: Row[],
  limit: number,
): Paged<Row> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last ? encodeStartedAtCursor({ startedAt: last.started_at, id: last.id }) : null;
  return { items, next_cursor: nextCursor };
}

export type ListCallsFilter = {
  handling?: CallHandling;
  needsReview?: boolean;
  jobFailed?: boolean;
};

/**
 * job_error_code/job_analysis は任意 (省略可) — listCallsPage 経由のみ populate する
 * (§8.1 一覧の error_code ツールチップ/要約冒頭40字用)。getCallDetail 側の toCallListItem
 * 呼び出しは job_status のみで足りるため、この 2 フィールドを省略しても型エラーにならない
 * (facade.ts の toCallListItemView だけがこの 2 フィールドを読む)。
 */
export type CallListRow = CallRow & {
  job_status: CallJobStatus | null;
  job_error_code?: string | null;
  job_analysis?: CallAnalysis | null;
};

/**
 * /admin/calls 一覧 (04-telephony.md §7.2 listCalls / §8.1)。keyset (started_at desc, id desc)。
 *
 * 【地雷回避 — 計画書必須要件】1 通話に複数 call_jobs があり得る (転送録音 + 留守電フォール
 * バック等 — §10-15)。「処理状態」列は最新 job (created_at 降順の先頭) の status を表示する
 * 規約 (§8.1)。この集約は 2 クエリ構成で行う:
 *   1) calls を keyset + フィルタで先にページング確定する。`jobFailed` フィルタは
 *      call_jobs.status='failed' を持つ call_id の集合を事前に取得し `.in("id", ...)` で
 *      絞り込む (embedded resource の inner join フィルタに頼ると同一 call が複数の
 *      matching job を持つ場合の重複排除挙動が PostgREST バージョン依存で不安定なため、
 *      素直な 2 段クエリに倒す)。`needsReview` (match_status='ambiguous') と `handling` は
 *      calls 自身の列なので直接 `.eq()` で絞る。**JS 側の後絞りはしない** — post-filter だと
 *      「keyset で ちょうど limit 件(+1)」の保証が崩れ、実際は 50 件超が存在するのに
 *      画面が「これで全件」と誤表示する地雷になる (計画書で名指し警告)。
 *   2) ページ内の call_id 集合に対してのみ call_jobs (call_id/status/created_at) を取得し、
 *      call_id ごとに created_at 降順の先頭を job_status として採用する
 *      (ページサイズ ≤50 件 × ジョブ数なので N+1 querying の懸念はない)。
 *
 * 【判断根拠 — openIssues 記載】`jobFailed=true` は「その通話が持つ call_jobs のうち
 * いずれか 1 つでも failed があれば一致」とする (最新 job だけが failed の場合に限定しない)。
 * 複数ジョブ (§10-15) のうち過去の 1 本が failed のまま残っていれば admin が気付けるべき
 * という「見落としを作らない」安全側の解釈 (エラー握り潰し厳禁の精神を一覧フィルタにも適用)。
 */
export async function listCallsPage(
  client: SupabaseClient,
  filter: ListCallsFilter,
  pagination: Pagination,
): Promise<Result<Paged<CallListRow>>> {
  let failedCallIds: string[] | null = null;
  if (filter.jobFailed) {
    const { data, error } = await client.from("call_jobs").select("call_id").eq("status", "failed");
    if (error) return pgErrorToResult(error);
    failedCallIds = [...new Set((data ?? []).map((r) => (r as { call_id: string }).call_id))];
    if (failedCallIds.length === 0) {
      return { ok: true, value: { items: [], next_cursor: null } };
    }
  }

  let query = client
    .from("calls")
    .select("*")
    .order("started_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pagination.limit + 1);

  if (filter.handling) {
    query = query.eq("handling", filter.handling);
  }
  if (filter.needsReview) {
    query = query.eq("match_status", "ambiguous");
  }
  if (failedCallIds) {
    query = query.in("id", failedCallIds);
  }

  const cursor = decodeStartedAtCursor(pagination.cursor);
  if (cursor) {
    query = query.or(
      `started_at.lt.${cursor.startedAt},and(started_at.eq.${cursor.startedAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) return pgErrorToResult(error);
  const calls = (data ?? []) as CallRow[];
  if (calls.length === 0) {
    return { ok: true, value: { items: [], next_cursor: null } };
  }

  const callIds = calls.map((c) => c.id);
  // error_code/analysis も同じクエリで併せて取得する (§8.1 一覧の error_code ツールチップ/
  // 要約冒頭40字。job_status と同じ「call_id 昇順・created_at 降順」の先頭行 = 最新 job から
  // 採る一貫した規約 — 追加のクエリ往復は発生しない)。
  const { data: jobRows, error: jobError } = await client
    .from("call_jobs")
    .select("call_id,status,error_code,analysis,created_at")
    .in("call_id", callIds)
    .order("call_id", { ascending: true })
    .order("created_at", { ascending: false });
  if (jobError) return pgErrorToResult(jobError);

  type LatestJob = { status: CallJobStatus; error_code: string | null; analysis: CallAnalysis | null };
  const latestJobByCallId = new Map<string, LatestJob>();
  for (const row of (jobRows ?? []) as {
    call_id: string;
    status: CallJobStatus;
    error_code: string | null;
    analysis: CallAnalysis | null;
    created_at: string;
  }[]) {
    if (!latestJobByCallId.has(row.call_id)) {
      latestJobByCallId.set(row.call_id, { status: row.status, error_code: row.error_code, analysis: row.analysis });
    }
  }

  const rows: CallListRow[] = calls.map((c) => {
    const latest = latestJobByCallId.get(c.id);
    return {
      ...c,
      job_status: latest?.status ?? null,
      job_error_code: latest?.error_code ?? null,
      job_analysis: latest?.analysis ?? null,
    };
  });

  return { ok: true, value: pageByStartedAt(rows, pagination.limit) };
}

/**
 * call_id 単位で call_jobs 全件取得 (getCallDetail の処理状態フッタ・linkCallToCustomer の
 * 議事録参照用 — §8.2-7/§7.2)。created_at 昇順 (時系列表示。「最新」の判定は呼び出し側が
 * created_at を見て行う — 配列順序に依存させない)。
 */
export async function listCallJobsByCallId(client: SupabaseClient, callId: string): Promise<Result<CallJobRow[]>> {
  const { data, error } = await client
    .from("call_jobs")
    .select("*")
    .eq("call_id", callId)
    .order("created_at", { ascending: true });
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data ?? []) as CallJobRow[] };
}

/** §7.2/§8.4 getCallAlertCounts.failed: call_jobs.status='failed' の件数。 */
export async function countFailedCallJobs(client: SupabaseClient): Promise<Result<number>> {
  const { count, error } = await client
    .from("call_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed");
  if (error) return pgErrorToResult(error);
  return { ok: true, value: count ?? 0 };
}

/** §7.2/§8.4 getCallAlertCounts.needsReview: calls.match_status='ambiguous' の件数。 */
export async function countAmbiguousCalls(client: SupabaseClient): Promise<Result<number>> {
  const { count, error } = await client
    .from("calls")
    .select("id", { count: "exact", head: true })
    .eq("match_status", "ambiguous");
  if (error) return pgErrorToResult(error);
  return { ok: true, value: count ?? 0 };
}

/** stale 判定の閾値 (§7.2: 非終端 call_jobs のうち created_at < now()-30分)。 */
const STALE_CALL_JOB_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * §7.2 の明示規約: 「getTelephonySetupStatus.staleJobs = getCallAlertCounts.stalled と
 * 同一 query」— 実装を分岐させないため本関数を両メソッドから共有する。
 */
export async function countStaleCallJobs(client: SupabaseClient): Promise<Result<number>> {
  const staleBefore = new Date(Date.now() - STALE_CALL_JOB_THRESHOLD_MS).toISOString();
  const { count, error } = await client
    .from("call_jobs")
    .select("id", { count: "exact", head: true })
    .in("status", [...CALL_JOB_RUNNABLE_STATUSES])
    .lt("created_at", staleBefore);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: count ?? 0 };
}

/**
 * linkCallToCustomer (§7.2) の calls CAS UPDATE。楽観排他は updated_at の生文字列比較
 * (`.eq("updated_at", expectedUpdatedAt)`) — `new Date()` を経由すると精度落ちで恒久的に
 * 不一致になる地雷 (settings/actions.ts・crm/repository.ts の CAS 実装と同じ注意書き)。
 * crm/repository.ts の `updateRowWithCas` と同型実装だが、telephony から crm/repository を
 * 直 import することは ESLint MODULES 境界で禁止されているため同型実装をここに複製する
 * (契約書 §1.2「repository は各モジュール専属」規約どおり重複を許容)。
 *
 * customerId=null (紐づけ解除) も許容する (§5.2.2 v1.1 不変条件: manual は customer_id null 可 =
 * 「手動介入済み・未紐づけ」)。0 行更新は「対象不存在 (KMB-E804)」と「CAS 不一致 (KMB-E103)」の
 * 2 パターンがあり得るため、追加の存在確認で判別する (握り潰して一方に決め打ちしない)。
 */
export async function linkCallToCustomerRow(
  client: SupabaseClient,
  callId: string,
  customerId: string | null,
  expectedUpdatedAt: string,
): Promise<Result<CallRow>> {
  const { data, error } = await client
    .from("calls")
    .update({ customer_id: customerId, match_status: "manual" })
    .eq("id", callId)
    .eq("updated_at", expectedUpdatedAt)
    .select("*")
    .maybeSingle();
  if (error) return pgErrorToResult(error);
  if (data) return { ok: true, value: data as CallRow };

  const { data: existing, error: existErr } = await client
    .from("calls")
    .select("id")
    .eq("id", callId)
    .maybeSingle();
  if (existErr) return pgErrorToResult(existErr);
  if (!existing) {
    return { ok: false, code: "KMB-E804", detail: `通話が見つかりません: ${callId}` };
  }
  return {
    ok: false,
    code: "KMB-E103",
    detail: "他の操作で更新されています。再読み込みしてやり直してください。",
  };
}

/**
 * メモ欄保存 (§8.2-8 / calls.memo)。楽観排他は updated_at の生文字列比較
 * (linkCallToCustomerRow と同型 CAS パターン)。
 *
 * 【判断根拠 — 計画書 issue-59.md 未解決点#2 の実装時判断】canonical 04-telephony.md §7.4 の
 * Server Actions 表には saveCallMemoAction 相当の記載が無い (§8.2-8「メモ欄 (calls.memo。
 * textarea + 保存 — 楽観排他)」との記載漏れ)。データ損失なし・機能を壊さない安全側の解釈として
 * 「§8.2 本文が明示要求する機能は実装する」を採用し、telephony facade/repository に本関数と
 * facade.saveCallMemo を追加する。0 行更新は対象不存在 (KMB-E804) と CAS 不一致 (KMB-E103) の
 * 2 パターンがあり得るため、linkCallToCustomerRow と同じ「事後 SELECT で判別」方式を踏襲する。
 */
export async function updateCallMemo(
  client: SupabaseClient,
  callId: string,
  memo: string | null,
  expectedUpdatedAt: string,
): Promise<Result<CallRow>> {
  const { data, error } = await client
    .from("calls")
    .update({ memo })
    .eq("id", callId)
    .eq("updated_at", expectedUpdatedAt)
    .select("*")
    .maybeSingle();
  if (error) return pgErrorToResult(error);
  if (data) return { ok: true, value: data as CallRow };

  const { data: existing, error: existErr } = await client
    .from("calls")
    .select("id")
    .eq("id", callId)
    .maybeSingle();
  if (existErr) return pgErrorToResult(existErr);
  if (!existing) {
    return { ok: false, code: "KMB-E804", detail: `通話が見つかりません: ${callId}` };
  }
  return {
    ok: false,
    code: "KMB-E103",
    detail: "他の操作で更新されています。再読み込みしてやり直してください。",
  };
}
