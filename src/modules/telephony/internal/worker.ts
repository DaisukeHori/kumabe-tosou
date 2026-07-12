import "server-only";

import { z } from "zod";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { aiProvidersFacade } from "@/modules/ai-providers/facade";
import { crmFacade } from "@/modules/crm/facade";
import type { Result } from "@/modules/platform/contracts";
import { settingsFacade } from "@/modules/settings/facade";

import {
  zCallAnalysis,
  zCallTranscript,
  type CallAnalysis,
  type CallJobLinkResult,
  type CallJobStatus,
  type CallMinutes,
  type CallTranscript,
} from "../contracts";
import { formatCostEstimateJpy } from "./cost";
import {
  CALL_JOB_HEARTBEAT_INTERVAL_MS,
  CALL_JOB_MAX_ATTEMPTS,
  TELEPHONY_WAKE_SOFT_BUDGET_MS,
  TELEPHONY_WORKER_MAX_JOBS_PER_WAKE,
  TRANSCRIBE_SEGMENT_WORST_MS,
  interpretAcquireLeaseResult,
  type AcquireLeaseRawResult,
} from "./lease";
import {
  buildAnalysisPrompt,
  CALL_ANALYSIS_SYSTEM_PROMPT,
  formatDuration,
  TERMINOLOGY_PROMPT,
  type CallAnalysisMeta,
} from "./prompts";
import {
  acquireCallJobLease,
  commitCallJobStage,
  getCallById,
  getCallJobById,
  getCallRecordingById,
  heartbeatCallJobLease,
  listCallRecordingsByCallId,
  listDueCallJobs,
  reflectLinkResultToCalls,
  updateCallJobTranscriptPartial,
  updateCallRecordingStorage,
  type CallRecordingRow,
  type CommitCallJobStageInput,
} from "../repository";
import { segmentCallRecording, type AudioSegment } from "./segmenter";
import { DEFAULT_TELEPHONY_SETTINGS, type TelephonySettings } from "./settings-defaults";
import { deleteRecording, downloadRecording } from "./twilio-api";

/**
 * call_jobs の worker 制御フロー (canonical: docs/design/crm-suite/04-telephony.md §6.5 共通則 /
 * §7.1 D8 エラー表)。src/modules/ai-studio/facade.ts の `advanceRunDetailed` + `runOneStage`
 * パターンを踏襲しつつ、telephony は ExecutionContext 分岐 (session/service) を facade.ts 側に
 * 残すため「resolve 済みの client を受け取る」形にしている (facade.ts の既存 `resolveDbClient`
 * を再利用するため — 重複実装を避ける)。
 *
 * `advanceCallJob(client, jobId)` は **1 呼び出し = 1 ステージ**:
 *   1. `repository.acquireCallJobLease` (migration 0033 `call_job_acquire_lease` RPC) で
 *      生の行を CAS 取得
 *   2. `interpretAcquireLeaseResult` で判別 (not_found / held / exhausted / terminal / acquired)
 *      — held/terminal は D8 の規約どおりエラーにせず ok:true で現在の status を返す
 *   3. acquired のみ heartbeat タイマーを開始 (20 秒毎・ベストエフォート) →
 *      `STAGE_HANDLERS` でステージ dispatch
 *   4. finally で必ず heartbeat タイマーを止める (dispatch が例外を投げても取り残さない)
 *
 * #57 のスコープは lease/commit/retry の制御フローのみ (Issue Out: 録音DL・転写・AI議事録・
 * CRM連携の実処理)。#58 (本ファイルの下半分) で 4 ステージの実処理 (downloading/transcribing/
 * analyzing/linking) を実装した。各ステージの**確定エラー**は commit(next='failed', error_code)
 * で即終了、**不確定エラー** (ネットワーク断・予算超過以外の AI 失敗等) は commit を呼ばずに
 * return する (lease は自然失効し、次起床で同じ stage が再試行される — §5.1 不変条件 6。
 * 3 回失敗すると acquire 自身が stage_attempts>=3 を検知して exhausted (KMB-E806) に倒す)。
 */

export type CallStageHandlerArgs = {
  client: SupabaseClient;
  jobId: string;
  /** acquire で取得済みの行 (pending→downloading の bootstrap 後の status を含む)。 */
  row: NonNullable<AcquireLeaseRawResult>;
};

/**
 * ステージ 1 個分の実処理を担うハンドラの型。#58 は `STAGE_HANDLERS` の該当キーをこの型を
 * 満たす実装に差し替えるだけでよい (advanceCallJob 本体には手を入れない)。
 */
export type CallStageHandler = (args: CallStageHandlerArgs) => Promise<Result<{ status: CallJobStatus }>>;

