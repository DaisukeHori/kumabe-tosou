import { describe, expect, it } from "vitest";

import {
  HEARTBEAT_INTERVAL_MS,
  LEASE_TTL_MS,
  interpretAcquireLeaseResult,
  type AcquireLeaseRawResult,
} from "@/modules/ai-studio/internal/lease";

/**
 * lease CAS ロジックの単体テスト (canonical: docs/design/cms-ai-pipeline.md §7.6)。
 * 実 DB (migration 0009 ai_run_acquire_lease RPC) は使わず、RPC の生の返り値
 * (result_kind の判別共用体) を分岐変換するロジックのみを検証する
 * (設計書 §11「lease 取得競合 (advance 二重呼び出し → 409)」に対応)。
 */
describe("ai-studio lease 取得結果の解釈", () => {
  const base = {
    id: "11111111-1111-1111-1111-111111111111",
    status: "extracting" as const,
    lease_expires_at: "2026-07-08T00:00:00.000Z",
    stage_attempts: 1,
    research_enabled: false,
    target_channels: ["site_blog"],
    source_id: "22222222-2222-2222-2222-222222222222",
    brief: null,
    research_notes: null,
  };

  it("result_kind='acquired' → kind='acquired' で行データをそのまま透過する", () => {
    const raw: AcquireLeaseRawResult = { ...base, result_kind: "acquired" };
    const outcome = interpretAcquireLeaseResult(raw);
    expect(outcome).toEqual({ kind: "acquired", row: raw });
  });

  it("result_kind='held' → 409 相当 (他プロセスが lease 保持中)", () => {
    const raw: AcquireLeaseRawResult = { ...base, result_kind: "held" };
    expect(interpretAcquireLeaseResult(raw)).toEqual({ kind: "held" });
  });

  it("result_kind='exhausted' → stage_attempts > 3 で failed 遷移済み", () => {
    const raw: AcquireLeaseRawResult = { ...base, status: "failed", stage_attempts: 3, result_kind: "exhausted" };
    expect(interpretAcquireLeaseResult(raw)).toEqual({ kind: "exhausted" });
  });

  it("result_kind='terminal' → 既に ready_for_review 等の終端状態", () => {
    const raw: AcquireLeaseRawResult = { ...base, status: "ready_for_review", result_kind: "terminal" };
    expect(interpretAcquireLeaseResult(raw)).toEqual({ kind: "terminal", status: "ready_for_review" });
  });

  it("result_kind='not_found' / raw=null → not_found", () => {
    const raw: AcquireLeaseRawResult = { ...base, result_kind: "not_found" };
    expect(interpretAcquireLeaseResult(raw)).toEqual({ kind: "not_found" });
    expect(interpretAcquireLeaseResult(null)).toEqual({ kind: "not_found" });
  });

  it("HEARTBEAT_INTERVAL_MS (20秒) は LEASE_TTL_MS (90秒) より十分短い", () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(20_000);
    expect(LEASE_TTL_MS).toBe(90_000);
    expect(HEARTBEAT_INTERVAL_MS).toBeLessThan(LEASE_TTL_MS);
  });
});
