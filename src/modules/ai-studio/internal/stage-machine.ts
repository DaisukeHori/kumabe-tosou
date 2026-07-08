import type { RunStage, RunStatus } from "../contracts";

/**
 * advance() の状態機械 (canonical: docs/design/cms-ai-pipeline.md §7.6 / §4.2)。
 *
 * 実装で確定した意味論 (設計書のポンチ絵を実装可能な形に具体化したもの。
 * 状態遷移図 §4.2 pending→extracting→researching→drafting→ready_for_review と矛盾しない):
 *
 * ai_runs.status が 'extracting' | 'researching' | 'drafting' の場合、
 * 「そのステージが現在の担当ステージである (これから実行される、またはクラッシュ後に
 * 再試行される対象)」を表す。つまり status は「次に advance() が実行すべきステージ名」
 * そのものであり、'pending' だけがステージ未確定の初期プレースホルダ。
 *
 * - 'pending'      → 初回 lease 取得時に 'extracting' へ bootstrap される
 *                     (migration 0009 ai_run_acquire_lease)。
 * - 'extracting'   → 実行対象ステージ = 'extracting'。成功後、research が有効なら
 *                     'researching' へ、無効なら 'drafting' へ前進 (researching をスキップ)。
 * - 'researching'  → 実行対象ステージ = 'researching'。成功後、'drafting' へ前進。
 * - 'drafting'     → advance() が到達する前に extracting/researching の commit で
 *                     bootstrap 済みの値としてのみ現れる。実行対象ステージ = 'drafting'。
 *                     成功後は 'ready_for_review' へ前進 (これ以上 advance は不要)。
 *
 * クラッシュ再開 (§7.6): lease が自然失効しても status は変わらないため、次の
 * advance がこの表に従って「同じ stage」を再実行する。
 */

export const RUNNABLE_STATUSES = ["pending", "extracting", "researching", "drafting"] as const;
export type RunnableStatus = (typeof RUNNABLE_STATUSES)[number];

/** stage_attempts > 3 → failed (KMB-E402、§7.6)。3 回までは許容。 */
export const MAX_STAGE_ATTEMPTS = 3;

export function isRunnableStatus(status: string): status is RunnableStatus {
  return (RUNNABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * lease 取得後の (bootstrap 済み) status から、今回の advance 呼び出しで
 * 実行すべき stage を求める。'pending' は ai_run_acquire_lease が必ず
 * 'extracting' へ bootstrap してから返すため、ここでは扱わない
 * (呼び出し側の型で RunnableStatus のうち 'pending' 以外を要求する)。
 */
export function stageToRun(status: Exclude<RunnableStatus, "pending">): RunStage {
  return status;
}

/**
 * stage 完了後の次の status (成功時の「status 前進」)。
 * research 無効時は 'researching' を飛ばして 'drafting' に直行する (§4.2)。
 */
export function nextStatusAfterStage(stage: RunStage, researchEnabled: boolean): RunStatus {
  switch (stage) {
    case "extracting":
      return researchEnabled ? "researching" : "drafting";
    case "researching":
      return "drafting";
    case "drafting":
      return "ready_for_review";
  }
}