const DISPATCHABLE_STAGES = ["downloading", "transcribing", "analyzing", "linking"] as const;
type DispatchableStage = (typeof DISPATCHABLE_STAGES)[number];

function isDispatchableStage(status: CallJobStatus): status is DispatchableStage {
  return (DISPATCHABLE_STAGES as readonly string[]).includes(status);
}

// ============================================================
// 共通ヘルパー (#58)
// ============================================================

const CALL_AUDIO_BUCKET = "call-audio";
/** §6.5.1 手順3: メモリ保護 (8kHz/16bit stereo で約100分相当 — 実運用で到達しない)。 */
const DOWNLOAD_MAX_BYTES = 200_000_000;

/** telephony 設定を service ctx で読み、未設定/取得失敗は既定値へ degrade する (§6.1 手順3 踏襲)。 */
async function resolveTelephonySettings(): Promise<TelephonySettings> {
  const result = await settingsFacade.get("telephony", { mode: "service" });
  return result.ok ? result.value : DEFAULT_TELEPHONY_SETTINGS;
}

/** commitCallJobStage を呼び、CallStageHandler の戻り値形 (`Result<{status}>`) に変換する。 */
async function commitAdvance(
  client: SupabaseClient,
  jobId: string,
  input: Omit<CommitCallJobStageInput, "jobId">,
): Promise<Result<{ status: CallJobStatus }>> {
  const result = await commitCallJobStage(client, { jobId, ...input });
  if (!result.ok) return result;
  return { ok: true, value: { status: result.value } };
}

// ============================================================
// §6.5.1 downloading
// ============================================================

const handleDownloading: CallStageHandler = async ({ client, jobId, row }) => {
  const recordingResult = await getCallRecordingById(client, row.recording_id);
  if (!recordingResult.ok) return recordingResult;
  const recording = recordingResult.value;
  if (!recording) {
    return { ok: false, code: "KMB-E804", detail: `録音が見つかりません: ${row.recording_id}` };
  }

  // 再入ガード (§6.5.1 手順1): 前回クラッシュが commit 直前だった場合、DL をスキップして
  // 前進のみ行う。
  if (recording.storage_path !== null) {
    return commitAdvance(client, jobId, { expectedStatus: "downloading", nextStatus: "transcribing" });
  }

  const downloadResult = await downloadRecording(recording.twilio_url);
  if (!downloadResult.ok) return downloadResult; // 不確定 (ネットワーク断等) — attempts 経由で再試行

  if ("notFound" in downloadResult.value) {
    // 最終試行の検知 (§5.1 不変条件8): この試行が最後 (stage_attempts が CALL_JOB_MAX_ATTEMPTS)
    // なら worker 自身が確定させる (E805/E806 の使い分けを成立させる唯一の経路 — worker は
    // 404 回数を保持しないため)。それ以外は Twilio 側の録音生成遅延の可能性があるため不確定 return。
    if (row.stage_attempts >= CALL_JOB_MAX_ATTEMPTS) {
      return commitAdvance(client, jobId, {
        expectedStatus: "downloading",
        nextStatus: "failed",
        errorCode: "KMB-E805",
      });
    }
    return { ok: true, value: { status: row.status } };
  }

  const { bytes, contentType } = downloadResult.value;
  if (bytes.length > DOWNLOAD_MAX_BYTES) {
    return commitAdvance(client, jobId, {
      expectedStatus: "downloading",
      nextStatus: "failed",
      errorCode: "KMB-E805",
    });
  }

  const storagePath = `${row.call_id}/${recording.recording_sid}.wav`;
  const uploadResult = await client.storage
    .from(CALL_AUDIO_BUCKET)
    .upload(storagePath, Buffer.from(bytes), { contentType, upsert: true });
  if (uploadResult.error) {
    return { ok: false, code: "KMB-E805", detail: `録音の Storage 保存に失敗しました: ${uploadResult.error.message}` };
  }

  const storageUpdateResult = await updateCallRecordingStorage(client, recording.id, {
    storage_path: storagePath,
    byte_size: bytes.length,
  });
  if (!storageUpdateResult.ok) return storageUpdateResult;

  const telephonySettings = await resolveTelephonySettings();
  if (telephonySettings.delete_twilio_recording_after_download) {
    // ベストエフォート (§6.5.1 手順5) — 失敗しても twilio_deleted_at が null のまま前進する。
    const deleteResult = await deleteRecording(recording.twilio_url);
    if (deleteResult.ok) {
      const markDeletedResult = await updateCallRecordingStorage(client, recording.id, {
        storage_path: storagePath,
        byte_size: bytes.length,
        twilio_deleted_at: new Date().toISOString(),
      });
      if (!markDeletedResult.ok) {
        console.warn(
          `KMB-E805: 録音削除後の twilio_deleted_at 反映に失敗しました (recording=${recording.id})`,
          markDeletedResult.code,
          markDeletedResult.detail,
        );
      }
    }
  }

  return commitAdvance(client, jobId, { expectedStatus: "downloading", nextStatus: "transcribing" });
};

