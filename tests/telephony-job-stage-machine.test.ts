import { describe, expect, it } from "vitest";

import {
  CALL_JOB_HEARTBEAT_INTERVAL_MS,
  CALL_JOB_LEASE_TTL_MS,
  CALL_JOB_MAX_ATTEMPTS,
  TELEPHONY_WAKE_SOFT_BUDGET_MS,
  TELEPHONY_WORKER_MAX_JOBS_PER_WAKE,
  TRANSCRIBE_SEGMENT_WORST_MS,
  interpretAcquireLeaseResult,
  type AcquireLeaseRawResult,
} from "@/modules/telephony/internal/lease";
import {
  CALL_JOB_RUNNABLE_STATUSES,
  isRunnableCallJobStatus,
  nextStatusAfterStage,
  type RunnableCallJobStatus,
} from "@/modules/telephony/internal/stage-machine";

/**
 * call_jobs の lease 判別変換 (interpretAcquireLeaseResult) + stage 状態機械
 * (nextStatusAfterStage 等) + 定数値の単体テスト
 * (canonical: docs/design/crm-suite/04-telephony.md §5.1 状態表 / §2.3 lease CAS / §5.4 要件)。
 * migration 20260711000033 の call_job_acquire_lease RPC 自体は実行しない (DB非依存 —
 * tests/integration/telephony-job-rpc.sql が未実行の結合検証 artifact)。
 * tests/ai-studio-lease.test.ts + tests/ai-studio-stage-machine.test.ts と同じ粒度の合成テスト
 * (telephony は runnable 集合が単純な線形で分岐を持たない点のみ異なる — internal/stage-machine.ts
 * のファイル doc コメント参照)。
 */
describe("telephony lease 取得結果の解釈 (interpretAcquireLeaseResult)", () => {
  const base: NonNullable<AcquireLeaseRawResult> = {
    id: "11111111-1111-1111-1111-111111111111",
    status: "downloading",
    lease_expires_at: "2026-07-12T00:00:00.000Z",
    stage_attempts: 1,
    call_id: "22222222-2222-2222-2222-222222222222",
    recording_id: "33333333-3333-3333-3333-333333333333",
    transcript: null,
    analysis: null,
    result_kind: "acquired",
  };

  it("result_kind='acquired' → kind='acquired' で行データをそのまま透過する", () => {
    const raw: AcquireLeaseRawResult = { ...base, result_kind: "acquired" };
    expect(interpretAcquireLeaseResult(raw)).toEqual({ kind: "acquired", row: raw });
  });

  it("result_kind='held' → 409相当 (他プロセスが lease 保持中)", () => {
    const raw: AcquireLeaseRawResult = { ...base, result_kind: "held" };
    expect(interpretAcquireLeaseResult(raw)).toEqual({ kind: "held" });
  });

  it("result_kind='exhausted' → stage_attempts>=3 で acquire 自身が failed 化した直後", () => {
    const raw: AcquireLeaseRawResult = { ...base, status: "failed", stage_attempts: 3, result_kind: "exhausted" };
    expect(interpretAcquireLeaseResult(raw)).toEqual({ kind: "exhausted" });
  });

  it("result_kind='terminal' → 既に done/failed 等の終端状態 (status をそのまま透過)", () => {
    const raw: AcquireLeaseRawResult = { ...base, status: "done", result_kind: "terminal" };
    expect(interpretAcquireLeaseResult(raw)).toEqual({ kind: "terminal", status: "done" });

    const failedRaw: AcquireLeaseRawResult = { ...base, status: "failed", result_kind: "terminal" };
    expect(interpretAcquireLeaseResult(failedRaw)).toEqual({ kind: "terminal", status: "failed" });
  });

  it("result_kind='not_found' (プレースホルダ行あり) / raw=null (行なし) はいずれも not_found", () => {
    const raw: AcquireLeaseRawResult = { ...base, result_kind: "not_found" };
    expect(interpretAcquireLeaseResult(raw)).toEqual({ kind: "not_found" });
    expect(interpretAcquireLeaseResult(null)).toEqual({ kind: "not_found" });
  });
});

