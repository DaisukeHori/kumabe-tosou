import type { CallJobStatus } from "../contracts";

/**
 * lease 取得ロジック (canonical: docs/design/crm-suite/04-telephony.md §2.3 / §3.2 / §5.4)。
 * 実際の DB アクセス (call_job_acquire_lease RPC 呼び出し、migration 0033) は repository.ts
 * (#57 の別成果物) が担い、ここでは「取得結果の分岐」を DB 実装から切り離した純粋な形で提供する
 * (単体テスト対象: tests/telephony-job-stage-machine.test.ts)。
 * src/modules/ai-studio/internal/lease.ts (migration 0009/0019 版) の同型複製 — telephony は
 * runnable 集合が単純な線形 (分岐なし) な点のみ異なる。
 */

export type AcquireLeaseRawResult = {
  id: string;
  status: CallJobStatus;
  lease_expires_at: string | null;
  stage_attempts: number;
  call_id: string;
  recording_id: string;
  transcript: unknown;
  analysis: unknown;
  result_kind: "acquired" | "held" | "exhausted" | "terminal" | "not_found";
} | null;

export type LeaseAcquireOutcome =
  | { kind: "acquired"; row: NonNullable<AcquireLeaseRawResult> }
  | { kind: "held" }
  | { kind: "exhausted" }
  | { kind: "terminal"; status: CallJobStatus }
  | { kind: "not_found" };

/**
 * migration 0033 `call_job_acquire_lease` RPC の生の返り値 (単一行 or null) を
 * advance ハンドラが分岐しやすい判別共用体に変換する。`as any` は使わない
 * (04-telephony.md §3.3 — RPC 生返り値は本関数のような判別共用体変換関数で型付けする)。
 */
export function interpretAcquireLeaseResult(raw: AcquireLeaseRawResult): LeaseAcquireOutcome {
  if (!raw || raw.result_kind === "not_found") return { kind: "not_found" };
  if (raw.result_kind === "terminal") return { kind: "terminal", status: raw.status };
  if (raw.result_kind === "exhausted") return { kind: "exhausted" };
  if (raw.result_kind === "held") return { kind: "held" };
  return { kind: "acquired", row: raw };
}

/** lease の TTL (§2.3: `now() + interval '90 seconds'` と一致させる参照値。§5.4 要件 3)。 */
export const CALL_JOB_LEASE_TTL_MS = 90_000;
/** heartbeat の間隔 (§5.4 要件 3: 20 秒ごと)。lease TTL (90s) より十分短い。 */
export const CALL_JOB_HEARTBEAT_INTERVAL_MS = 20_000;
/** stage_attempts がこの値以上で acquire 時に failed (KMB-E806) へ倒れる (migration 0033 §2.3)。 */
export const CALL_JOB_MAX_ATTEMPTS = 3;
/** 1 起床あたりに worker が処理するジョブの最大数 (00-overview §3.1.3 / §7.3)。 */
export const TELEPHONY_WORKER_MAX_JOBS_PER_WAKE = 2;
/** maxDuration 300 秒に対する安全予算 (00-overview §3.1.4-8)。この経過時間を超えたら次のジョブ
 *  着手や次セグメントの転写を打ち切り、次起床へ持ち越す。 */
export const TELEPHONY_WAKE_SOFT_BUDGET_MS = 240_000;
/** 1 セグメント転写の最悪想定所要時間 (§5.4 要件 8 / §6.5.2-4)。残余時間ガードの判定に使う。 */
export const TRANSCRIBE_SEGMENT_WORST_MS = 60_000;
