import type { CallJobStatus } from "../contracts";

/**
 * call_jobs の状態機械 (canonical: docs/design/crm-suite/04-telephony.md §5.1)。
 * src/modules/ai-studio/internal/stage-machine.ts と同型のパターンを踏襲するが、telephony は
 * downloading → transcribing → analyzing → linking → done の**単純な線形**で分岐を持たない
 * (ai-studio の research 有効/無効・image_generation スキップのような枝分かれが存在しない —
 * 過剰な汎用化はしない)。
 *
 * call_jobs.status は ai_runs と同じく「次に実行すべきステージ名」そのものを表す。
 * 'pending' だけがステージ未確定の初期プレースホルダで、call_job_acquire_lease (migration 0033)
 * が初回 lease 取得時に 'downloading' へ bootstrap する。
 *
 * クラッシュ再開 (§5.1 不変条件 6): lease が自然失効しても status は変わらないため、次の
 * advance がこの表に従って「同じ stage」を再実行する。
 */

export const CALL_JOB_RUNNABLE_STATUSES = [
  "pending",
  "downloading",
  "transcribing",
  "analyzing",
  "linking",
] as const;
export type RunnableCallJobStatus = (typeof CALL_JOB_RUNNABLE_STATUSES)[number];

// stage_attempts >= 3 → failed (KMB-E806、migration 0033 §2.3) の閾値は
// internal/lease.ts の CALL_JOB_MAX_ATTEMPTS が唯一の定義元 (04-telephony.md §3.2 の
// 配置規約どおり)。ここでは重複定義しない。

export function isRunnableCallJobStatus(status: string): status is RunnableCallJobStatus {
  return (CALL_JOB_RUNNABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * stage 完了後の次の status (成功時の「status 前進」)。'pending' は call_job_acquire_lease が
 * 必ず 'downloading' へ bootstrap してから返すため、ここでは扱わない (呼び出し側の型で
 * RunnableCallJobStatus のうち 'pending' 以外を要求する)。
 * downloading → transcribing → analyzing → linking → done の線形固定 (分岐なし — §5.1)。
 */
export function nextStatusAfterStage(status: Exclude<RunnableCallJobStatus, "pending">): CallJobStatus {
  switch (status) {
    case "downloading":
      return "transcribing";
    case "transcribing":
      return "analyzing";
    case "analyzing":
      return "linking";
    case "linking":
      return "done";
  }
}