// ============================================================
// §6.5.2 transcribing
// ============================================================

async function callTranscribeSegment(jobId: string, recording: CallRecordingRow, segment: AudioSegment) {
  return aiProvidersFacade.transcribe(
    {
      feature: "call-transcribe",
      filename: `${recording.recording_sid}-c${segment.channel}-s${segment.index}.wav`,
      audioBase64: Buffer.from(segment.wavBytes).toString("base64"),
      prompt: TERMINOLOGY_PROMPT,
      refTable: "call_jobs",
      refId: jobId,
    },
    { mode: "service" },
  );
}

const handleTranscribing: CallStageHandler = async ({ client, jobId, row }) => {
  // 再入ガード (§6.5.2 手順1): transcript が既に確定済みなら次ステージへ前進するのみ。
  if (row.transcript !== null) {
    const transcript = zCallTranscript.parse(row.transcript);
    return commitAdvance(client, jobId, { expectedStatus: "transcribing", nextStatus: "analyzing", transcript });
  }

  const wakeStartedAt = Date.now();

  const recordingResult = await getCallRecordingById(client, row.recording_id);
  if (!recordingResult.ok) return recordingResult;
  const recording = recordingResult.value;
  if (!recording) {
    return { ok: false, code: "KMB-E804", detail: `録音が見つかりません: ${row.recording_id}` };
  }

  // 処理上限 (§6.5.2 手順2): 録音は保存済みで再生可能 — AI 処理だけ諦める。
  const telephonySettings = await resolveTelephonySettings();
  const maxProcessingSeconds = telephonySettings.max_processing_minutes * 60;
  if (recording.duration_seconds > maxProcessingSeconds) {
    return commitAdvance(client, jobId, { expectedStatus: "transcribing", nextStatus: "failed", errorCode: "KMB-E822" });
  }

  const storagePath = recording.storage_path;
  if (storagePath === null) {
    // 理論上到達しない防御 (downloading の commit が storage_path を必ず設定してから
    // transcribing へ前進させるため)。
    return { ok: false, code: "KMB-E901", detail: `録音の storage_path が未設定です (call_job=${jobId})` };
  }

  const storageDownload = await client.storage.from(CALL_AUDIO_BUCKET).download(storagePath);
  if (storageDownload.error || !storageDownload.data) {
    return {
      ok: false,
      code: "KMB-E805",
      detail: `録音の Storage 取得に失敗しました: ${storageDownload.error?.message ?? "unknown"}`,
    };
  }
  const wavBytes = new Uint8Array(await storageDownload.data.arrayBuffer());

  const segmentsResult = segmentCallRecording(wavBytes);
  if (!segmentsResult.ok) {
    return commitAdvance(client, jobId, { expectedStatus: "transcribing", nextStatus: "failed", errorCode: "KMB-E822" });
  }
  const segments = segmentsResult.value;

  // チェックポイント再開 (§6.5.2-4(a))。AcquireLeaseRawResult には transcript_partial が
  // 含まれないため (migration 0033 の RETURNS TABLE 定義そのものの制約)、ここで追加 SELECT する。
  const jobRowResult = await getCallJobById(client, jobId);
  if (!jobRowResult.ok) return jobRowResult;
  const jobRow = jobRowResult.value;
  if (!jobRow) return { ok: false, code: "KMB-E804", detail: `通話ジョブが見つかりません: ${jobId}` };

  let checkpointSegments = jobRow.transcript_partial?.segments ?? [];
  const completedKeys = new Set(checkpointSegments.map((s) => `${s.channel}:${s.index}`));
  const pendingSegments = segments.filter((seg) => !completedKeys.has(`${seg.channel}:${seg.index}`));

  let aiCostThisWakeMicroUsd = 0;
  let completedThisWake = 0;

  for (const segment of pendingSegments) {
    // 残余時間ガード (§6.5.2-4(c)): 次セグメント開始前に打ち切り判定する。
    const elapsedMs = Date.now() - wakeStartedAt;
    if (elapsedMs + TRANSCRIBE_SEGMENT_WORST_MS > TELEPHONY_WAKE_SOFT_BUDGET_MS) {
      if (completedThisWake === 0) return { ok: true, value: { status: row.status } };
      return commitAdvance(client, jobId, {
        expectedStatus: "transcribing",
        nextStatus: "transcribing",
        aiCostDeltaMicroUsd: aiCostThisWakeMicroUsd,
      });
    }

    let transcribeResult = await callTranscribeSegment(jobId, recording, segment);
    if (!transcribeResult.ok) {
      if (transcribeResult.code === "KMB-E407") {
        return commitAdvance(client, jobId, {
          expectedStatus: "transcribing",
          nextStatus: "failed",
          errorCode: "KMB-E407",
          aiCostDeltaMicroUsd: aiCostThisWakeMicroUsd,
        });
      }
      if (transcribeResult.code === "KMB-E408") {
        if (completedThisWake === 0) return transcribeResult; // 不確定 return (attempts 経由で再試行)
        return commitAdvance(client, jobId, {
          expectedStatus: "transcribing",
          nextStatus: "transcribing",
          aiCostDeltaMicroUsd: aiCostThisWakeMicroUsd,
        });
      }
      // その他の転写失敗 (§6.5.2 手順4末尾): セグメント単位で 1 回だけ再試行する。
      transcribeResult = await callTranscribeSegment(jobId, recording, segment);
      if (!transcribeResult.ok) {
        return commitAdvance(client, jobId, {
          expectedStatus: "transcribing",
          nextStatus: "failed",
          errorCode: "KMB-E820",
          aiCostDeltaMicroUsd: aiCostThisWakeMicroUsd,
        });
      }
    }

    aiCostThisWakeMicroUsd += transcribeResult.value.costMicroUsd;
    completedThisWake += 1;
    checkpointSegments = [
      ...checkpointSegments,
      { channel: segment.channel, index: segment.index, text: transcribeResult.value.text },
    ];
    const checkpointResult = await updateCallJobTranscriptPartial(client, jobId, { segments: checkpointSegments });
    if (!checkpointResult.ok) return checkpointResult;
  }

  // 全セグメント完了 (§6.5.2 手順5): チャネル0→1・index昇順で連結する。
  const orderedSegments = [...checkpointSegments].sort((a, b) => a.channel - b.channel || a.index - b.index);
  const transcript: CallTranscript = {
    segments: orderedSegments,
    full_text: orderedSegments.map((s) => s.text).join("\n"),
  };
  return commitAdvance(client, jobId, {
    expectedStatus: "transcribing",
    nextStatus: "analyzing",
    transcript,
    aiCostDeltaMicroUsd: aiCostThisWakeMicroUsd,
  });
};

