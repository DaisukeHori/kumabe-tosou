import type { CallHandling } from "../contracts";

/**
 * Twilio コスト概算 (µUSD、純関数)。
 * canonical: docs/design/crm-suite/04-telephony.md §3.2 末尾の単価表 + §6.3 手順 4。
 *
 * 範囲についての注記: 04-telephony.md の internal/cost.ts 全体 (worker 側の詳細な録音分
 * 按分等) は #57/#58 スコープだが、本定数表と estimateTwilioCostMicroUsd は
 * `TelephonyFacade.handleCallStatus` (本 Issue #56 の実装必須メソッド — 04-telephony.md
 * §6.3 手順 4) が calls.twilio_cost_estimate_micro_usd (repository の
 * CallStatusCallbackPatch で非 null 必須) を求めるために直接必要なため、ここで最小限を
 * 実装する。値は「概算」(activity 本文にもその旨注記 — §6.6) であり請求確定額ではない。
 */
export const TWILIO_RATES_MICRO_USD_PER_MIN = {
  inbound_050: 10_000, // $0.0100/min (着信料)
  recording: 2_500, // $0.0025/min (録音)
  forward_leg_mobile: 185_000, // $0.185/min (転送成立時のみ加算)
} as const;

/**
 * 通話終了時点 (§6.3) の概算コスト計算。分単位切り上げ。
 * - 常に着信料 + 録音料を計上 (voicemail/after_hours_voicemail も <Record> で録音するため)
 * - handling='forwarded' のときのみ転送レグ料金を加算 (概算 — 実際の応答区間長ではなく
 *   通話全体の duration を用いる。§6.3-4 の「概算」という位置づけのための簡略化)
 */
export function estimateTwilioCostMicroUsd(durationSeconds: number, handling: CallHandling | null): number {
  if (durationSeconds <= 0) return 0;
  const minutes = Math.ceil(durationSeconds / 60);

  let totalMicroUsd = minutes * TWILIO_RATES_MICRO_USD_PER_MIN.inbound_050;
  totalMicroUsd += minutes * TWILIO_RATES_MICRO_USD_PER_MIN.recording;
  if (handling === "forwarded") {
    totalMicroUsd += minutes * TWILIO_RATES_MICRO_USD_PER_MIN.forward_leg_mobile;
  }
  return totalMicroUsd;
}

/**
 * µUSD → ¥ 表示レート (04-telephony.md §2.6 / §6.6)。表示専用の定数であり DB には保存しない
 * (µUSD (bigint) のみを保存する既存規約 — JPY 整数と混在しない)。
 */
export const USD_JPY_DISPLAY_RATE = 150;

/**
 * activity 本文 (§6.6) 用の概算コスト ¥ 換算。
 * `(twilioCostMicroUsd + aiCostMicroUsd) × USD_JPY_DISPLAY_RATE / 1_000_000` を四捨五入した
 * 整数円を返す (「概算コスト」注記付きで表示する — 請求確定額ではない)。
 */
export function formatCostEstimateJpy(twilioCostMicroUsd: number, aiCostMicroUsd: number): number {
  const totalMicroUsd = twilioCostMicroUsd + aiCostMicroUsd;
  return Math.round((totalMicroUsd * USD_JPY_DISPLAY_RATE) / 1_000_000);
}
