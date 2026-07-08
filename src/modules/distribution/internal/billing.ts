/**
 * X 課金ガード計算 (canonical: docs/design/cms-ai-pipeline.md §8.2 / §14 コスト試算)。
 * 単価は 2026-07-07 調査確定 (投稿 $0.015/件、URL 付き $0.20/件)。
 *
 * 実装メモ (オーケストレーターへ報告済みの解釈):
 * settings.ops_limits.x_monthly_post_limit (module-contracts.md §4.2) はフィールド名こそ
 * 「件数」だが、既存の /admin/settings フォーム説明 ("当月の推定コスト合算がこの件数相当を
 * 超えたら配信をブロックします") が示す通り、実装上は estimated_cost_cents の合算値と
 * 直接比較される閾値として運用されている (Wave1-A で先行実装済みの解釈を踏襲)。
 * 本モジュールは "セント" 単位で計算し、この閾値とそのまま比較する。
 */

/** 通常ツイート単価 (セント、$0.015) */
export const X_POST_COST_CENTS = 1.5;
/** URL 付きツイート単価 (セント、$0.20) */
export const X_POST_WITH_URL_COST_CENTS = 20;

export type XCostInput = {
  /** スレッド内ツイート数 */
  tweetCount: number;
  /** URL を含むツイート数 (tweetCount 以下) */
  urlCount: number;
};

/** スレッド 1 件分の推定コスト (セント、整数丸め) */
export function estimateXCostCents(input: XCostInput): number {
  const tweetCount = Math.max(0, Math.trunc(input.tweetCount));
  const urlCount = Math.min(tweetCount, Math.max(0, Math.trunc(input.urlCount)));
  const withoutUrl = tweetCount - urlCount;
  const raw = withoutUrl * X_POST_COST_CENTS + urlCount * X_POST_WITH_URL_COST_CENTS;
  return Math.round(raw);
}

export type BillingGuardCheck = {
  /** 当月の published + publishing + scheduled 合算 (今回の新規追加分を含まない) */
  currentMonthCentsSum: number;
  /** 今回新たに追加しようとしている合計 (セント) */
  additionalCents: number;
  /** ops_limits.x_monthly_post_limit (セント相当の閾値) */
  limitCents: number;
};

/** true = 上限超過 (KMB-E505 でブロックすべき)。境界値 (ちょうど上限) はブロックしない */
export function exceedsMonthlyBillingGuard(check: BillingGuardCheck): boolean {
  return check.currentMonthCentsSum + check.additionalCents > check.limitCents;
}