// ============================================================
// §6.5.3 analyzing
// ============================================================

/** structured outputs 用 JSON Schema (zod v4 ネイティブ z.toJSONSchema()、手書き禁止 — §3.3)。
 *  各モジュールが自前で持つ既存規約 (ai-studio/internal/json-schema.ts 等) に倣い、
 *  他モジュールの internal は import できない (module-contracts.md §2) ためここで複製する。 */
function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, { io: "output" }) as Record<string, unknown>;
  delete jsonSchema.$schema;
  return jsonSchema;
}
const CALL_ANALYSIS_RESPONSE_SCHEMA = { name: "call_analysis", schema: toJsonSchema(zCallAnalysis) };

/** Result<T> の失敗枝のみを取り出した型 (T に依らない — .ok===false を確認済みの値を保持するため)。 */
type ResultFailure = Extract<Result<unknown>, { ok: false }>;

type AnalyzeAttemptOutcome =
  | { kind: "success"; analysis: CallAnalysis; costMicroUsd: number }
  | { kind: "invalid"; costMicroUsd: number; reason: string }
  | { kind: "refusal"; costMicroUsd: number }
  | { kind: "failed"; result: ResultFailure };

/** generateText を 1 回呼び、refusal / JSON-Zod 不一致 / max_tokens 打切りを判別する (§6.5.3 手順2-3)。 */
async function attemptCallAnalysis(
  jobId: string,
  transcript: CallTranscript,
  callMeta: CallAnalysisMeta,
): Promise<AnalyzeAttemptOutcome> {
  const result = await aiProvidersFacade.generateText(
    {
      feature: "call-analysis",
      system: CALL_ANALYSIS_SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildAnalysisPrompt(transcript, callMeta) }],
      maxTokens: 8_000,
      responseSchema: CALL_ANALYSIS_RESPONSE_SCHEMA,
      refTable: "call_jobs",
      refId: jobId,
    },
    { mode: "service" },
  );
  if (!result.ok) return { kind: "failed", result };

  // refusal は API 呼び出し自体は成功 (usage も課金対象) — ai-providers 側ではエラー扱いにしない
  // (ai-studio/internal/claude.ts の runStructured と同じ判定点)。ここで KMB-E403 相当を telephony
  // 側のドメインコード KMB-E821 へ直接変換する (§9 変換表)。
  if (result.value.stopReason === "refusal") {
    return { kind: "refusal", costMicroUsd: result.value.costMicroUsd };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(result.value.text);
  } catch {
    return { kind: "invalid", costMicroUsd: result.value.costMicroUsd, reason: "AI 出力が JSON として解析できませんでした" };
  }

  const parsed = zCallAnalysis.safeParse(parsedJson);
  if (!parsed.success) {
    return { kind: "invalid", costMicroUsd: result.value.costMicroUsd, reason: parsed.error.message };
  }
  // max_tokens (打切り) は JSON/Zod がたまたま通っても内容欠落の疑いが残るため invalid 扱いにする。
  if (result.value.stopReason === "max_tokens") {
    return { kind: "invalid", costMicroUsd: result.value.costMicroUsd, reason: "max_tokens (出力打ち切り)" };
  }

  return { kind: "success", analysis: parsed.data, costMicroUsd: result.value.costMicroUsd };
}

