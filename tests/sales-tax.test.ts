import { describe, expect, it } from "vitest";

import { computeDocumentTotals, roundByMode } from "@/modules/sales/tax";

/**
 * canonical: docs/design/crm-suite/02-sales.md §5.3 (税計算仕様。裁定 J5 / ブリーフ D4)。
 * DB 接続不要の純関数テスト (§13.1 sales-tax.test.ts)。
 */

type TaxCategory = "standard_10" | "reduced_8" | "zero" | "exempt";
type Line = { amount_jpy: number; tax_category: TaxCategory };

function line(amount_jpy: number, tax_category: TaxCategory): Line {
  return { amount_jpy, tax_category };
}

describe("roundByMode (端数処理 3 方式)", () => {
  it("floor は負方向に切り捨てる", () => {
    expect(roundByMode(2.5, "floor")).toBe(2);
    expect(roundByMode(2.999, "floor")).toBe(2);
    expect(roundByMode(-2.1, "floor")).toBe(-3);
  });

  it("ceil は正方向に切り上げる", () => {
    expect(roundByMode(2.001, "ceil")).toBe(3);
    expect(roundByMode(2.5, "ceil")).toBe(3);
    expect(roundByMode(-2.9, "ceil")).toBe(-2);
  });

  it("round は Math.round に一致する (端数 .5 円は正方向優先)", () => {
    expect(roundByMode(2.5, "round")).toBe(3);
    expect(roundByMode(0.5, "round")).toBe(1);
    expect(roundByMode(2.4, "round")).toBe(2);
  });

  it("round の負値は Math.round 準拠 (JS 仕様: -2.5 → -2。日本語の四捨五入 (絶対値切上げ → -3) とは負値で不一致だが、これを正とする — §5.3 v1.1 注記)", () => {
    expect(roundByMode(-2.5, "round")).toBe(Math.round(-2.5));
    expect(roundByMode(-2.5, "round")).toBe(-2);
    expect(roundByMode(-3.5, "round")).toBe(-3);
  });
});

