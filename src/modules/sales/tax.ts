import type { z } from "zod";

import { TAX_RATE_BY_CATEGORY, type TaxCategory, type zTaxRounding } from "@/modules/platform/contracts";

import type { DocumentTotals, TaxSummary } from "./contracts";

/**
 * canonical: docs/design/crm-suite/02-sales.md §5.3 (税計算仕様。裁定 J5 / ブリーフ D4)。
 * 純関数のみ (外部依存なし)。admin UI のリアルタイム税プレビューがクライアント import するため
 * internal/ 配下には置かない (ESLint MODULES 境界 — 02-sales §1.3)。単体テスト: tests/sales-tax.test.ts。
 */

type TaxRounding = z.infer<typeof zTaxRounding>;
type LineForTax = { amount_jpy: number; tax_category: TaxCategory };

/** 税率区分の走査順 (固定)。出現しない区分は集計行を作らない (§5.3 アルゴリズム 2)。
 *  export: 紙面 (DocumentSheet — 02-sales §10.4「tax_summary を standard_10→reduced_8→
 *  zero→exempt の固定順」) が同じ定数を参照するため (Issue #50 — 走査順の二重定義を避ける)。 */
export const TAX_CATEGORY_ORDER: readonly TaxCategory[] = ["standard_10", "reduced_8", "zero", "exempt"];

/**
 * 丸め (数学的定義。floor = 負方向、ceil = 正方向、round = Math.round に一致)。
 * 注意 (v1.1): Math.round は負値で正方向に丸める (Math.round(-1.5) = -1) — 日本語の
 * 「四捨五入」(絶対値 0.5 切上げ → -2) とは負値で結果が割れるが、本関数は Math.round を
 * 正とする。発行時ガードで課税対象額は非負に強制されるため、負値丸めは draft プレビューで
 * のみ発生し法的意味を持たない (単体テストは負値ケースの期待値を Math.round 準拠で fixture 固定 — §13.1)。
 */
export function roundByMode(value: number, mode: TaxRounding): number {
  switch (mode) {
    case "floor":
      return Math.floor(value);
    case "ceil":
      return Math.ceil(value);
    case "round":
      return Math.round(value);
  }
}

/**
 * 書類合計の計算 (canonical アルゴリズム):
 * 1. subtotal_jpy = Σ lines.amount_jpy                       … 税抜。値引き行 (負値) 込み
 * 2. 税率区分 c ごと (standard_10 → reduced_8 → zero → exempt の固定順):
 *      taxable_c = Σ amount_jpy (tax_category = c)            … 値引き反映後の課税標準
 *      tax_c     = roundByMode(taxable_c × rate_c / 100, rounding) … ★丸めはここで 1 回だけ
 *    - 明細行に税額は存在しないため、行ごとの丸め合算は構造的に不可能 (J5 / 国税庁 Q&A: 行別
 *      端数処理の合算は不可 — ext-hubspot B-3)
 *    - 出現しない区分は集計行を出さない。zero/exempt は出現すれば tax_jpy=0 で集計行を残す
 * 3. total_jpy = subtotal_jpy + Σ tax_c                       … 税込合計
 *
 * 免税/適格 (issuer.registration_number の有無) で計算結果は完全に同一 — 分岐は印字表記のみ (§10.5)。
 */
export function computeDocumentTotals(
  lines: ReadonlyArray<LineForTax>,
  rounding: TaxRounding,
): DocumentTotals {
  let subtotal_jpy = 0;
  const taxableByCategory = new Map<TaxCategory, number>();

  for (const line of lines) {
    subtotal_jpy += line.amount_jpy;
    taxableByCategory.set(
      line.tax_category,
      (taxableByCategory.get(line.tax_category) ?? 0) + line.amount_jpy,
    );
  }

  const tax_summary: TaxSummary = [];
  let taxTotal = 0;

  for (const category of TAX_CATEGORY_ORDER) {
    const taxable_jpy = taxableByCategory.get(category);
    if (taxable_jpy === undefined) continue; // 出現しない区分は集計行を出さない

    const rate = TAX_RATE_BY_CATEGORY[category];
    const tax_jpy = roundByMode((taxable_jpy * rate) / 100, rounding); // ★書類×税率で 1 回だけ丸め
    tax_summary.push({ tax_category: category, taxable_jpy, tax_jpy });
    taxTotal += tax_jpy;
  }

  return {
    subtotal_jpy,
    tax_summary,
    total_jpy: subtotal_jpy + taxTotal,
  };
}
