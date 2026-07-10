import { describe, expect, it } from "vitest";

import {
  MAX_STAGE_ATTEMPTS,
  RUNNABLE_STATUSES,
  isRunnableStatus,
  needsImageStage,
  nextStatusAfterStage,
  stageToRun,
} from "@/modules/ai-studio/internal/stage-machine";

/**
 * advance() の状態遷移表 (canonical: docs/design/cms-ai-pipeline.md §7.6 / §4.2)。
 * pending→extracting→(researching)→drafting→ready_for_review の 1 stage = 1 advance
 * 呼び出しという設計と 1:1 であることを検証する (設計書 §11「stage 遷移表」)。
 */
describe("ai-studio stage-machine", () => {
  it("RUNNABLE_STATUSES に 'ready_for_review' 等の終端状態が含まれない (P4: image_generation を含む)", () => {
    expect(RUNNABLE_STATUSES).toEqual([
      "pending",
      "extracting",
      "researching",
      "drafting",
      "image_generation",
    ]);
    expect(isRunnableStatus("drafting")).toBe(true);
    expect(isRunnableStatus("image_generation")).toBe(true);
    expect(isRunnableStatus("ready_for_review")).toBe(false);
    expect(isRunnableStatus("completed")).toBe(false);
    expect(isRunnableStatus("failed")).toBe(false);
    expect(isRunnableStatus("cancelled")).toBe(false);
  });

  it("stageToRun: 'pending' 以外の runnable status は自身と同名の stage を返す (bootstrap 済み前提)", () => {
    expect(stageToRun("extracting")).toBe("extracting");
    expect(stageToRun("researching")).toBe("researching");
    expect(stageToRun("drafting")).toBe("drafting");
    expect(stageToRun("image_generation")).toBe("image_generation");
  });

  it("needsImageStage: target_channels に x または instagram を含む場合のみ true (P4 §7)", () => {
    expect(needsImageStage(["site_blog"])).toBe(false);
    expect(needsImageStage(["site_blog", "note"])).toBe(false);
    expect(needsImageStage(["x"])).toBe(true);
    expect(needsImageStage(["instagram"])).toBe(true);
    expect(needsImageStage(["site_blog", "x"])).toBe(true);
    expect(needsImageStage(["note", "instagram"])).toBe(true);
    expect(needsImageStage([])).toBe(false);
  });

  it("nextStatusAfterStage: extracting 完了後、research 有効なら researching へ", () => {
    expect(nextStatusAfterStage("extracting", true)).toBe("researching");
  });

  it("nextStatusAfterStage: extracting 完了後、research 無効なら researching をスキップして drafting へ", () => {
    expect(nextStatusAfterStage("extracting", false)).toBe("drafting");
  });

  it("nextStatusAfterStage: researching 完了後は常に drafting へ", () => {
    expect(nextStatusAfterStage("researching", true)).toBe("drafting");
    expect(nextStatusAfterStage("researching", false)).toBe("drafting");
  });

  it("nextStatusAfterStage: drafting 完了後、targetChannels 省略 (既定 []) なら ready_for_review へ直行 (非退行)", () => {
    expect(nextStatusAfterStage("drafting", true)).toBe("ready_for_review");
    expect(nextStatusAfterStage("drafting", false)).toBe("ready_for_review");
  });

  it("nextStatusAfterStage: drafting 完了後、X/Instagram を含まない run は image_generation を skip して ready_for_review へ (P4 §7)", () => {
    expect(nextStatusAfterStage("drafting", true, ["site_blog"])).toBe("ready_for_review");
    expect(nextStatusAfterStage("drafting", false, ["site_blog", "note"])).toBe("ready_for_review");
  });

  it("nextStatusAfterStage: drafting 完了後、X または Instagram を含む run は image_generation へ (P4 §7)", () => {
    expect(nextStatusAfterStage("drafting", true, ["x"])).toBe("image_generation");
    expect(nextStatusAfterStage("drafting", false, ["instagram"])).toBe("image_generation");
    expect(nextStatusAfterStage("drafting", true, ["site_blog", "x", "instagram"])).toBe("image_generation");
  });

  it("nextStatusAfterStage: image_generation 完了後は常に ready_for_review へ (成功/部分成功/0枚いずれも graceful に前進)", () => {
    expect(nextStatusAfterStage("image_generation", true)).toBe("ready_for_review");
    expect(nextStatusAfterStage("image_generation", false, ["x"])).toBe("ready_for_review");
  });

  it("MAX_STAGE_ATTEMPTS は 3 (stage_attempts > 3 → failed、§7.6)", () => {
    expect(MAX_STAGE_ATTEMPTS).toBe(3);
  });

  it("全 runnable status を通しで辿ると必ず ready_for_review に到達する (research 有効、SNS チャネル無し)", () => {
    let status: string = "pending";
    const visited: string[] = [status];
    // pending は lease 取得時に 'extracting' へ bootstrap される前提でシミュレート
    status = "extracting";
    for (let i = 0; i < 10 && status !== "ready_for_review"; i++) {
      visited.push(status);
      status = nextStatusAfterStage(stageToRun(status as never), true, ["site_blog"]);
    }
    expect(status).toBe("ready_for_review");
    expect(visited).toEqual(["pending", "extracting", "researching", "drafting"]);
  });

  it("全 runnable status を通しで辿ると必ず ready_for_review に到達する (research 無効、researching をスキップ、SNS チャネル無し)", () => {
    let status: string = "extracting";
    const visited: string[] = [];
    for (let i = 0; i < 10 && status !== "ready_for_review"; i++) {
      visited.push(status);
      status = nextStatusAfterStage(stageToRun(status as never), false, ["site_blog"]);
    }
    expect(status).toBe("ready_for_review");
    expect(visited).toEqual(["extracting", "drafting"]);
  });

  it("全 runnable status を通しで辿ると必ず ready_for_review に到達する (X を含む run は image_generation を経由する、P4)", () => {
    let status: string = "extracting";
    const visited: string[] = [];
    for (let i = 0; i < 10 && status !== "ready_for_review"; i++) {
      visited.push(status);
      status = nextStatusAfterStage(stageToRun(status as never), false, ["x"]);
    }
    expect(status).toBe("ready_for_review");
    expect(visited).toEqual(["extracting", "drafting", "image_generation"]);
  });
});

