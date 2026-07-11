import { describe, expect, it } from "vitest";

import {
  isDueThisWeekJst,
  isDueTodayJst,
  isOverdueJst,
  jstTodayDateOnly,
  jstTomorrowDateOnly,
  jstWeekRange,
} from "@/modules/crm/internal/jst";

/**
 * canonical: docs/design/crm-suite/01-crm.md §2.5 / §11.2。
 * UTC 15:00 (= JST 0:00) 跨ぎ・週跨ぎ (月曜起点)・overdue 判定を検証する。
 * 参照日: 2026-07-12 は日曜日、2026-07-06 と 2026-07-13 は月曜日 (date コマンド実測 + Date.getUTCDay() で確認済み)。
 */

describe("jstTodayDateOnly (UTC 15:00 = JST 0:00 の境界)", () => {
  it("UTC 14:59 は JST 前日の日付のまま", () => {
    expect(jstTodayDateOnly(new Date("2026-07-11T14:59:00.000Z"))).toBe("2026-07-11");
  });

  it("UTC 15:00 ちょうどで JST 日付が翌日に切り替わる", () => {
    expect(jstTodayDateOnly(new Date("2026-07-11T15:00:00.000Z"))).toBe("2026-07-12");
  });

  it("UTC 15:01 も JST 翌日のまま", () => {
    expect(jstTodayDateOnly(new Date("2026-07-11T15:01:00.000Z"))).toBe("2026-07-12");
  });
});

describe("jstTomorrowDateOnly (intake §6.5 手順5 の折り返しタスク due_on)", () => {
  it("UTC 15:00 未満は当日 JST の翌日を返す", () => {
    expect(jstTomorrowDateOnly(new Date("2026-07-11T14:59:00.000Z"))).toBe("2026-07-12");
  });

  it("UTC 15:00 以降は JST 日付が 1 日進んだ状態からさらに翌日を返す", () => {
    expect(jstTomorrowDateOnly(new Date("2026-07-11T15:00:00.000Z"))).toBe("2026-07-13");
  });
});

describe("jstWeekRange (JST 月曜起点の週。日曜日・月曜日それぞれの境界を確認)", () => {
  it("JST 日曜日 (2026-07-12) は同じ週 [2026-07-06 (月), 2026-07-12 (日)] に属する", () => {
    // JST 2026-07-12 12:00 = UTC 2026-07-12T03:00:00Z
    expect(jstWeekRange(new Date("2026-07-12T03:00:00.000Z"))).toEqual({ from: "2026-07-06", to: "2026-07-12" });
  });

  it("JST 月曜日 (2026-07-13、翌週) は [2026-07-13, 2026-07-19] に切り替わる (週またぎ)", () => {
    // JST 2026-07-13 12:00 = UTC 2026-07-13T03:00:00Z
    expect(jstWeekRange(new Date("2026-07-13T03:00:00.000Z"))).toEqual({ from: "2026-07-13", to: "2026-07-19" });
  });

  it("JST 土曜日 (2026-07-11) も 2026-07-12 と同じ週に属する", () => {
    // JST 2026-07-11 12:00 = UTC 2026-07-11T03:00:00Z
    expect(jstWeekRange(new Date("2026-07-11T03:00:00.000Z"))).toEqual({ from: "2026-07-06", to: "2026-07-12" });
  });

  it("UTC 15:00 の日跨ぎで週も正しく切り替わる (JST 日曜 23:59 → 月曜 00:00)", () => {
    // JST 2026-07-12 23:59 = UTC 2026-07-12T14:59:00Z (まだ日曜の週)
    expect(jstWeekRange(new Date("2026-07-12T14:59:00.000Z"))).toEqual({ from: "2026-07-06", to: "2026-07-12" });
    // JST 2026-07-13 00:00 = UTC 2026-07-12T15:00:00Z (月曜の新しい週へ)
    expect(jstWeekRange(new Date("2026-07-12T15:00:00.000Z"))).toEqual({ from: "2026-07-13", to: "2026-07-19" });
  });
});

describe("isOverdueJst (due_on < JST 今日)", () => {
  const today = new Date("2026-07-12T03:00:00.000Z"); // JST 2026-07-12

  it("due_on が今日より過去なら true", () => {
    expect(isOverdueJst("2026-07-11", today)).toBe(true);
  });

  it("due_on が今日と同じなら false (「今日」バケット扱い)", () => {
    expect(isOverdueJst("2026-07-12", today)).toBe(false);
  });

  it("due_on が未来なら false", () => {
    expect(isOverdueJst("2026-07-13", today)).toBe(false);
  });

  it("due_on が null なら false (対象外)", () => {
    expect(isOverdueJst(null, today)).toBe(false);
  });
});

describe("isDueTodayJst", () => {
  const today = new Date("2026-07-12T03:00:00.000Z");

  it("due_on が今日と一致すれば true", () => {
    expect(isDueTodayJst("2026-07-12", today)).toBe(true);
  });

  it("due_on が今日と不一致なら false", () => {
    expect(isDueTodayJst("2026-07-11", today)).toBe(false);
    expect(isDueTodayJst("2026-07-13", today)).toBe(false);
  });

  it("due_on が null なら false", () => {
    expect(isDueTodayJst(null, today)).toBe(false);
  });
});

describe("isDueThisWeekJst (週跨ぎの境界を確認)", () => {
  const nowInWeek = new Date("2026-07-12T03:00:00.000Z"); // 週: 2026-07-06〜2026-07-12

  it("週の範囲内 (月曜・日曜含む) は true", () => {
    expect(isDueThisWeekJst("2026-07-06", nowInWeek)).toBe(true); // 週初め (月)
    expect(isDueThisWeekJst("2026-07-12", nowInWeek)).toBe(true); // 週末 (日)
    expect(isDueThisWeekJst("2026-07-09", nowInWeek)).toBe(true); // 週中日
  });

  it("週の範囲外 (前週の日曜・翌週の月曜) は false", () => {
    expect(isDueThisWeekJst("2026-07-05", nowInWeek)).toBe(false); // 前週の日曜
    expect(isDueThisWeekJst("2026-07-13", nowInWeek)).toBe(false); // 翌週の月曜
  });

  it("due_on が null なら false", () => {
    expect(isDueThisWeekJst(null, nowInWeek)).toBe(false);
  });
});
