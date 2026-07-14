import { DEAL_STAGE_REGISTRY, type CustomerLifecycle, type DealStage } from "../contracts";

/**
 * deals.stage 遷移ガード純関数 (01-crm.md §4.2)。DB 非依存 — 単体テスト対象。
 * ガード節は上から順に評価する (先に一致した節が勝つ)。
 */
export type StageTransitionGuard =
  | { kind: "noop" }
  | { kind: "invalid" }
  | { kind: "needs_reason" }
  | { kind: "ok" };

export function canTransitionDealStage(from: DealStage, to: DealStage): StageTransitionGuard {
  // from===to は終端同士 (paid,paid)/(lost,lost) を含めて noop が最優先 (§4.2 マトリクス)。
  if (from === to) return { kind: "noop" };
  if (from === "paid" || from === "lost") return { kind: "invalid" };
  if (to === "lost") return { kind: "needs_reason" };
  return { kind: "ok" };
}

/** reopenDeal 専用ガード (#102)。canTransitionDealStage は一切変更しない — 別関数として隔離する。 */
export type ReopenDealGuard = { kind: "ok" } | { kind: "invalid" };

const REOPEN_TARGET_STAGES: ReadonlySet<DealStage> = new Set([
  "inquiry", "estimating", "quote_sent", "ordered", "in_production", "delivered", "invoiced",
]);

/**
 * 終端ステージ (入金済み/失注) の案件再開ガード (01-crm.md §4.2 v1.2 — #102)。
 * from が終端 (paid/lost) かつ to が非終端 7 値のときのみ ok。それ以外 (from が非終端 / to が終端 /
 * from===to の終端同士含む) は invalid — 「終端→終端」も再開とは呼ばない (KMB-E609)。
 */
export function canReopenDeal(from: DealStage, to: DealStage): ReopenDealGuard {
  if ((from === "paid" || from === "lost") && REOPEN_TARGET_STAGES.has(to)) {
    return { kind: "ok" };
  }
  return { kind: "invalid" };
}

/**
 * won_at の初到達判定 (§4.2 不変条件 1): isWon 系ステージへの初到達時に 1 回だけ記録し、
 * 以後どの遷移でも変更しない。既に記録済みなら false (据え置き)。
 */
export function shouldRecordWonAt(to: DealStage, existingWonAt: string | null): boolean {
  return DEAL_STAGE_REGISTRY[to].isWon && existingWonAt === null;
}

/**
 * lifecycle 自動昇格判定 (§4.2 不変条件 2): isWon 系ステージへの遷移成功のたびに、
 * customer.lifecycle==='lead' なら 'customer' へ昇格する冪等条件 (「初到達時のみ」ではない —
 * supabase-js が TX を張れないため、2 文の逐次実行の間の失敗を後続遷移が自然に補修する設計)。
 */
export function shouldPromoteLifecycleOnWin(to: DealStage, currentLifecycle: CustomerLifecycle): boolean {
  return DEAL_STAGE_REGISTRY[to].isWon && currentLifecycle === "lead";
}
