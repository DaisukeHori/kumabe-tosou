import type { TaxCategory } from "@/modules/platform/contracts";

import type { SimEstimateSnapshot } from "@/modules/crm/contracts"; // sales→crm は型 import のみ許可 (07§D8)

import type { DocType, DocumentLineInput } from "../contracts";

/**
 * canonical: docs/design/crm-suite/02-sales.md §4.4 (deriveDocument の複製規則) / §9.1・§9.2
 * (シミュレーター → 見積原案の変換規則)。06-simulator.md §5.4 (T1〜T7) は snapshot 入力意味論の
 * canonical (仮単価の解釈等) — 変換式・description/notes 文言は本節 (02-sales §9.1) が正。
 * 全て DB 非依存の純関数。単体テスト: tests/sales-derive-snapshot.test.ts。
 */

/**
 * deriveDocument (facade — #49) が派生元の明細として渡す形。DocumentDetail.lines /
 * repository.DocumentLineRow と構造的に同型だが、tax_category/source は契約側の狭い型で
 * 受ける (facade が DB 行を parse 済みの値として渡す想定 — repository の raw 行をそのまま
 * 渡さない)。id は複製に不要 (document_lines.id は DB 側 default gen_random_uuid() のため、
 * 新規 INSERT すれば自動的に新しい id が採番される — 「id 新規生成」は本関数が id フィールドを
 * 引き継がないことで自然に満たされる)。
 */
export type DerivableSourceLine = {
  position: number;
  description: string;
  quantity: number;
  unit: string;
  unit_price_jpy: number;
  amount_jpy: number;
  tax_category: TaxCategory;
  work_type_key: string | null;
  source: { grade_key: string; size_key: string; option_keys: string[] } | null;
};

/**
 * document_lines 全行複製 (§4.4): id 新規 (DB default 任せ・本関数は持ち回らない)・position 維持
 * (position 昇順に並べ替えてから配列順を出力する — repository.createDraftDocument は配列添字を
 * そのまま新しい position として INSERT するため、この並べ替えが「position 維持」を保証する)。
 * description/quantity/unit/unit_price_jpy/amount_jpy/tax_category/work_type_key/source を引継ぐ。
 */
export function buildDerivedDocumentLines(
  sourceLines: readonly DerivableSourceLine[],
): DocumentLineInput[] {
  return [...sourceLines]
    .sort((a, b) => a.position - b.position)
    .map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unit_price_jpy: line.unit_price_jpy,
      amount_jpy: line.amount_jpy,
      tax_category: line.tax_category,
      work_type_key: line.work_type_key,
      source: line.source,
    }));
}

/**
 * §4.4「transaction_date の引継ぎ (v1.1)」: delivery→invoice の派生のみ、派生元 delivery の
 * issue_date (= 納品日) を transaction_date の初期値に設定する。それ以外の派生は null
 * (draft で編集可。null のまま発行 = issue_date と同日扱い §10.3)。
 */
export function resolveDerivedTransactionDate(
  fromDocType: DocType,
  toDocType: DocType,
  sourceIssueDate: string | null,
): string | null {
  if (fromDocType === "delivery" && toDocType === "invoice") {
    return sourceIssueDate;
  }
  return null;
}

/** §9.1 共通 notes 文言 (quote_only=false のときのみ使用 — quote_only=true は total_min/max が
 *  意味を持たない (金額 0) ため、この文言は使わず個別見積もりメモのみを notes に入れる) */
function buildEstimateRangeNotes(estimate: SimEstimateSnapshot): string {
  const tierLabel = estimate.applied_tier ?? "数量スライドなし";
  const breakdownLabels = estimate.breakdown.map((entry) => entry.label).join("・");
  const totalMinLabel = estimate.total_min.toLocaleString("ja-JP");
  const totalMaxLabel = estimate.total_max.toLocaleString("ja-JP");
  return (
    `シミュレーター概算: 税込 ¥${totalMinLabel}〜¥${totalMaxLabel}` +
    `（${tierLabel}／${breakdownLabels}）。上記単価は概算上限からの税抜換算です。正式なお見積もりで確定します。`
  );
}

export type SimulatorQuoteDraft = { lines: DocumentLineInput[]; notes: string };

/**
 * createDraftQuoteFromEstimate (facade — #49) の純関数コア。§9.1 変換規則:
 * - quote_only=false: 明細 1 行。unit_price_jpy = round(total_max ÷ quantity ÷ 1.1)
 *   (税込上限 → 税抜換算。06-simulator §5.4 T1 が入力意味論の正)、
 *   amount_jpy = round(unit_price_jpy × quantity) (単価先行 — 06 §5.4 T1 v1.1)。
 * - quote_only=true (XL — 06-simulator §5.4 T5): 明細 0 行。notes は個別見積もりメモのみ
 *   (total_min/total_max は金額 0 で意味を持たないため、共通 notes 文言は使わない)。
 */
export function buildSimulatorQuoteDraft(estimate: SimEstimateSnapshot): SimulatorQuoteDraft {
  if (estimate.quote_only) {
    return {
      lines: [],
      notes: `個別見積もり（${estimate.size_label}・${estimate.quantity} 個）`,
    };
  }

  const unitPriceJpy = Math.round(estimate.total_max / estimate.quantity / 1.1);
  const amountJpy = Math.round(unitPriceJpy * estimate.quantity);

  const line: DocumentLineInput = {
    description: `3Dプリント表面処理・塗装（${estimate.grade_label}／${estimate.size_label}）`,
    quantity: estimate.quantity,
    unit: "個",
    unit_price_jpy: unitPriceJpy,
    amount_jpy: amountJpy,
    tax_category: "standard_10",
    work_type_key: null,
    source: {
      grade_key: estimate.grade_key,
      size_key: estimate.size_key,
      option_keys: estimate.option_keys,
    },
  };

  return { lines: [line], notes: buildEstimateRangeNotes(estimate) };
}