const handleAnalyzing: CallStageHandler = async ({ client, jobId, row }) => {
  // AcquireLeaseRawResult には link_result/transcript_partial は含まれないが analysis/transcript は
  // 含まれる (migration 0033 の RETURNS TABLE 定義)。ただし linking と同様の追加 SELECT に統一し、
  // 型付き (CallJobRow) の値をそのまま使う (unknown からの都度 parse を避ける)。
  const jobRowResult = await getCallJobById(client, jobId);
  if (!jobRowResult.ok) return jobRowResult;
  const jobRow = jobRowResult.value;
  if (!jobRow) return { ok: false, code: "KMB-E804", detail: `通話ジョブが見つかりません: ${jobId}` };

  // 再入ガード (§6.5.3 手順1)
  const existingAnalysis = jobRow.analysis;
  if (existingAnalysis !== null) {
    return commitAdvance(client, jobId, {
      expectedStatus: "analyzing",
      nextStatus: "linking",
      analysis: existingAnalysis,
    });
  }

  const transcript = jobRow.transcript;
  if (transcript === null) {
    // 理論上到達しない防御 (transcribing の commit が transcript を必ずセットしてから
    // analyzing へ前進させるため)。
    return {
      ok: false,
      code: "KMB-E901",
      detail: `transcript が未設定のまま analyzing に到達しました (call_job=${jobId})`,
    };
  }

  const callResult = await getCallById(client, row.call_id);
  if (!callResult.ok) return callResult;
  const call = callResult.value;
  if (!call) return { ok: false, code: "KMB-E804", detail: `通話が見つかりません: ${row.call_id}` };

  const callMeta: CallAnalysisMeta = {
    startedAt: call.started_at,
    handling: call.handling,
    durationSeconds: call.duration_seconds,
    hasFromNumber: call.from_e164 !== null,
  };

  const first = await attemptCallAnalysis(jobId, transcript, callMeta);
  if (first.kind === "failed") {
    if (first.result.code === "KMB-E407") {
      return commitAdvance(client, jobId, { expectedStatus: "analyzing", nextStatus: "failed", errorCode: "KMB-E407" });
    }
    return first.result; // E408 その他 → 不確定 return (attempts 経由で再試行)
  }
  if (first.kind === "success") {
    return commitAdvance(client, jobId, {
      expectedStatus: "analyzing",
      nextStatus: "linking",
      analysis: first.analysis,
      aiCostDeltaMicroUsd: first.costMicroUsd,
    });
  }

  // refusal は再生成せず即 failed。invalid (JSON/Zod 不一致・max_tokens 打切り) は
  // 1 回だけ再生成する (§6.5.3 手順3)。
  const accruedCostMicroUsd = first.costMicroUsd;
  if (first.kind === "refusal") {
    return commitAdvance(client, jobId, {
      expectedStatus: "analyzing",
      nextStatus: "failed",
      errorCode: "KMB-E821",
      aiCostDeltaMicroUsd: accruedCostMicroUsd,
    });
  }

  const retry = await attemptCallAnalysis(jobId, transcript, callMeta);
  if (retry.kind === "failed") {
    if (retry.result.code === "KMB-E407") {
      return commitAdvance(client, jobId, {
        expectedStatus: "analyzing",
        nextStatus: "failed",
        errorCode: "KMB-E407",
        aiCostDeltaMicroUsd: accruedCostMicroUsd,
      });
    }
    return retry.result; // E408 その他 → 不確定 return
  }
  if (retry.kind === "success") {
    return commitAdvance(client, jobId, {
      expectedStatus: "analyzing",
      nextStatus: "linking",
      analysis: retry.analysis,
      aiCostDeltaMicroUsd: accruedCostMicroUsd + retry.costMicroUsd,
    });
  }

  // refusal または invalid が再度返った → E821 で確定。
  return commitAdvance(client, jobId, {
    expectedStatus: "analyzing",
    nextStatus: "failed",
    errorCode: "KMB-E821",
    aiCostDeltaMicroUsd: accruedCostMicroUsd + retry.costMicroUsd,
  });
};

