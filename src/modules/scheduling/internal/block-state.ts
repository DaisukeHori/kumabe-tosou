/**
 * work_blocks 状態機械 (canonical: docs/design/crm-suite/03-scheduling.md §5.1)。
 * DB 非依存の純関数のみ (sales/internal/state.ts の TRANSITION_EDGES + canTransition と同型)。
 *
 * §5.1 の許可遷移表を 5×5 でエッジ列挙する。表に ✅ が付いたセルのみ true。
 * done→done (実績訂正) は「遷移」ではなく自己ループだが、表では明示的に ✅ が付いているため
 * エッジとして追加する (実装計画書の指示どおり)。scheduled→scheduled (placeBlock による移動) も
 * 同様に表が明示的に ✅ を付けているため追加する。一方 backlog→backlog / in_progress→in_progress /
 * cancelled→cancelled は表で「—」(対角線・操作なし) と表記されており ✅ ではないため、
 * このモジュールでは false 扱いにする (「表外の遷移は全て E703」の受入基準を厳格に満たすため、
 * ✅ の付いたセルのみを true とする保守的な解釈)。
 *
 * 例外: in_progress のブロックに対する placeBlock (時刻変更) は §5.1 の表の in_progress→scheduled
 * セルこそ ✗ (「状態は戻さない」) だが、同セルの注記に「時刻変更は placeBlock で可 — in_progress
 * 維持」と明記されている。つまり in_progress→in_progress (状態を変えずに時刻だけ変える) は
 * canTransitionBlock の対象外の別操作であり、この表のセル (「—」) では表現しきれない。
 * そのため配置可否は canTransitionBlock を流用せず、専用の canPlaceBlock() で判定する
 * (下記参照)。
 */

import type { WorkBlockStatus } from "../contracts";

type TransitionEdge = { from: WorkBlockStatus; to: WorkBlockStatus };

/**
 * §5.1 表の ✅ セルと 1:1 (10 エッジ)。
 * - backlog: → scheduled (placeBlock) / → cancelled (cancel)
 * - scheduled: → backlog (unschedule) / → scheduled (placeBlock 移動) / → in_progress (着手) /
 *   → done (recordActual) / → cancelled (cancel)
 * - in_progress: → done (recordActual) / → cancelled (cancel)
 * - done: → done (recordActual 実績訂正)
 * - cancelled: (終端。from としてのエッジなし)
 */
const TRANSITION_EDGES: readonly TransitionEdge[] = [
  { from: "backlog", to: "scheduled" },
  { from: "backlog", to: "cancelled" },
  { from: "scheduled", to: "backlog" },
  { from: "scheduled", to: "scheduled" },
  { from: "scheduled", to: "in_progress" },
  { from: "scheduled", to: "done" },
  { from: "scheduled", to: "cancelled" },
  { from: "in_progress", to: "done" },
  { from: "in_progress", to: "cancelled" },
  { from: "done", to: "done" },
];

/**
 * §5.1 許可遷移表が持つ全エッジを判定する純関数。DB 非依存。
 * unscheduleBlock (→backlog) / transitionBlock (→in_progress|cancelled) / recordActual (→done) の
 * 遷移ガードに使う。placeBlock の配置可否判定には使わない (上記コメント参照 — canPlaceBlock を使う)。
 */
export function canTransitionBlock(from: WorkBlockStatus, to: WorkBlockStatus): boolean {
  return TRANSITION_EDGES.some((edge) => edge.from === from && edge.to === to);
}

/**
 * placeBlock (配置・移動) の可否判定。§5.1 表では backlog→scheduled と scheduled→scheduled が
 * ✅ で表現されているため canTransitionBlock(status, "scheduled") で判定できるが、
 * in_progress のブロックは「状態を in_progress に維持したまま時刻だけ変える」という表では
 * 表現しきれない操作が許可されている (§5.1 in_progress 行の注記) ため、in_progress を明示的に
 * 追加で許可する。done / cancelled はどちらの経路でも false になり E703 で拒否される。
 */
export function canPlaceBlock(status: WorkBlockStatus): boolean {
  return canTransitionBlock(status, "scheduled") || status === "in_progress";
}

/**
 * placeBlock 成功時に導出される新しい status。backlog は scheduled へ (§5.1-6)。
 * scheduled/in_progress は現状維持 (時刻だけ変わる)。canPlaceBlock(status) が true の場合のみ
 * 呼び出すこと (done/cancelled を渡した場合の戻り値は未定義動作として扱わない — 呼び出し元が
 * 事前に canPlaceBlock で弾く契約)。
 */
export function derivePlacementStatus(status: WorkBlockStatus): WorkBlockStatus {
  return status === "backlog" ? "scheduled" : status;
}

/**
 * 削除可否判定 (§5.1 不変条件 5)。backlog / cancelled のみ物理 DELETE 可。
 * hasUndeletedExternalLink = true (calendar_event_links に external_event_id 非 NULL の行が
 * 残っている) の場合は backlog/cancelled であっても削除不可 (cascade によるゴースト外部予定の
 * 防止)。この Issue (#53) 時点では calendar_event_links テーブルが存在しない (#54 で追加) ため、
 * 呼び出し元 (facade) は常に hasUndeletedExternalLink=false を渡す — 引数として残すのは #54 が
 * 実データを繋いだ際にこの関数のシグネチャ変更を不要にするため (安全側の設計判断)。
 */
export function assertDeletable(status: WorkBlockStatus, hasUndeletedExternalLink: boolean): boolean {
  if (status !== "backlog" && status !== "cancelled") return false;
  if (hasUndeletedExternalLink) return false;
  return true;
}

/**
 * createBlock の status 導出 (§5.1-6)。配置入力 (starts_at/ends_at 非 NULL) ありなら
 * 'scheduled' で直接生成 (status='backlog' のまま starts_at 非 NULL で INSERT すると
 * DB check work_blocks_backlog_unplaced 違反になるため、表の遷移を経ずに直接 scheduled にする
 * — これが「遷移表の例外」)。なしなら 'backlog'。
 */
export function deriveCreateStatus(hasPlacement: boolean): "backlog" | "scheduled" {
  return hasPlacement ? "scheduled" : "backlog";
}
