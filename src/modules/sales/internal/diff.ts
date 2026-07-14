import { diffArrays } from "diff";

import type { IssuedContentSnapshot } from "../contracts";

/**
 * canonical: docs/design/crm-suite/02-sales.md §11.1 (版間差分)。純関数 (DB 非依存・"server-only"
 * 依存なし)。app 層からは facade の薄いブリッジ (`computeVersionDiff` — facade.ts) 経由でのみ呼ぶ
 * (ESLint モジュール境界 — internal/** は他モジュール/app 層から直 import 禁止。
 * 実装計画書「成果物5」注記: resolvePrintView と同型のブリッジパターン)。
 *
 * 単体テスト: tests/sales-diff.test.ts (§13.1)。
 */

/** ヘッダ差分 1 項目 (§11.1: 「変更ヘッダ項目 = 両側に黄帯 + 『旧 → 新』注記」の入力)。
 *  同値の項目は配列に含めない (差分のみを返す設計 — 呼び出し側が「差分なし」を空配列で判定できる)。 */
export type SnapshotFieldDiff = { field: string; old: string; new: string };

/** 明細差分 1 行 (§11.1: diffArrays の added/removed/unchanged 分類をそのまま公開する)。 */
export type SnapshotLineDiffEntry = { status: "added" | "removed" | "unchanged"; text: string };

/** 税率区分ごとの金額差分 (§11.1「tax_summary (区分ごと)」)。旧版・新版のいずれかにのみ
 *  出現する区分 (税区分の追加/消滅) は該当しない側を null で表す。 */
export type SnapshotTaxDiffEntry = {
  tax_category: string;
  old_taxable_jpy: number | null;
  old_tax_jpy: number | null;
  new_taxable_jpy: number | null;
  new_tax_jpy: number | null;
  changed: boolean;
};

export type IssuedSnapshotDiff = {
  headerDiffs: SnapshotFieldDiff[];
  lineDiffs: SnapshotLineDiffEntry[];
  subtotalDiff: { old: number; new: number; changed: boolean };
  taxSummaryDiffs: SnapshotTaxDiffEntry[];
  totalDiff: { old: number; new: number; changed: boolean };
  /** true = ヘッダ・明細・金額のいずれにも差分なし (§11.1「内容同一の隣接版 (再出力) は
   *  『変更はありません (再出力による版追加)』の 1 行表示」の判定に使う)。 */
  identical: boolean;
};

/** 明細行の表示文字列化 (§11.1 canonical の書式そのまま:
 *  `{description}｜{quantity}{unit}｜@{unit_price_jpy}｜{amount_jpy}｜{tax_category}`)。 */
function normalizeLine(line: IssuedContentSnapshot["lines"][number]): string {
  return `${line.description}｜${line.quantity}${line.unit}｜@${line.unit_price_jpy}｜${line.amount_jpy}｜${line.tax_category}`;
}

/** ヘッダ比較対象フィールド (§11.1: issuer は issuer_name・registration_number のみ)。
 *  null は空文字に正規化して比較する (「未設定→値あり」も文字列比較の差分として自然に検出させるため)。 */
const HEADER_FIELDS: ReadonlyArray<{ field: string; pick: (s: IssuedContentSnapshot) => string }> = [
  { field: "issue_date", pick: (s) => s.issue_date },
  { field: "transaction_date", pick: (s) => s.transaction_date },
  { field: "valid_until", pick: (s) => s.valid_until ?? "" },
  { field: "billing_name", pick: (s) => s.billing_name },
  { field: "billing_suffix", pick: (s) => s.billing_suffix },
  { field: "billing_address", pick: (s) => s.billing_address ?? "" },
  { field: "site_name", pick: (s) => s.site_name ?? "" },
  { field: "site_address", pick: (s) => s.site_address ?? "" },
  { field: "notes", pick: (s) => s.notes ?? "" },
  { field: "issuer_name", pick: (s) => s.issuer.issuer_name },
  { field: "issuer_registration_number", pick: (s) => s.issuer.registration_number ?? "" },
];

/**
 * 版間差分の算出 (§11.1)。older/newer の引数順は呼び出し側の責務 (本関数は対称に動作する —
 * 入れ替えて渡せば old/new が入れ替わった結果を返すだけで、算出ロジック自体は入力順に依存しない
 * 「older・newer入力順防御」— 実装計画書 §13.1)。
 */
export function diffIssuedSnapshots(
  older: IssuedContentSnapshot,
  newer: IssuedContentSnapshot,
): IssuedSnapshotDiff {
  const headerDiffs: SnapshotFieldDiff[] = [];
  for (const { field, pick } of HEADER_FIELDS) {
    const oldValue = pick(older);
    const newValue = pick(newer);
    if (oldValue !== newValue) headerDiffs.push({ field, old: oldValue, new: newValue });
  }

  const oldLineTexts = older.lines.map(normalizeLine);
  const newLineTexts = newer.lines.map(normalizeLine);
  const lineDiffs: SnapshotLineDiffEntry[] = [];
  for (const part of diffArrays(oldLineTexts, newLineTexts)) {
    const status: SnapshotLineDiffEntry["status"] = part.added ? "added" : part.removed ? "removed" : "unchanged";
    for (const text of part.value) {
      lineDiffs.push({ status, text });
    }
  }

  const subtotalDiff = {
    old: older.subtotal_jpy,
    new: newer.subtotal_jpy,
    changed: older.subtotal_jpy !== newer.subtotal_jpy,
  };
  const totalDiff = {
    old: older.total_jpy,
    new: newer.total_jpy,
    changed: older.total_jpy !== newer.total_jpy,
  };

  const categories = new Set<string>([
    ...older.tax_summary.map((t) => t.tax_category),
    ...newer.tax_summary.map((t) => t.tax_category),
  ]);
  const taxSummaryDiffs: SnapshotTaxDiffEntry[] = [];
  for (const category of categories) {
    const o = older.tax_summary.find((t) => t.tax_category === category) ?? null;
    const n = newer.tax_summary.find((t) => t.tax_category === category) ?? null;
    const changed =
      (o?.taxable_jpy ?? null) !== (n?.taxable_jpy ?? null) || (o?.tax_jpy ?? null) !== (n?.tax_jpy ?? null);
    taxSummaryDiffs.push({
      tax_category: category,
      old_taxable_jpy: o?.taxable_jpy ?? null,
      old_tax_jpy: o?.tax_jpy ?? null,
      new_taxable_jpy: n?.taxable_jpy ?? null,
      new_tax_jpy: n?.tax_jpy ?? null,
      changed,
    });
  }

  const hasLineChange = lineDiffs.some((l) => l.status !== "unchanged");
  const identical =
    headerDiffs.length === 0 &&
    !hasLineChange &&
    !subtotalDiff.changed &&
    !totalDiff.changed &&
    taxSummaryDiffs.every((t) => !t.changed);

  return { headerDiffs, lineDiffs, subtotalDiff, taxSummaryDiffs, totalDiff, identical };
}
