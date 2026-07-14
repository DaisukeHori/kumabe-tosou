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

  // #51: sales 配線有効化に伴う後方互換 + sales 考慮ケース (地雷回避: crm タスクは 0 件だが
  // sales の未消込請求はある朝にダイジェストがスキップされる静かな機能不全を防ぐ)。
  it("sales: null (route が getSalesDigest 失敗時に graceful degrade で渡す形) は他が空なら true のまま", () => {
    expect(
      isDigestEmpty({ overdue_tasks: [], today_tasks: [], awaiting_leads: [], sales: null }),
    ).toBe(true);
  });

  it("sales: {expiring_quotes:[], unpaid_invoices:[]} (sales 側も 0 件) は他が空なら true のまま", () => {
    expect(
      isDigestEmpty({
        overdue_tasks: [],
        today_tasks: [],
        awaiting_leads: [],
        sales: { expiring_quotes: [], unpaid_invoices: [] },
      }),
    ).toBe(true);
  });

  it("crm 側 3 リストが全て空でも sales.expiring_quotes に 1 件あれば false (地雷: 未回収見落とし防止)", () => {
    expect(
      isDigestEmpty({
        overdue_tasks: [],
        today_tasks: [],
        awaiting_leads: [],
        sales: {
          expiring_quotes: [
            { document_id: "d-1", doc_no: "Q-1", billing_name: "顧客A", valid_until: "2026-07-20", total_jpy: 1000 },
          ],
          unpaid_invoices: [],
        },
      }),
    ).toBe(false);
  });

  it("crm 側 3 リストが全て空でも sales.unpaid_invoices に 1 件あれば false (地雷: 未回収見落とし防止)", () => {
    expect(
      isDigestEmpty({
        overdue_tasks: [],
        today_tasks: [],
        awaiting_leads: [],
        sales: {
          expiring_quotes: [],
          unpaid_invoices: [
            {
              document_id: "d-2",
              doc_no: "I-1",
              billing_name: "顧客B",
              issue_date: "2026-07-01",
              total_jpy: 11000,
              paid_jpy: 0,
              balance_jpy: 11000,
            },
          ],
        },
      }),
    ).toBe(false);
  });

  it("sales 引数を渡さない旧来の呼び出し (tests/crm-kpi.test.ts の既存呼び出し形) は sales 未指定=空扱いのまま後方互換を保つ", () => {
    // 上記「3 リストすべて空なら true」テストと同一の呼び出し形が型エラーにならず、
    // 結果も変わらないことの明示的な再確認 (isDigestEmpty のシグネチャ拡張の後方互換保証)。
    expect(isDigestEmpty({ overdue_tasks: [], today_tasks: [], awaiting_leads: [] })).toBe(true);
  });
});
