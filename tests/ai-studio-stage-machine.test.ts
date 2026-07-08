import { describe, expect, it } from "vitest";

import {
  MAX_STAGE_ATTEMPTS,
  RUNNABLE_STATUSES,
  isRunnableStatus,
  nextStatusAfterStage,
  stageToRun,
} from "@/modules/ai-studio/internal/stage-machine";

/**
 * advance() の状態遷移表 (canonical: docs/design/cms-ai-pipeline.md §7.6 / §4.2)。
 * pending→extracting→(researching)→drafting→ready_for_review の 1 stage = 1 advance
 * 呼び出しという設計と 1:1 であることを検証する (設計書 §11「stage 遷移表」)。
 */
describe("ai-studio stage-machine", () => {
  it("RUNNABLE_STATUSES に 'ready_for_review' 等の終端状態が含まれない", () => {
    expect(RUNNABLE_STATUSES).toEqual(["pending", "extracting", "researching", "drafting"]);
    expect(isRunnableStatus("ready_for_review")).toBe(false);
    expect(isRunnableStatus("completed")).toBe(false);
    expect(isRunnableStatus("failed")).toBe(false);
    expect(isRunnableStatus("cancelled")).toBe(false);
  });

  it("stageToRun: 'pending' 以外の runnable status は自身と同名の stage を返す (bootstrap 済み前提)", () => {
    expect(stageToRun("extracting")).toBe("extracting");
    expect(stageToRun("researching")).toBe("researching");
    expect(stageToRun("drafting")).toBe("drafting");
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

  it("nextStatusAfterStage: drafting 完了後は常に ready_for_review へ (これ以上 advance 不要)", () => {
    expect(nextStatusAfterStage("drafting", true)).toBe("ready_for_review");
    expect(nextStatusAfterStage("drafting", false)).toBe("ready_for_review");
  });

  it("MAX_STAGE_ATTEMPTS は 3 (stage_attempts > 3 → failed、§7.6)", () => {
    expect(MAX_STAGE_ATTEMPTS).toBe(3);
  });

  it("全 runnable status を通しで辿ると必ず ready_for_review に到達する (research 有効)", () => {
    let status: string = "pending";
    const visited: string[] = [status];
    // pending は lease 取得時に 'extracting' へ bootstrap される前提でシミュレート
    status = "extracting";
    for (let i = 0; i < 10 && status !== "ready_for_review"; i++) {
      visited.push(status);
      status = nextStatusAfterStage(stageToRun(status as never), true);
    }
    expect(status).toBe("ready_for_review");
    expect(visited).toEqual(["pending", "extracting", "researching", "drafting"]);
  });

  it("全 runnable status を通しで辿ると必ず ready_for_review に到達する (research 無効、researching をスキップ)", () => {
    let status: string = "extracting";
    const visited: string[] = [];
    for (let i = 0; i < 10 && status !== "ready_for_review"; i++) {
      visited.push(status);
      status = nextStatusAfterStage(stageToRun(status as never), false);
    }
    expect(status).toBe("ready_for_review");
    expect(visited).toEqual(["extracting", "drafting"]);
  });
});