// ============================================================
// §6.5.4 linking
// ============================================================

type CallActivityTitleMeta = { customerNameGuess: string | null; fromE164: string | null; durationSeconds: number };

/** activity title (§6.6): 「電話 (着信) {顧客名 or 番号下4桁 or 番号非通知} {M分S秒}」。
 *  顧客名は AI 推測 (customer_name_guess) を使う (matched の既存顧客名を得るには
 *  crmFacade.getCustomerRef の追加呼び出しが必要になるため、createCustomer 時に使う名前と
 *  同じ源泉に統一して呼び出し構成を単純に保つ設計判断 — #58 実装報告参照)。 */
function buildCallActivityTitle(meta: CallActivityTitleMeta): string {
  const name = meta.customerNameGuess ?? (meta.fromE164 ? `番号${meta.fromE164.slice(-4)}` : "番号非通知");
  return `電話 (着信) ${name} ${formatDuration(meta.durationSeconds)}`.slice(0, 120);
}

/** activity body (§6.6): 議事録要約 + 要点箇条書き + 概算コスト付記。 */
function buildCallActivityBody(minutes: CallMinutes, costJpy: number, durationSeconds: number): string {
  const keyPoints = minutes.key_points.length > 0 ? minutes.key_points.map((p) => `・${p}`).join("\n") : "（要点なし）";
  return [
    minutes.summary,
    "",
    "— 要点 —",
    keyPoints,
    "",
    `（概算コスト: 約 ¥${costJpy} / 通話 ${formatDuration(durationSeconds)}・AI 処理込み。請求確定額ではありません）`,
  ].join("\n");
}

/** タスク body (§6.5.4 手順4): detail + (due_hint があれば期日ヒントを付記)。 */
function buildTaskBody(detail: string | null, dueHint: string | null): string | null {
  if (detail === null && dueHint === null) return null;
  const hintSuffix = dueHint ? ` (期日ヒント: ${dueHint})` : "";
  return `${detail ?? ""}${hintSuffix}`.trim();
}

