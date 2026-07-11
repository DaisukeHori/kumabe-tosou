import { describe, expect, it } from "vitest";

import type { TaskStatus } from "@/modules/crm/contracts";
import { canTransitionTaskStatus } from "@/modules/crm/internal/task-machine";

/**
 * canonical: docs/design/crm-suite/01-crm.md §4.3 (tasks.status 状態機械)。
 * 不変条件: status='done' ⇔ completed_at 非 NULL。cancelled からの一切の遷移 (自己遷移含む) は
 * invalid (KMB-E606)。done→done / open→open は冪等 no-op。
 */

const ALL_STATUSES: TaskStatus[] = ["open", "done", "cancelled"];

describe("canTransitionTaskStatus", () => {
  it("open→done は ok・completedAt='now'", () => {
    expect(canTransitionTaskStatus("open", "done")).toEqual({ kind: "ok", completedAt: "now" });
  });

  it("done→open は ok・completedAt='clear'", () => {
    expect(canTransitionTaskStatus("done", "open")).toEqual({ kind: "ok", completedAt: "clear" });
  });

  it("open→cancelled は ok・completedAt='unchanged' (終端遷移)", () => {
    expect(canTransitionTaskStatus("open", "cancelled")).toEqual({ kind: "ok", completedAt: "unchanged" });
  });

  it("done→done は冪等 no-op", () => {
    expect(canTransitionTaskStatus("done", "done")).toEqual({ kind: "noop" });
  });

  it("open→open は冪等 no-op", () => {
    expect(canTransitionTaskStatus("open", "open")).toEqual({ kind: "noop" });
  });

  it("cancelled からの一切の遷移は invalid (自己遷移 cancelled→cancelled も含む — §4.3 の文言どおり)", () => {
    for (const to of ALL_STATUSES) {
      expect(canTransitionTaskStatus("cancelled", to), `cancelled→${to}`).toEqual({ kind: "invalid" });
    }
  });

  it("done→cancelled は設計上未定義の遷移として invalid (cancelTask は open 起点のみ想定)", () => {
    expect(canTransitionTaskStatus("done", "cancelled")).toEqual({ kind: "invalid" });
  });

  it("全 9 通りを網羅する (3 status × 3 status)", () => {
    let total = 0;
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const result = canTransitionTaskStatus(from, to);
        expect(result.kind).toMatch(/^(noop|invalid|ok)$/);
        total++;
      }
    }
    expect(total).toBe(9);
  });
});
