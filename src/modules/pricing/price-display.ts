import type { PriceTable } from "./contracts";

/**
 * SEC.01 グレードカードの価格表示 (「¥7,000〜」) を price_matrix から導出する。
 * canonical: docs/design/crm-suite/06-simulator.md §4.5 / §7.2 (裁定 J6-(b))。
 *
 * 規則: 対象グレード (is_active=true) の、quote_only=false な全サイズ帯に対応する
 * matrix セルの price_min の最小値を「¥{min}〜」形式で返す (税込 — 行列の値は税込)。
 * グレード不在/非アクティブ/有効セルなし/table null は null を返し、
 * 呼び出し側がテキストスロット (フォールバック文言) に委ねる。
 *
 * PriceTable の実装型 (src/modules/pricing/contracts.ts) のメンバ名は size_classes /
 * quantity_tiers であり (module-contracts.md §4.9 の sizes/tiers は旧記述の誤り — 07-contracts-delta
 * §D6-2)、本関数はそれに従う。副作用・IO なし。
 */
export function formatGradeCardPrice(table: PriceTable | null, gradeKey: string): string | null {
  if (!table) return null;
  const grade = table.grades.find((g) => g.key === gradeKey && g.is_active);
  if (!grade) return null;
  const sellableSizeKeys = new Set(
    table.size_classes.filter((s) => !s.quote_only).map((s) => s.key),
  );
  const mins = table.matrix
    .filter((c) => c.grade_key === gradeKey && sellableSizeKeys.has(c.size_key))
    .map((c) => c.price_min);
  if (mins.length === 0) return null;
  return `¥${Math.min(...mins).toLocaleString("ja-JP")}〜`;
}