const handleLinking: CallStageHandler = async ({ client, jobId, row }) => {
  // AcquireLeaseRawResult には link_result/transcript_partial が含まれない (migration 0033 の
  // RETURNS TABLE 定義そのものの制約)。ここで追加 SELECT した jobRow で判定する。
  const jobRowResult = await getCallJobById(client, jobId);
  if (!jobRowResult.ok) return jobRowResult;
  const jobRow = jobRowResult.value;
  if (!jobRow) return { ok: false, code: "KMB-E804", detail: `通話ジョブが見つかりません: ${jobId}` };

  // 再入ガード (§6.5.4 手順1)
  const existingLinkResult = jobRow.link_result;
  if (existingLinkResult !== null) {
    return commitAdvance(client, jobId, { expectedStatus: "linking", nextStatus: "done", linkResult: existingLinkResult });
  }

  const analysis = jobRow.analysis;
  if (analysis === null) {
    // 理論上到達しない防御 (analyzing の commit が analysis を必ずセットしてから linking へ
    // 前進させるため)。
    return { ok: false, code: "KMB-E901", detail: `analysis が未設定のまま linking に到達しました (call_job=${jobId})` };
  }

  const callResult = await getCallById(client, row.call_id);
  if (!callResult.ok) return callResult;
  const call = callResult.value;
  if (!call) return { ok: false, code: "KMB-E804", detail: `通話が見つかりません: ${row.call_id}` };

  // 顧客マッチ (§6.5.4 手順2)。
  let outcome: CallJobLinkResult["outcome"];
  let customerId: string | null = null;
  let warning: string | null = null;

  const fromE164 = call.from_e164;
  if (fromE164 === null) {
    outcome = "no_number";
  } else {
    const matchResult = await crmFacade.matchCustomerByPhone(fromE164, { mode: "service" });
    if (matchResult.ok) {
      if (matchResult.value !== null) {
        outcome = "matched";
        customerId = matchResult.value.customer_id;
      } else {
        const nameGuess = analysis.minutes.customer_name_guess ?? `電話のお客様 ${fromE164.slice(-4)}`;
        // force:true — 「電話番号一致なし」を matchCustomerByPhone で既に確認済みのため
        // dedup 再判定は不要 (§6.5.4 手順2)。
        const createResult = await crmFacade.createCustomer(
          {
            kind: "person",
            name: nameGuess,
            name_kana: null,
            email: null,
            tel_e164: fromE164,
            company_id: null,
            address: null,
            notes: null,
            lifecycle: "lead",
            source: "phone",
          },
          { force: true },
          { mode: "service" },
        );
        if (!createResult.ok) return createResult; // 不確定 return
        outcome = "created";
        customerId = createResult.value.customer_id;
      }
    } else if (matchResult.code === "KMB-E601") {
      // ドメイン変換 (§6.5.4 手順2): KMB-E601 → KMB-E823。不確定 return にせず正常系の分岐として
      // 扱う (ここを不確定に倒すと同番号複数顧客の全ジョブが3回リトライの末 E806 failed になる —
      // canonical 本文が名指しで警告している最重要地雷)。
      outcome = "ambiguous";
      warning = `KMB-E823: 同じ電話番号の顧客候補が複数見つかりました${matchResult.detail ? ` (${matchResult.detail})` : ""}`;
    } else {
      return matchResult; // その他の失敗 → 不確定 return (attempts 経由で再試行)
    }
  }

  // タイムライン (matched/created 経路のみ、§6.5.4 手順3)。
  let activityId: string | null = null;
  let activityCreated = false;
  if (outcome === "matched" || outcome === "created") {
    const recordingsResult = await listCallRecordingsByCallId(client, row.call_id);
    if (!recordingsResult.ok) return recordingsResult;
    // duration_seconds フォールバック (§6.5.4 手順3 v1.1): calls.duration_seconds が null なら
    // 録音 duration_seconds の call_id 単位合計で代替し、それも無ければ 0。
    const durationSeconds =
      call.duration_seconds ?? recordingsResult.value.reduce((sum, r) => sum + r.duration_seconds, 0);

    const costJpy = formatCostEstimateJpy(
      call.twilio_cost_estimate_micro_usd,
      call.ai_cost_micro_usd + jobRow.ai_cost_micro_usd,
    );

    const appendResult = await crmFacade.appendActivity(
      {
        activity_type: "call",
        occurred_at: call.started_at,
        title: buildCallActivityTitle({ customerNameGuess: analysis.minutes.customer_name_guess, fromE164, durationSeconds }),
        body: buildCallActivityBody(analysis.minutes, costJpy, durationSeconds),
        payload: {
          call_id: call.id,
          direction: "inbound",
          duration_seconds: durationSeconds,
          has_recording: true,
          summary: analysis.minutes.summary.slice(0, 2000),
        },
        ref_table: "calls",
        ref_id: call.id,
        links: [{ customer_id: customerId, company_id: null, deal_id: null }],
      },
      { mode: "service" },
    );
    if (!appendResult.ok) return appendResult; // 不確定 return
    activityId = appendResult.value.activity_id;
    activityCreated = appendResult.value.created;
  }

  // タスク起票 (§6.5.4 手順4)。全経路 (matched/created/ambiguous/no_number) で常に再実行する
  // (v1.0 の「activity created:true のときのみ起票」ガードは廃止済み — DB 側の
  // (source_activity_id, title) 一意 index が冪等性を担う)。
  const taskIds: string[] = [];
  for (const task of analysis.tasks) {
    const createTaskResult = await crmFacade.createTask(
      {
        title: task.title,
        body: buildTaskBody(task.detail, task.due_hint),
        due_on: null,
        deal_id: null,
        customer_id: customerId,
        origin: "ai_call",
        source_activity_id: activityId,
      },
      { mode: "service" },
    );
    if (!createTaskResult.ok) return createTaskResult; // 不確定 return
    taskIds.push(createTaskResult.value.task_id);
  }

  // calls 反映 (§6.5.4 手順5)。手動確定保護ガードは repository.reflectLinkResultToCalls 側で実装済み。
  const reflectResult = await reflectLinkResultToCalls(client, row.call_id, {
    customerId,
    matchStatus: outcome,
    aiCostDeltaMicroUsd: jobRow.ai_cost_micro_usd,
  });
  if (!reflectResult.ok) return reflectResult;
  if (reflectResult.value.skipped) {
    const manualNote = "手動確定済みのため customer_id/match_status は更新されませんでした";
    warning = warning ? `${warning} / ${manualNote}` : manualNote;
  }

  const linkResult: CallJobLinkResult = {
    outcome,
    customer_id: customerId,
    activity_id: activityId,
    activity_created: activityCreated,
    task_ids: taskIds,
    warning,
  };

  return commitAdvance(client, jobId, { expectedStatus: "linking", nextStatus: "done", linkResult });
};

export const STAGE_HANDLERS: Record<DispatchableStage, CallStageHandler> = {
  downloading: handleDownloading,
  transcribing: handleTranscribing,
  analyzing: handleAnalyzing,
  linking: handleLinking,
};