/**
 * Codex BLOCKER 回帰: lease の stage_attempts が stage 遷移でリセットされないバグ
 * (migration 20260710000019_ai_runs_image_stage.sql の ai_run_acquire_lease /
 * ai_run_commit_stage / ai_run_commit_image_stage)。
 *
 * この repo の vitest はプレーン Node 環境で DB を持たないため (tests/ai-draft-cleanup-predicate.test.ts
 * と同型の方針)、SQL の CAS + リセット意味論を 1:1 で転記した純粋関数シミュレータをここに複製し、
 * 「1 stage あたり最大 3 回まで acquire できる」設計が stage をまたいでも壊れないことを回帰させる。
 *
 * 実SQL相当性の担保: 2026-07-10、ローカル Postgres 16 (homebrew, docker 不使用) に最小スキーマ
 * (profiles / ai_sources / ai_runs / channel_drafts / draft_revisions) + is_admin() スタブを作成し、
 * 修正後の migration 20260710000019 (ai_run_acquire_lease / ai_run_commit_stage /
 * ai_run_commit_image_stage) を適用して以下を実測済み (一時クラスタは検証後に破棄、コミットに残していない):
 *   - 修正前の関数定義 (migration 0009 相当) では `ai_run_acquire_lease` の初回呼び出しが必ず
 *     `ERROR: column reference "id" is ambiguous` で失敗すること (RETURNS TABLE の OUT 列名が
 *     ai_runs の実列名と一致し、plpgsql.variable_conflict=error のデフォルトで無修飾識別子が
 *     曖昧になるため)。`#variable_conflict use_column` 追加で解消することを確認。
 *   - 修正後、正常フロー pending→extracting→researching→drafting→image_generation→
 *     ready_for_review を通しで実行し、image_generation の acquire が
 *     (旧バグでは stage_attempts が総 acquire 数のまま蓄積し exhausted になっていたところ)
 *     result_kind='acquired' になること (=本テストの核)。
 *   - 同一 stage を 3 回 acquire しても commit しない場合は従来どおり 4 回目で exhausted/failed
 *     (KMB-E402) になること (リトライ上限は維持)。
 *   - commit の CAS 不一致 (no-op) 経路では stage_attempts がリセットされないこと (冪等性維持)。
 *
 * SQL 側 (migration) を変更した場合は、このシミュレータも同時に更新すること。
 */
