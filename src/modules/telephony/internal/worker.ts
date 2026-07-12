import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { Result } from "@/modules/platform/contracts";

import type { CallJobStatus } from "../contracts";
import { acquireCallJobLease, heartbeatCallJobLease, listDueCallJobs } from "../repository";
import {
  CALL_JOB_HEARTBEAT_INTERVAL_MS,
  TELEPHONY_WAKE_SOFT_BUDGET_MS,
  TELEPHONY_WORKER_MAX_JOBS_PER_WAKE,
  TRANSCRIBE_SEGMENT_WORST_MS,
  interpretAcquireLeaseResult,
  type AcquireLeaseRawResult,
} from "./lease";

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
 * ★#57 のスコープは lease/commit/retry の制御フローのみ (Issue Out: 録音DL・転写・AI議事録・
 * CRM連携の実処理)。4 ステージの実処理は #58 が `STAGE_HANDLERS` の中身を差し替えて実装する。
 * 本ファイルの 4 ハンドラは「即 return・commit しない」未実装スタブ — commit しないので
 * lease は自然失効し、次起床で同じ stage (status は前進していないため) が再試行される
 * (§5.1 不変条件 6)。3 回失敗すると acquire 自身が stage_attempts>=3 を検知して exhausted
 * (KMB-E806) に倒す。これは「不確定エラーは throw せず return する」既定の意味論 (§6.5 共通則)
 * と同一の経路であり、#57 単独でも「サーバ再起動時も処理が継続され、3 回失敗後は警告が表示される」
 * という Issue の受入基準を (中身が空でも) 満たす。
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

// ---- ステージハンドラ (#57: 未実装スタブ。#58 がこの 4 つの中身だけを差し替える) ----
// いずれも commit を呼ばない即 return スタブ (上のファイル doc コメント参照)。

/** §6.5.1 downloading (実処理は #58)。 */
const handleDownloading: CallStageHandler = async ({ row }) => {
  return { ok: true, value: { status: row.status } };
};

/** §6.5.2 transcribing (実処理は #58)。 */
const handleTranscribing: CallStageHandler = async ({ row }) => {
  return { ok: true, value: { status: row.status } };
};

/** §6.5.3 analyzing (実処理は #58)。 */
const handleAnalyzing: CallStageHandler = async ({ row }) => {
  return { ok: true, value: { status: row.status } };
};

/** §6.5.4 linking (実処理は #58)。 */
const handleLinking: CallStageHandler = async ({ row }) => {
  return { ok: true, value: { status: row.status } };
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
