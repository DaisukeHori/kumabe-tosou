import { describe, expect, it } from "vitest";

import { isDigestEmpty, weightedPipelineJpy } from "@/modules/crm/internal/digest";

/**
 * canonical: docs/design/crm-suite/01-crm.md §7.2 (digest 空判定) / §8.6 (weighted_pipeline_jpy)。
 */

describe("weightedPipelineJpy (Σ floor(amount_jpy × probability / 100)、stage ∉ {paid, lost})", () => {
  it("amount_jpy が NULL の行は 0 円扱いで計算する", () => {
    expect(weightedPipelineJpy([{ amount_jpy: null, stage: "estimating" }])).toBe(0);
  });

  it("lost / paid ステージの行は除外する (isWon=true の paid も除外対象)", () => {
    const total = weightedPipelineJpy([
      { amount_jpy: 1_000_000, stage: "lost" },
      { amount_jpy: 1_000_000, stage: "paid" },
    ]);
    expect(total).toBe(0);
  });

  it("floor 丸め (端数切り捨て) を行う", () => {
    // estimating の probability=30 → 101 * 30 / 100 = 30.3 → floor = 30
    expect(weightedPipelineJpy([{ amount_jpy: 101, stage: "estimating" }])).toBe(30);
  });

  it("floor 丸め: quote_sent (probability=60) で端数切り捨て", () => {
    // 333 * 60 / 100 = 199.8 → floor = 199
    expect(weightedPipelineJpy([{ amount_jpy: 333, stage: "quote_sent" }])).toBe(199);
  });

  it("複数行を合算する (非終端ステージのみ)", () => {
    const total = weightedPipelineJpy([
      { amount_jpy: 100_000, stage: "inquiry" }, // probability=10 → 10,000
      { amount_jpy: 200_000, stage: "estimating" }, // probability=30 → 60,000
      { amount_jpy: 300_000, stage: "quote_sent" }, // probability=60 → 180,000
      { amount_jpy: 1_000_000, stage: "lost" }, // 除外
      { amount_jpy: null, stage: "ordered" }, // NULL → 0
    ]);
    expect(total).toBe(10_000 + 60_000 + 180_000);
  });

  it("isWon 系 (ordered 等) は probability=100 なので満額計上される", () => {
    expect(weightedPipelineJpy([{ amount_jpy: 500_000, stage: "ordered" }])).toBe(500_000);
  });

  it("空配列は 0 を返す", () => {
    expect(weightedPipelineJpy([])).toBe(0);
  });
});

describe("isDigestEmpty (§7.2 手順b: 全リスト空なら送信スキップ)", () => {
  it("3 リストすべて空なら true", () => {
    expect(isDigestEmpty({ overdue_tasks: [], today_tasks: [], awaiting_leads: [] })).toBe(true);
  });

  it("overdue_tasks に 1 件でもあれば false", () => {
    expect(
      isDigestEmpty({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        overdue_tasks: [{} as any],
        today_tasks: [],
        awaiting_leads: [],
      }),
    ).toBe(false);
  });

  it("today_tasks に 1 件でもあれば false", () => {
    expect(
      isDigestEmpty({
        overdue_tasks: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        today_tasks: [{} as any],
        awaiting_leads: [],
      }),
    ).toBe(false);
  });

  it("awaiting_leads に 1 件でもあれば false", () => {
    expect(
      isDigestEmpty({
        overdue_tasks: [],
        today_tasks: [],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        awaiting_leads: [{} as any],
      }),
    ).toBe(false);
  });
});
