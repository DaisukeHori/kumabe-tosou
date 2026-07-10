import type { RunStage, RunStatus } from "../contracts";

/**
 * advance() の状態機械 (canonical: docs/design/cms-ai-pipeline.md §7.6 / §4.2、
 * P4 拡張: docs/design/ai-studio-v2.md §7 の image_generation ステージ)。
 *
 * 実装で確定した意味論 (設計書のポンチ絵を実装可能な形に具体化したもの。
 * 状態遷移図 §4.2 pending→extracting→researching→drafting→(image_generation)→ready_for_review
 * と矛盾しない):
 *
 * ai_runs.status が 'extracting' | 'researching' | 'drafting' | 'image_generation' の場合、
 * 「そのステージが現在の担当ステージである (これから実行される、またはクラッシュ後に
 * 再試行される対象)」を表す。つまり status は「次に advance() が実行すべきステージ名」
 * そのものであり、'pending' だけがステージ未確定の初期プレースホルダ。
 *
 * - 'pending'          → 初回 lease 取得時に 'extracting' へ bootstrap される
 *                         (migration 0009 ai_run_acquire_lease)。
 * - 'extracting'       → 実行対象ステージ = 'extracting'。成功後、research が有効なら
 *                         'researching' へ、無効なら 'drafting' へ前進 (researching をスキップ)。
 * - 'researching'      → 実行対象ステージ = 'researching'。成功後、'drafting' へ前進。
 * - 'drafting'         → 実行対象ステージ = 'drafting'。成功後、run が X/Instagram を
 *                         含むなら 'image_generation' へ、含まないなら 'ready_for_review' へ
 *                         前進 (§7: SNS 以外の run は画像ステージを skip する)。
 * - 'image_generation' → 実行対象ステージ = 'image_generation' (P4)。成功・部分成功・
 *                         0 枚のいずれでも常に 'ready_for_review' へ前進する (画像生成の
 *                         失敗は run 全体を止める理由にしない。graceful degradation)。
 *
 * クラッシュ再開 (§7.6): lease が自然失効しても status は変わらないため、次の
 * advance がこの表に従って「同じ stage」を再実行する。
 *
 * **P4 で発見・修正した既存バグ (オーケストレーターへ報告事項)**: migration 0009 の
 * `ai_run_acquire_lease` の runnable 判定 SQL (`status not in ('pending','extracting',
 * 'researching')`) には 'drafting' が含まれておらず、researching (または research 無効時の
 * extracting) が commit した直後の 2 回目の advance() 呼び出しで drafting stage が実行されず
 * 'terminal' 応答になっていた (advanceRunDetailed は terminal を「既に advance 済み」として
 * 何もせず返す)。migration 20260710000019 で 'drafting'・'image_generation' を runnable 集合に
 * 追加して修正した (この定数 RUNNABLE_STATUSES とは独立に SQL 側にも同じ集合を複製している点は
 * 既存 §7.6 実装踏襲— 二重管理だが DB 側は security definer RPC 内の判定のため TS 側から
 * 参照できない制約による)。
 */

export const RUNNABLE_STATUSES = [
  "pending",
  "extracting",
  "researching",
  "drafting",
  "image_generation",
] as const;
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

/** run の target_channels が X または Instagram を含むか (P4: image_generation ステージの要否判定、§7)。 */
export function needsImageStage(targetChannels: readonly string[]): boolean {
  return targetChannels.includes("x") || targetChannels.includes("instagram");
}

/**
 * stage 完了後の次の status (成功時の「status 前進」)。
 * research 無効時は 'researching' を飛ばして 'drafting' に直行する (§4.2)。
 * targetChannels は 'drafting' 完了後の分岐にのみ使う (P4: X/IG を含む run は
 * 'image_generation' へ、含まない run は 'ready_for_review' へ直行して skip する)。
 * 省略時 ([]) は従来どおり画像ステージなしの挙動になる (既存呼び出し元との後方互換)。
 */
export function nextStatusAfterStage(
  stage: RunStage,
  researchEnabled: boolean,
  targetChannels: readonly string[] = [],
): RunStatus {
  switch (stage) {
    case "extracting":
      return researchEnabled ? "researching" : "drafting";
    case "researching":
      return "drafting";
    case "drafting":
      return needsImageStage(targetChannels) ? "image_generation" : "ready_for_review";
    case "image_generation":
      return "ready_for_review";
  }
}