describe("telephony lease 定数値 (§5.4 要件3: TTL90秒+heartbeat20秒 / 要件4: attempts>=3失敗)", () => {
  it("CALL_JOB_LEASE_TTL_MS は 90 秒", () => {
    expect(CALL_JOB_LEASE_TTL_MS).toBe(90_000);
  });

  it("CALL_JOB_HEARTBEAT_INTERVAL_MS (20秒) は CALL_JOB_LEASE_TTL_MS (90秒) より十分短い", () => {
    expect(CALL_JOB_HEARTBEAT_INTERVAL_MS).toBe(20_000);
    expect(CALL_JOB_HEARTBEAT_INTERVAL_MS).toBeLessThan(CALL_JOB_LEASE_TTL_MS);
  });

  it("CALL_JOB_MAX_ATTEMPTS は 3 (stage_attempts>=3 → failed/KMB-E806、migration 0033 §2.3)", () => {
    expect(CALL_JOB_MAX_ATTEMPTS).toBe(3);
  });

  it("TELEPHONY_WORKER_MAX_JOBS_PER_WAKE は 2 (§7.3 due job 上限)", () => {
    expect(TELEPHONY_WORKER_MAX_JOBS_PER_WAKE).toBe(2);
  });

  it("TELEPHONY_WAKE_SOFT_BUDGET_MS (240秒) は TRANSCRIBE_SEGMENT_WORST_MS (60秒) より十分大きい (残余予算ガードが最低1ステージ分は成立する前提)", () => {
    expect(TELEPHONY_WAKE_SOFT_BUDGET_MS).toBe(240_000);
    expect(TRANSCRIBE_SEGMENT_WORST_MS).toBe(60_000);
    expect(TRANSCRIBE_SEGMENT_WORST_MS).toBeLessThan(TELEPHONY_WAKE_SOFT_BUDGET_MS);
  });
});

describe("telephony call_jobs 状態機械 (§5.1: pending→downloading→transcribing→analyzing→linking→done の単純線形、分岐なし)", () => {
  it("CALL_JOB_RUNNABLE_STATUSES は pending を含む 5 状態ちょうど (done/failed は含まない)", () => {
    expect(CALL_JOB_RUNNABLE_STATUSES).toEqual(["pending", "downloading", "transcribing", "analyzing", "linking"]);
  });

  it("isRunnableCallJobStatus: runnable 5 状態は true、終端状態 (done/failed) と未知の文字列は false", () => {
    for (const status of CALL_JOB_RUNNABLE_STATUSES) {
      expect(isRunnableCallJobStatus(status)).toBe(true);
    }
    expect(isRunnableCallJobStatus("done")).toBe(false);
    expect(isRunnableCallJobStatus("failed")).toBe(false);
    expect(isRunnableCallJobStatus("unknown")).toBe(false);
    expect(isRunnableCallJobStatus("")).toBe(false);
  });

  it("nextStatusAfterStage: downloading→transcribing→analyzing→linking→done の線形固定 (分岐なし、ai-studio との差異)", () => {
    expect(nextStatusAfterStage("downloading")).toBe("transcribing");
    expect(nextStatusAfterStage("transcribing")).toBe("analyzing");
    expect(nextStatusAfterStage("analyzing")).toBe("linking");
    expect(nextStatusAfterStage("linking")).toBe("done");
  });

  it("全 runnable status を通しで辿ると必ず done に到達する (pending は acquire が downloading へ bootstrap 済み前提でシミュレート)", () => {
    const visited: string[] = ["pending"];
    let status: Exclude<RunnableCallJobStatus, "pending"> = "downloading";
    for (let i = 0; i < 10; i++) {
      visited.push(status);
      const next = nextStatusAfterStage(status);
      if (next === "done") {
        visited.push("done");
        break;
      }
      status = next as Exclude<RunnableCallJobStatus, "pending">;
    }
    expect(visited).toEqual(["pending", "downloading", "transcribing", "analyzing", "linking", "done"]);
  });
});
