import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: GitHub Issue #99 成果物3「やることカンバン」/ 01-crm.md §8.4。
 * src/app/admin/tasks/task-groups.ts (page.tsx から #99 で抽出。挙動は変えていない) の
 * 期日バケット分配 (bucketOpenTasks/groupOpenTasks) と DnD/Shift+←→ の期日決定規則
 * (dueDateForBucket) を検証する。
 *
 * task-groups.ts の jstTodayDateOnly/jstWeekRange は crm/internal/jst.ts と異なり `now` を
 * 注入できない (Date.now() 直読み — page.tsx の元実装のまま移設したため) — vi.useFakeTimers +
 * setSystemTime で決定的にする (tests/crm-jst.test.ts の参照日と同じ 2026-07-12 (日) /
 * 2026-07-13 (月) を使う。date コマンド実測 + Date.getUTCDay() で確認済み)。
 */

import {
  bucketOpenTasks,
  dueDateForBucket,
  groupOpenTasks,
  jstTodayDateOnly,
  jstWeekRange,
} from "@/app/admin/tasks/task-groups";
import type { TaskListItem } from "@/modules/crm/contracts";

function task(overrides: Partial<TaskListItem> & { id: string }): TaskListItem {
  return {
    title: "タスク",
    body: null,
    due_on: null,
    status: "open",
    origin: "manual",
    deal: null,
    customer: null,
    overdue: false,
    updated_at: "2026-07-11T00:00:00.000Z",
    ...overrides,
  };
}

function setJstNow(isoUtc: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(isoUtc));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("jstTodayDateOnly / jstWeekRange (task-groups.ts の +9h シフト再実装)", () => {
  it("JST 火曜日 (2026-07-14 12:00 = UTC 2026-07-14T03:00Z) は当該週 [月07-13, 日07-19] に属する", () => {
    setJstNow("2026-07-14T03:00:00.000Z");
    expect(jstTodayDateOnly()).toBe("2026-07-14");
    expect(jstWeekRange()).toEqual({ from: "2026-07-13", to: "2026-07-19" });
  });

  it("JST 日曜日 (2026-07-12 12:00 = UTC 2026-07-12T03:00Z) は同じ週 [月07-06, 日07-12] に属し、today = 週末日", () => {
    setJstNow("2026-07-12T03:00:00.000Z");
    expect(jstTodayDateOnly()).toBe("2026-07-12");
    expect(jstWeekRange()).toEqual({ from: "2026-07-06", to: "2026-07-12" });
  });
});

describe("bucketOpenTasks (due_on/overdue から5バケットへの分配)", () => {
  beforeEach(() => {
    setJstNow("2026-07-14T03:00:00.000Z"); // JST 2026-07-14 (火)。週: 07-13(月)〜07-19(日)
  });

  it("overdue フラグが立つタスクは due_on に関わらず overdue バケットへ入る", () => {
    const t = task({ id: "t-overdue", due_on: "2026-07-01", overdue: true });
    const buckets = bucketOpenTasks([t]);
    expect(buckets.overdue).toEqual([t]);
    expect(buckets.today).toEqual([]);
  });

  it("due_on が今日と一致すれば today バケットへ入る", () => {
    const t = task({ id: "t-today", due_on: "2026-07-14", overdue: false });
    const buckets = bucketOpenTasks([t]);
    expect(buckets.today).toEqual([t]);
  });

  it("due_on が今週の範囲内 (今日を除く) なら week バケットへ入る", () => {
    const t = task({ id: "t-week", due_on: "2026-07-19", overdue: false }); // 週末 (日)
    const buckets = bucketOpenTasks([t]);
    expect(buckets.week).toEqual([t]);
  });

  it("due_on が来週以降なら later バケットへ入る", () => {
    const t = task({ id: "t-later", due_on: "2026-07-20", overdue: false }); // 来週月曜
    const buckets = bucketOpenTasks([t]);
    expect(buckets.later).toEqual([t]);
  });

  it("due_on が null なら no_due バケットへ入る", () => {
    const t = task({ id: "t-nodue", due_on: null });
    const buckets = bucketOpenTasks([t]);
    expect(buckets.no_due).toEqual([t]);
  });
});

describe("groupOpenTasks (空グループを非表示にする — page.tsx のリスト表示用)", () => {
  beforeEach(() => {
    setJstNow("2026-07-14T03:00:00.000Z");
  });

  it("タスクが存在するバケットのみ overdue→today→week→later→no_due の順で返す", () => {
    const groups = groupOpenTasks([
      task({ id: "t-nodue", due_on: null }),
      task({ id: "t-today", due_on: "2026-07-14" }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["today", "no_due"]);
    expect(groups.find((g) => g.key === "today")?.tasks.map((t) => t.id)).toEqual(["t-today"]);
  });

  it("該当タスクが無いバケットは結果に含まれない (空配列を返さず要素ごと除外)", () => {
    const groups = groupOpenTasks([task({ id: "t-today", due_on: "2026-07-14" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("today");
  });
});

describe("dueDateForBucket (DnD/Shift+←→ の期日決定規則、#99 受入基準)", () => {
  it("JST 火曜日 (週の途中): today→当日 / week→今週日曜 / later→来週月曜 / no_due→null", () => {
    setJstNow("2026-07-14T03:00:00.000Z"); // 週: 07-13(月)〜07-19(日)
    expect(dueDateForBucket("today")).toBe("2026-07-14");
    expect(dueDateForBucket("week")).toBe("2026-07-19");
    expect(dueDateForBucket("later")).toBe("2026-07-20");
    expect(dueDateForBucket("no_due")).toBeNull();
  });

  it("今日が日曜のとき week→today と同じ日になる (『今日が日曜なら今日扱い』仕様)", () => {
    setJstNow("2026-07-12T03:00:00.000Z"); // JST 日曜 2026-07-12。週末日 = 今日
    expect(jstTodayDateOnly()).toBe("2026-07-12");
    expect(dueDateForBucket("week")).toBe(dueDateForBucket("today"));
    expect(dueDateForBucket("week")).toBe("2026-07-12");
  });

  it("later は週境界をまたいでも常に『今週日曜+1日』(来週月曜) になる", () => {
    setJstNow("2026-07-13T03:00:00.000Z"); // JST 月曜 2026-07-13 (週初め)。週: 07-13〜07-19
    expect(dueDateForBucket("later")).toBe("2026-07-20");
  });
});
