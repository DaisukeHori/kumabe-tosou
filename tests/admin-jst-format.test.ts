import { describe, expect, it } from "vitest";

import { formatJstDate, formatJstDateTime } from "@/app/admin/_ui/jst-format";

/**
 * #418 (hydration mismatch) 回帰: admin 一覧/詳細の timestamptz 表示を JST 固定で
 * 決定的に整形する。TZ 未指定の toLocaleString が SSR(UTC)/クライアント(JST)で
 * ずれるのを防ぐため、UTC 15:00 = JST 翌日 00:00 の日跨ぎと年跨ぎを重点検証する。
 * これらは実行環境の TZ に依存せず常に同じ文字列を返さねばならない。
 */

describe("formatJstDate (YYYY/MM/DD, JST 固定)", () => {
  it("UTC 14:59 は JST 同日 (23:59) のまま", () => {
    expect(formatJstDate("2026-07-11T14:59:00.000Z")).toBe("2026/07/11");
  });

  it("UTC 15:00 ちょうどで JST 日付が翌日に切り替わる (UTC 15:00 = JST 翌 00:00)", () => {
    expect(formatJstDate("2026-07-11T15:00:00.000Z")).toBe("2026/07/12");
  });

  it("月・日を 2 桁ゼロ埋めする", () => {
    expect(formatJstDate("2026-03-05T02:00:00.000Z")).toBe("2026/03/05");
  });

  it("年跨ぎ: UTC 12/31 15:00 は JST 翌年 1/1", () => {
    expect(formatJstDate("2026-12-31T15:00:00.000Z")).toBe("2027/01/01");
  });
});

describe("formatJstDateTime (YYYY/MM/DD HH:MM, JST 固定)", () => {
  it("UTC 00:30 は JST 09:30 (+9h)", () => {
    expect(formatJstDateTime("2026-07-17T00:30:00.000Z")).toBe("2026/07/17 09:30");
  });

  it("UTC 15:00 は JST 翌日 00:00 (日付ロールオーバー + 時刻ゼロ埋め)", () => {
    expect(formatJstDateTime("2026-07-11T15:00:00.000Z")).toBe("2026/07/12 00:00");
  });

  it("時・分を 2 桁ゼロ埋めする", () => {
    expect(formatJstDateTime("2026-07-17T22:05:00.000Z")).toBe("2026/07/18 07:05");
  });

  it("年跨ぎ: UTC 12/31 15:30 は JST 翌年 1/1 00:30", () => {
    expect(formatJstDateTime("2026-12-31T15:30:00.000Z")).toBe("2027/01/01 00:30");
  });
});