/**
 * advanceCallJob の実体。`TelephonyFacade.advanceCallJob(callJobId, ctx)` は
 * facade.ts 側で ctx → client を解決したうえで本関数を呼ぶだけの薄いラッパーになる。
 */
export async function advanceCallJob(
  client: SupabaseClient,
  jobId: string,
): Promise<Result<{ status: CallJobStatus }>> {
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  try {
    const leaseResult = await acquireCallJobLease(client, jobId);
    if (!leaseResult.ok) return leaseResult;

    const raw = leaseResult.value;
    if (!raw) {
      return { ok: false, code: "KMB-E804", detail: `call_jobs が見つかりません: ${jobId}` };
    }

    const outcome = interpretAcquireLeaseResult(raw);
    if (outcome.kind === "not_found") {
      return { ok: false, code: "KMB-E804", detail: `call_jobs が見つかりません: ${jobId}` };
    }
    if (outcome.kind === "held") {
      // 他プロセスが lease 保持中 (409 相当)。D8 表どおりエラーにせず現在値を返す
      // (raw は not_found 以外では常に非 null — interpretAcquireLeaseResult の変換規則)。
      return { ok: true, value: { status: raw.status } };
    }
    if (outcome.kind === "exhausted") {
      // acquire が stage_attempts>=3 を検知して failed 化した直後の応答 (migration 0033 §2.3)。
      return { ok: false, code: "KMB-E806", detail: `通話の後処理が3回失敗しました: ${jobId}` };
    }
    if (outcome.kind === "terminal") {
      return { ok: true, value: { status: outcome.status } };
    }

    // outcome.kind === "acquired"
    heartbeatTimer = setInterval(() => {
      heartbeatCallJobLease(client, jobId).catch(() => {
        // heartbeat 失敗はベストエフォート。lease が自然失効してもクラッシュ再開
        // (§5.1 不変条件 6) の仕組みで次の advance が回収する。
      });
    }, CALL_JOB_HEARTBEAT_INTERVAL_MS);

    const stage = outcome.row.status;
    if (!isDispatchableStage(stage)) {
      // 理論上到達しない防御分岐 (acquire は pending を downloading へ bootstrap 済みであり、
      // terminal/exhausted は上で既に return している)。
      return {
        ok: false,
        code: "KMB-E901",
        detail: `call_job_acquire_lease が想定外の status を返しました: ${stage}`,
      };
    }
    return await STAGE_HANDLERS[stage]({ client, jobId, row: outcome.row });
  } catch (err) {
    return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  }
}

/**
 * POST /api/jobs/telephony (§7.3) の after() 本体。distribution/internal/worker.ts の
 * `runPublishWorkerBatch` と同型のパターン (service client を 1 度だけ生成し、due job を
 * 直列処理して facade へ再 export する — route.ts は module-contracts.md §2 の ESLint 境界により
 * 自モジュールの repository を直 import できないため、この関数が route.ts の唯一の入口になる)。
 *
 * due job を最大 `TELEPHONY_WORKER_MAX_JOBS_PER_WAKE` 件、created_at 昇順で直列に
 * `advanceCallJob` へ渡す (同時 AI 呼び出しの予算競合を避けるため並列化しない — §7.3)。
 * 2 件目以降の着手前に残余予算ガード (00-overview §3.1.4-8) を判定する: 経過時間 +
 * 1 ステージの最悪想定 (`TRANSCRIBE_SEGMENT_WORST_MS`) が `TELEPHONY_WAKE_SOFT_BUDGET_MS` を
 * 超える場合は着手せず次起床へ持ち越す (lease 取得前の判定のため stage_attempts に計上されない)。
 */
export async function runTelephonyJobBatch(): Promise<{ processed: number }> {
  const client = createSupabaseServiceClient();
  const startedAt = Date.now();

  const dueResult = await listDueCallJobs(client, TELEPHONY_WORKER_MAX_JOBS_PER_WAKE);
  if (!dueResult.ok) {
    console.error("KMB-E901: /api/jobs/telephony の due job 取得に失敗しました", dueResult.code, dueResult.detail);
    return { processed: 0 };
  }

  let processed = 0;
  for (const job of dueResult.value) {
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs + TRANSCRIBE_SEGMENT_WORST_MS > TELEPHONY_WAKE_SOFT_BUDGET_MS) {
      break; // 残余予算不足 — 次起床へ持ち越す (lease 未取得のため attempts 不計上)
    }

    const result = await advanceCallJob(client, job.id);
    if (!result.ok) {
      console.error(`KMB-E901: advanceCallJob(${job.id}) に失敗しました`, result.code, result.detail);
    }
    processed += 1;
  }

  return { processed };
}
