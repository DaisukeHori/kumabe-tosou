import { describe, expect, it } from "vitest";

import {
  budgetProgressRatio,
  enumerateDatesUtc,
  formatUsd,
  microUsdToUsd,
  PROVIDERS,
  toByFeature,
  toByKey,
  toByModel,
  toDailyByProvider,
  toStackedBarInputs,
} from "@/app/admin/costs/aggregate";
import type { UsageSummaryRow } from "@/modules/ai-providers/contracts";

/**
 * /admin/costs (設計書 §9) の集計結果整形 (純関数)。
 * getUsageSummaryRows が返す cube (UsageSummaryRow[]) を
 * 日別×プロバイダ / モデル別 / キー別 / feature別 の 4 表示軸へ整形する層のテスト。
 */

function row(overrides: Partial<UsageSummaryRow> = {}): UsageSummaryRow {
  return {
    provider: "openai",
    model: "gpt-image-2",
    feature: "image-gen",
    keyId: "key-1",
    date: "2026-07-10",
    costMicroUsd: 1_000_000,
    callCount: 1,
    imageCount: 0,
    ...overrides,
  };
}

describe("microUsdToUsd / formatUsd", () => {
  it("µUSD を USD (1/1_000_000) へ変換する", () => {
    expect(microUsdToUsd(1_000_000)).toBe(1);
    expect(microUsdToUsd(2_500_000)).toBe(2.5);
    expect(microUsdToUsd(0)).toBe(0);
  });

  it("USD 表示は $ プレフィックス + 既定 2 桁", () => {
    expect(formatUsd(1_000_000)).toBe("$1.00");
    expect(formatUsd(1_234_000)).toBe("$1.23");
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("fractionDigits を指定できる", () => {
    expect(formatUsd(1_234_567, 4)).toBe("$1.2346");
  });
});

describe("budgetProgressRatio", () => {
  it("0〜1 の範囲にクランプする", () => {
    expect(budgetProgressRatio(25_000_000, 50_000_000)).toBe(0.5);
    expect(budgetProgressRatio(60_000_000, 50_000_000)).toBe(1);
    expect(budgetProgressRatio(-1, 50_000_000)).toBe(0);
  });

  it("limit が 0 以下なら 0 を返す (ゼロ除算回避)", () => {
    expect(budgetProgressRatio(100, 0)).toBe(0);
    expect(budgetProgressRatio(100, -10)).toBe(0);
  });
});

describe("enumerateDatesUtc", () => {
  it("[from, to) の日付を列挙する (to は排他的)", () => {
    expect(enumerateDatesUtc("2026-07-08", "2026-07-11")).toEqual(["2026-07-08", "2026-07-09", "2026-07-10"]);
  });

  it("from === to なら空配列", () => {
    expect(enumerateDatesUtc("2026-07-08", "2026-07-08")).toEqual([]);
  });

  it("月をまたぐ範囲も正しく列挙する", () => {
    expect(enumerateDatesUtc("2026-06-29", "2026-07-02")).toEqual(["2026-06-29", "2026-06-30", "2026-07-01"]);
  });
});

describe("toDailyByProvider (日別ゼロ埋め)", () => {
  it("データが無い日/プロバイダも 0 でゼロ埋めする", () => {
    const rows = [row({ provider: "openai", date: "2026-07-09", costMicroUsd: 500_000 })];
    const result = toDailyByProvider(rows, "2026-07-08", "2026-07-10");

    // 2 日 × 3 プロバイダ = 6 件
    expect(result).toHaveLength(2 * PROVIDERS.length);
    expect(result).toContainEqual({ date: "2026-07-08", provider: "openai", costMicroUsd: 0 });
    expect(result).toContainEqual({ date: "2026-07-08", provider: "anthropic", costMicroUsd: 0 });
    expect(result).toContainEqual({ date: "2026-07-08", provider: "gemini", costMicroUsd: 0 });
    expect(result).toContainEqual({ date: "2026-07-09", provider: "openai", costMicroUsd: 500_000 });
    expect(result).toContainEqual({ date: "2026-07-09", provider: "anthropic", costMicroUsd: 0 });
  });

  it("同一 (date, provider) の複数行を合算する", () => {
    const rows = [
      row({ provider: "openai", date: "2026-07-09", costMicroUsd: 300_000 }),
      row({ provider: "openai", date: "2026-07-09", costMicroUsd: 200_000, model: "gpt-image-2-mini" }),
    ];
    const result = toDailyByProvider(rows, "2026-07-09", "2026-07-10");
    expect(result).toContainEqual({ date: "2026-07-09", provider: "openai", costMicroUsd: 500_000 });
  });

  it("空データは全日 0 埋めの配列を返す", () => {
    const result = toDailyByProvider([], "2026-07-09", "2026-07-10");
    expect(result).toHaveLength(PROVIDERS.length);
    expect(result.every((r) => r.costMicroUsd === 0)).toBe(true);
  });
});

describe("toStackedBarInputs", () => {
  it("日付ごとにセグメント配列へ束ねる (日付順を保持する)", () => {
    const points = toDailyByProvider(
      [row({ provider: "openai", date: "2026-07-09", costMicroUsd: 500_000 })],
      "2026-07-08",
      "2026-07-10",
    );
    const bars = toStackedBarInputs(points);
    expect(bars.map((b) => b.date)).toEqual(["2026-07-08", "2026-07-09"]);
    expect(bars[1].segments).toEqual(
      expect.arrayContaining([{ provider: "openai", value: 500_000 }]),
    );
    expect(bars[0].segments).toHaveLength(PROVIDERS.length);
  });
});

describe("toByModel (モデル別)", () => {
  it("provider+model で合算し、コスト降順に並べる", () => {
    const rows = [
      row({ provider: "openai", model: "gpt-image-2", costMicroUsd: 1_000_000, callCount: 2, imageCount: 4 }),
      row({ provider: "openai", model: "gpt-image-2", costMicroUsd: 500_000, callCount: 1, imageCount: 2 }),
      row({ provider: "anthropic", model: "claude-opus-4-8", costMicroUsd: 2_000_000, callCount: 3, imageCount: 0 }),
    ];
    const result = toByModel(rows);
    expect(result).toEqual([
      { provider: "anthropic", model: "claude-opus-4-8", costMicroUsd: 2_000_000, callCount: 3, imageCount: 0 },
      { provider: "openai", model: "gpt-image-2", costMicroUsd: 1_500_000, callCount: 3, imageCount: 6 },
    ]);
  });

  it("空データは空配列", () => {
    expect(toByModel([])).toEqual([]);
  });
});

describe("toByKey (キー別)", () => {
  it("label マップを引いて表示名を解決する", () => {
    const rows = [
      row({ keyId: "key-1", costMicroUsd: 1_000_000 }),
      row({ keyId: "key-2", costMicroUsd: 3_000_000 }),
      row({ keyId: null, costMicroUsd: 200_000 }),
    ];
    const labelByKeyId = new Map([["key-1", "OpenAI · 本番キー"]]);
    const result = toByKey(rows, labelByKeyId);
    expect(result).toEqual([
      { keyId: "key-2", label: "不明なキー (key-2)", costMicroUsd: 3_000_000, callCount: 1, imageCount: 0 },
      { keyId: "key-1", label: "OpenAI · 本番キー", costMicroUsd: 1_000_000, callCount: 1, imageCount: 0 },
      { keyId: null, label: "キー未指定", costMicroUsd: 200_000, callCount: 1, imageCount: 0 },
    ]);
  });
});

describe("toByFeature (feature別)", () => {
  it("feature ごとに合算し、コスト降順に並べる", () => {
    const rows = [
      row({ feature: "studio", costMicroUsd: 100_000 }),
      row({ feature: "image-gen", costMicroUsd: 900_000 }),
      row({ feature: "studio", costMicroUsd: 400_000 }),
    ];
    const result = toByFeature(rows);
    expect(result).toEqual([
      { feature: "image-gen", costMicroUsd: 900_000, callCount: 1, imageCount: 0 },
      { feature: "studio", costMicroUsd: 500_000, callCount: 2, imageCount: 0 },
    ]);
  });

  it("空データは空配列", () => {
    expect(toByFeature([])).toEqual([]);
  });
});

describe("不変条件: 軸別合計 = 全体合計", () => {
  // toByModel/toByKey/toByFeature はいずれも同じ periodRows 集合を異なる軸で
  // 分割 (パーティション) しているだけであり、どの行も必ずちょうど1グループに
  // 属する。したがって、どの軸で合算しても各軸の合計値の総和は
  // 元の rows 全体の costMicroUsd/callCount/imageCount の総和に一致するはず
  // (facade.getUsageSummary の totalCostMicroUsd もこの総和で計算している —
  // src/modules/ai-providers/facade.ts:304-305)。
  const rows: UsageSummaryRow[] = [
    row({ provider: "openai", model: "gpt-image-2", feature: "image-gen", keyId: "key-1", date: "2026-07-01", costMicroUsd: 1_234_567, callCount: 3, imageCount: 2 }),
    row({ provider: "openai", model: "gpt-5", feature: "studio", keyId: "key-2", date: "2026-07-02", costMicroUsd: 987_654, callCount: 5, imageCount: 0 }),
    row({ provider: "anthropic", model: "claude-opus-4-8", feature: "studio", keyId: null, date: "2026-07-03", costMicroUsd: 2_000_001, callCount: 1, imageCount: 0 }),
    row({ provider: "gemini", model: "gemini-3-flash", feature: "sns-text", keyId: "key-1", date: "2026-07-04", costMicroUsd: 111_111, callCount: 2, imageCount: 0 }),
    row({ provider: "gemini", model: "gemini-3-flash", feature: "sns-text", keyId: "key-3", date: "2026-07-04", costMicroUsd: 0, callCount: 1, imageCount: 0 }),
  ];
  const totalCost = rows.reduce((sum, r) => sum + r.costMicroUsd, 0);
  const totalCalls = rows.reduce((sum, r) => sum + r.callCount, 0);
  const totalImages = rows.reduce((sum, r) => sum + r.imageCount, 0);

  it("toByModel の合計 = 全体合計 (cost/call/image いずれも)", () => {
    const result = toByModel(rows);
    expect(result.reduce((sum, r) => sum + r.costMicroUsd, 0)).toBe(totalCost);
    expect(result.reduce((sum, r) => sum + r.callCount, 0)).toBe(totalCalls);
    expect(result.reduce((sum, r) => sum + r.imageCount, 0)).toBe(totalImages);
  });

  it("toByKey の合計 = 全体合計 (keyId=null の行も欠落なく含む)", () => {
    const result = toByKey(rows, new Map());
    expect(result.reduce((sum, r) => sum + r.costMicroUsd, 0)).toBe(totalCost);
    expect(result.reduce((sum, r) => sum + r.callCount, 0)).toBe(totalCalls);
    expect(result.reduce((sum, r) => sum + r.imageCount, 0)).toBe(totalImages);
    // null keyId の行が消えていないことを明示的に確認
    expect(result.some((r) => r.keyId === null)).toBe(true);
  });

  it("toByFeature の合計 = 全体合計", () => {
    const result = toByFeature(rows);
    expect(result.reduce((sum, r) => sum + r.costMicroUsd, 0)).toBe(totalCost);
    expect(result.reduce((sum, r) => sum + r.callCount, 0)).toBe(totalCalls);
    expect(result.reduce((sum, r) => sum + r.imageCount, 0)).toBe(totalImages);
  });

  it("toDailyByProvider (ゼロ埋め後) の合計 = 全体合計 (ゼロ埋めは合計に影響しない)", () => {
    const result = toDailyByProvider(rows, "2026-07-01", "2026-07-06");
    expect(result.reduce((sum, r) => sum + r.costMicroUsd, 0)).toBe(totalCost);
  });
});