describe("ai-studio lease stage_attempts リセット (実 Postgres 16 で cross-check 済み)", () => {
  const MAX_ATTEMPTS = 3;

  type SimRun = {
    status: string;
    stageAttempts: number;
    leaseHeld: boolean;
  };

  const RUNNABLE = new Set(["pending", "extracting", "researching", "drafting", "image_generation"]);

  /** ai_run_acquire_lease の CAS 意味論の複製 (lease 期限切れは常に想定、held 判定は対象外)。 */
  function simulateAcquire(run: SimRun): { result: "acquired" | "exhausted" | "terminal"; run: SimRun } {
    if (!RUNNABLE.has(run.status)) {
      return { result: "terminal", run };
    }
    if (run.stageAttempts >= MAX_ATTEMPTS) {
      return { result: "exhausted", run: { ...run, status: "failed", leaseHeld: false } };
    }
    const nextStatus = run.status === "pending" ? "extracting" : run.status;
    return {
      result: "acquired",
      run: { status: nextStatus, stageAttempts: run.stageAttempts + 1, leaseHeld: true },
    };
  }

  /**
   * ai_run_commit_stage / ai_run_commit_image_stage の CAS + リセット意味論の複製。
   * expectedStatus が現在の status と一致する場合のみ実際に前進し、stage_attempts を 0 に
   * リセットする。不一致なら no-op (現在の run をそのまま返す、stage_attempts 変更なし)。
   */
  function simulateCommit(run: SimRun, expectedStatus: string, nextStatus: string): SimRun {
    if (run.status !== expectedStatus) {
      return run; // CAS 不一致 = no-op (冪等)。stage_attempts は触らない。
    }
    return { status: nextStatus, stageAttempts: 0, leaseHeld: false };
  }

  it("正常フロー全体: 各 stage で 1 回 acquire しても image_generation の acquire が exhausted にならない (Codex BLOCKER の核)", () => {
    let run: SimRun = { status: "pending", stageAttempts: 0, leaseHeld: false };
    const acquiredResults: string[] = [];

    let r = simulateAcquire(run);
    acquiredResults.push(r.result);
    run = r.run;
    expect(run.status).toBe("extracting");
    expect(run.stageAttempts).toBe(1);

    run = simulateCommit(run, "extracting", nextStatusAfterStage("extracting", true));
    expect(run.status).toBe("researching");
    expect(run.stageAttempts).toBe(0); // リセット確認

    r = simulateAcquire(run);
    acquiredResults.push(r.result);
    run = r.run;
    expect(run.stageAttempts).toBe(1);

    run = simulateCommit(run, "researching", nextStatusAfterStage("researching", true));
    expect(run.status).toBe("drafting");
    expect(run.stageAttempts).toBe(0); // リセット確認

    r = simulateAcquire(run);
    acquiredResults.push(r.result);
    run = r.run;
    expect(run.stageAttempts).toBe(1);

    run = simulateCommit(run, "drafting", nextStatusAfterStage("drafting", true, ["x"]));
    expect(run.status).toBe("image_generation");
    expect(run.stageAttempts).toBe(0); // リセット確認

    // *** 核心: image_generation の acquire。旧バグでは stage_attempts が総 acquire 数
    // (この時点で 3) のまま蓄積しており、ここで exhausted (failed/KMB-E402) になっていた。
    r = simulateAcquire(run);
    acquiredResults.push(r.result);
    run = r.run;
    expect(r.result).toBe("acquired");
    expect(run.status).toBe("image_generation");
    expect(run.stageAttempts).toBe(1);

    run = simulateCommit(run, "image_generation", nextStatusAfterStage("image_generation", true));
    expect(run.status).toBe("ready_for_review");
    expect(run.stageAttempts).toBe(0);

    expect(acquiredResults).toEqual(["acquired", "acquired", "acquired", "acquired"]);
  });

  it("リトライ上限は維持: 同一 stage を 3 回 acquire しても commit しない場合、4 回目で exhausted (failed/KMB-E402)", () => {
    let run: SimRun = { status: "extracting", stageAttempts: 0, leaseHeld: false };

    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      const r = simulateAcquire(run);
      expect(r.result).toBe("acquired");
      expect(r.run.stageAttempts).toBe(i);
      run = r.run;
    }

    const exhausted = simulateAcquire(run);
    expect(exhausted.result).toBe("exhausted");
    expect(exhausted.run.status).toBe("failed");
  });

  it("冪等性: commit の CAS 不一致 (no-op) 経路では stage_attempts がリセットされない", () => {
    const run: SimRun = { status: "researching", stageAttempts: 2, leaseHeld: true };

    // expectedStatus が古い ('extracting') ため no-op。researching のまま、attempts=2 のまま。
    const afterStaleCommit = simulateCommit(run, "extracting", "researching");
    expect(afterStaleCommit).toEqual(run);
    expect(afterStaleCommit.stageAttempts).toBe(2);

    // 正しい expectedStatus なら前進し、attempts はリセットされる。
    const afterRealCommit = simulateCommit(run, "researching", "drafting");
    expect(afterRealCommit.status).toBe("drafting");
    expect(afterRealCommit.stageAttempts).toBe(0);
  });
});
