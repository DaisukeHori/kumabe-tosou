import type { TaskStatus } from "../contracts";

/**
 * tasks.status 遷移ガード純関数 (01-crm.md §4.3)。DB 非依存 — 単体テスト対象。
 * 不変条件: status='done' ⇔ completed_at 非 NULL。cancelled からの一切の遷移は invalid (E606)。
 * done→done / open→open は冪等 no-op。
 */
export type TaskTransitionGuard =
  | { kind: "noop" }
  | { kind: "invalid" }
  | { kind: "ok"; completedAt: "now" | "clear" | "unchanged" };

export function canTransitionTaskStatus(from: TaskStatus, to: TaskStatus): TaskTransitionGuard {
  // cancelled は終端 — 自己遷移 (cancelled→cancelled) も含め「一切の遷移」を拒否する
  // (§4.3: 「cancelled からの一切の遷移は KMB-E606」。done/open の自己遷移のみが冪等 no-op)。
  if (from === "cancelled") return { kind: "invalid" };
  if (from === to) return { kind: "noop" };
  if (from === "open" && to === "done") return { kind: "ok", completedAt: "now" };
  if (from === "done" && to === "open") return { kind: "ok", completedAt: "clear" };
  if (from === "open" && to === "cancelled") return { kind: "ok", completedAt: "unchanged" };
  return { kind: "invalid" };
}
