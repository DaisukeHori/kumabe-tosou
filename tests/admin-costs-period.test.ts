import { describe, expect, it } from "vitest";

import { isPeriodKey, last30DaysRange, resolvePeriodRange } from "@/app/admin/costs/period";

/**
 * /admin/costs (設計書 §9) の期間解決。UTC 基準の [from, to) 半開区間であること、
 * 月またぎ (1月→前年12月) を正しく処理することを検証する。
 */
describe("isPeriodKey", () => {
  it("既知のキーのみ true を返す", () => {
    expect(isPeriodKey("this_month")).toBe(true);
    expect(isPeriodKey("last_month")).toBe(true);
    expect(isPeriodKey("last_30d")).toBe(true);
    expect(isPeriodKey("bogus")).toBe(false);
    expect(isPeriodKey(undefined)).toBe(false);
  });
});

describe("resolvePeriodRange", () => {
  const now = new Date("2026-07-10T12:34:56.000Z");

  it("this_month は当月1日 〜 翌月1日", () => {
    expect(resolvePeriodRange("this_month", now)).toEqual({ from: "2026-07-01", to: "2026-08-01" });
  });

  it("last_month は前月1日 〜 当月1日", () => {
    expect(resolvePeriodRange("last_month", now)).toEqual({ from: "2026-06-01", to: "2026-07-01" });
  });

  it("last_month は年またぎ (1月 → 前年12月) を正しく処理する", () => {
    const jan = new Date("2026-01-15T00:00:00.000Z");
    expect(resolvePeriodRange("last_month", jan)).toEqual({ from: "2025-12-01", to: "2026-01-01" });
  });

  it("last_30d は当日を含む直近30日 (from は29日前、to は翌日=排他的)", () => {
    expect(resolvePeriodRange("last_30d", now)).toEqual({ from: "2026-06-11", to: "2026-07-11" });
  });
});

describe("last30DaysRange", () => {
  it("resolvePeriodRange('last_30d', now) と同じ結果を返す", () => {
    const now = new Date("2026-07-10T12:34:56.000Z");
    expect(last30DaysRange(now)).toEqual(resolvePeriodRange("last_30d", now));
  });

  it("年をまたぐ (1月上旬 → 前年12月) last_30d を正しく処理する", () => {
    const now = new Date("2026-01-05T00:00:00.000Z");
    // from = 2026-01-05 の29日前 = 2025-12-07、to = 2026-01-06 (排他的)
    expect(last30DaysRange(now)).toEqual({ from: "2025-12-07", to: "2026-01-06" });
  });

  it("うるう年 2月末をまたぐ last_30d を正しく処理する (2028年はうるう年)", () => {
    const now = new Date("2028-03-01T00:00:00.000Z");
    // from = 2028-03-01 の29日前。2028/2はうるう年で29日まであるため 2/1 になる。
    expect(last30DaysRange(now)).toEqual({ from: "2028-02-01", to: "2028-03-02" });
  });

  it("月初日 (00:00 ちょうど) の境界でも from/to がずれない", () => {
    const now = new Date("2026-07-01T00:00:00.000Z");
    expect(resolvePeriodRange("this_month", now)).toEqual({ from: "2026-07-01", to: "2026-08-01" });
  });
});

describe("resolvePeriodRange のタイムゾーン非依存性", () => {
  it("UTC 日付境界の直前・直後でも UTC 基準で計算する (ローカルTZに引きずられない)", () => {
    // 23:59:59.999 UTC の時点でもまだ 7/10 (UTC) 扱いになること
    const justBeforeMidnightUtc = new Date("2026-07-10T23:59:59.999Z");
    expect(resolvePeriodRange("this_month", justBeforeMidnightUtc)).toEqual({
      from: "2026-07-01",
      to: "2026-08-01",
    });
  });
});
