import type { RunStatus } from "../contracts";

/**
 * lease 取得ロジック (canonical: docs/design/cms-ai-pipeline.md §7.6)。
 * 実際の DB アクセス (RPC 呼び出し) は repository.ts が担い、ここでは
 * 「取得結果の分岐」を DB 実装から切り離した純粋な形で提供する
 * (単体テスト対象: tests/ai-studio-lease.test.ts)。
 */

export type AcquireLeaseRawResult = {
  id: string;
  status: RunStatus;
  lease_expires_at: string | null;
  stage_attempts: number;
  research_enabled: boolean;
  target_channels: string[];
  source_id: string;
  brief: unknown;
  research_notes: unknown;
  /** Issue #20: migration 20260714000036 で ai_run_acquire_lease の返り値に追加。 */
  style_profiles: unknown;
  result_kind: "acquired" | "held" | "exhausted" | "terminal" | "not_found";
} | null;

export type LeaseAcquireOutcome =
  | { kind: "acquired"; row: NonNullable<AcquireLeaseRawResult> }
  | { kind: "held" }
  | { kind: "exhausted" }
  | { kind: "terminal"; status: RunStatus }
  | { kind: "not_found" };

/**
 * migration 0009 `ai_run_acquire_lease` RPC の生の返り値 (単一行 or null) を
 * advance ハンドラが分岐しやすい判別共用体に変換する。
 */
export function interpretAcquireLeaseResult(raw: AcquireLeaseRawResult): LeaseAcquireOutcome {
  if (!raw || raw.result_kind === "not_found") return { kind: "not_found" };
  if (raw.result_kind === "terminal") return { kind: "terminal", status: raw.status };
  if (raw.result_kind === "exhausted") return { kind: "exhausted" };
  if (raw.result_kind === "held") return { kind: "held" };
  return { kind: "acquired", row: raw };
}

/** heartbeat の間隔 (§7.6: 20 秒ごと)。lease TTL (90s) より十分短い。 */
export const HEARTBEAT_INTERVAL_MS = 20_000;
/** lease の TTL (§7.6: +90 秒)。migration 0009 側の interval と一致させる参照値。 */
export const LEASE_TTL_MS = 90_000;