describe("computeDocumentTotals (書類×税率ごと 1 回丸め)", () => {
  it("standard_10 単独 (floor)", () => {
    const result = computeDocumentTotals([line(1000, "standard_10")], "floor");
    expect(result).toEqual({
      subtotal_jpy: 1000,
      tax_summary: [{ tax_category: "standard_10", taxable_jpy: 1000, tax_jpy: 100 }],
      total_jpy: 1100,
    });
  });

  it("reduced_8 混在 (standard_10 + reduced_8, round)", () => {
    const result = computeDocumentTotals(
      [line(1000, "standard_10"), line(500, "reduced_8")],
      "round",
    );
    expect(result).toEqual({
      subtotal_jpy: 1500,
      tax_summary: [
        { tax_category: "standard_10", taxable_jpy: 1000, tax_jpy: 100 },
        { tax_category: "reduced_8", taxable_jpy: 500, tax_jpy: 40 },
      ],
      total_jpy: 1640,
    });
  });

  it("zero・exempt 混在 (税額 0 だが集計行は残る — パターン 19)", () => {
    const result = computeDocumentTotals(
      [line(1000, "standard_10"), line(300, "zero"), line(200, "exempt")],
      "ceil",
    );
    expect(result).toEqual({
      subtotal_jpy: 1500,
      tax_summary: [
        { tax_category: "standard_10", taxable_jpy: 1000, tax_jpy: 100 },
        { tax_category: "zero", taxable_jpy: 300, tax_jpy: 0 },
        { tax_category: "exempt", taxable_jpy: 200, tax_jpy: 0 },
      ],
      total_jpy: 1600, // subtotal 1500 + standard_10 の税 100 (zero/exempt は税額 0)
    });
  });

  it("4 区分同時出現 (走査順は standard_10 → reduced_8 → zero → exempt の固定順に並ぶ)", () => {
    const result = computeDocumentTotals(
      [line(100, "exempt"), line(100, "zero"), line(100, "reduced_8"), line(100, "standard_10")],
      "floor",
    );
    expect(result.tax_summary.map((t) => t.tax_category)).toEqual([
      "standard_10",
      "reduced_8",
      "zero",
      "exempt",
    ]);
  });

  it("端数境界: taxable=25円・rate10% → 税額 2.5円 で floor/round/ceil が分岐する", () => {
    const lines = [line(25, "standard_10")];
    expect(computeDocumentTotals(lines, "floor").tax_summary[0]?.tax_jpy).toBe(2);
    expect(computeDocumentTotals(lines, "round").tax_summary[0]?.tax_jpy).toBe(3);
    expect(computeDocumentTotals(lines, "ceil").tax_summary[0]?.tax_jpy).toBe(3);
  });

  it("出現しない区分は集計行を作らない", () => {
    const result = computeDocumentTotals([line(1000, "reduced_8")], "floor");
    expect(result.tax_summary).toEqual([{ tax_category: "reduced_8", taxable_jpy: 1000, tax_jpy: 80 }]);
  });

  it("値引き行 (負 amount) が同一区分の課税標準に反映される (通常行 + 値引き行の合算後に 1 回だけ課税)", () => {
    const result = computeDocumentTotals(
      [line(10_000, "standard_10"), line(-3_000, "standard_10")],
      "floor",
    );
    expect(result.tax_summary).toEqual([
      { tax_category: "standard_10", taxable_jpy: 7000, tax_jpy: 700 },
    ]);
    expect(result.subtotal_jpy).toBe(7000);
    expect(result.total_jpy).toBe(7700);
  });

  it("値引きが上回り課税標準が負になっても計算は続行する (発行ガード E101 判定の入力になる値をそのまま返す)", () => {
    const result = computeDocumentTotals(
      [line(1_000, "standard_10"), line(-5_000, "standard_10")],
      "round",
    );
    expect(result.tax_summary).toEqual([
      { tax_category: "standard_10", taxable_jpy: -4000, tax_jpy: -400 },
    ]);
    expect(result.subtotal_jpy).toBe(-4000);
    expect(result.total_jpy).toBe(-4400);
  });

  it("負の課税標準の端数丸めも Math.round 準拠になる (taxable=-25円・rate10% → -2.5 → -2。draft プレビューでのみ発生しうる — §5.3 v1.1)", () => {
    const result = computeDocumentTotals([line(-25, "standard_10")], "round");
    expect(result.tax_summary[0]?.tax_jpy).toBe(Math.round(-2.5));
    expect(result.tax_summary[0]?.tax_jpy).toBe(-2);
  });

  it("回帰 fixture (¥333 × 3 行 × 10%, round): 書類レベルで 1 回丸めた 100 円になる。行ごとに丸めて合算する誤実装なら 99 円になってしまう (J5 / 国税庁 Q&A: 行別端数処理の合算は不可 — ext-hubspot B-3)", () => {
    const result = computeDocumentTotals(
      [line(333, "standard_10"), line(333, "standard_10"), line(333, "standard_10")],
      "round",
    );
    expect(result.subtotal_jpy).toBe(999);
    const wrongPerLineSum = 3 * Math.round(333 * 0.1); // 誤実装 (行ごと丸め合算): 33×3=99 → 仕様違反
    expect(wrongPerLineSum).toBe(99);
    expect(result.tax_summary[0]?.tax_jpy).toBe(100); // Math.round(99.9) = 100 (書類 1 回丸め)
    expect(result.tax_summary[0]?.tax_jpy).not.toBe(wrongPerLineSum);
  });

  it("既定の floor でも同種の回帰 fixture (¥335 × 3 行 × 10%): 書類レベル floor(100.5)=100 (行ごと floor(33.5)=33×3=99 とは異なる)", () => {
    const result = computeDocumentTotals(
      [line(335, "standard_10"), line(335, "standard_10"), line(335, "standard_10")],
      "floor",
    );
    expect(result.subtotal_jpy).toBe(1005);
    const wrongPerLineSum = 3 * Math.floor(335 * 0.1);
    expect(wrongPerLineSum).toBe(99);
    expect(result.tax_summary[0]?.tax_jpy).toBe(100);
    expect(result.tax_summary[0]?.tax_jpy).not.toBe(wrongPerLineSum);
  });

  it("上限値 9,999,999,999 (zJpySignedAmount の max) でも桁あふれせず正しく計算する", () => {
    const result = computeDocumentTotals([line(9_999_999_999, "zero")], "floor");
    expect(result).toEqual({
      subtotal_jpy: 9_999_999_999,
      tax_summary: [{ tax_category: "zero", taxable_jpy: 9_999_999_999, tax_jpy: 0 }],
      total_jpy: 9_999_999_999,
    });
  });

  it("上限に近い金額での標準税率計算 (課税対象額が大きくても丸めは書類で 1 回だけ行われる)", () => {
    const result = computeDocumentTotals([line(1_000_000_000, "standard_10")], "floor");
    expect(result).toEqual({
      subtotal_jpy: 1_000_000_000,
      tax_summary: [{ tax_category: "standard_10", taxable_jpy: 1_000_000_000, tax_jpy: 100_000_000 }],
      total_jpy: 1_100_000_000,
    });
  });

  it("空 lines → { subtotal_jpy: 0, tax_summary: [], total_jpy: 0 }", () => {
    expect(computeDocumentTotals([], "floor")).toEqual({ subtotal_jpy: 0, tax_summary: [], total_jpy: 0 });
  });

  it("様式非依存の確認: computeDocumentTotals は issuer (免税/適格) 情報を一切受け取らない構造のため、同一入力なら常に同一結果になる (§5.3: 免税/適格の分岐は印字表記のみで計算結果は完全に同一)", () => {
    const lines = [line(1000, "standard_10"), line(500, "reduced_8"), line(300, "zero")];
    const a = computeDocumentTotals(lines, "floor");
    const b = computeDocumentTotals(lines, "floor");
    expect(a).toEqual(b);
  });
});
