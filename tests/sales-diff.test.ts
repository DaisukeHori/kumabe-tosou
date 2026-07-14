import { describe, expect, it } from "vitest";

import { diffIssuedSnapshots } from "@/modules/sales/internal/diff";
import type { IssuedContentSnapshot } from "@/modules/sales/contracts";

/**
 * canonical: docs/design/crm-suite/02-sales.md §11.1 (版間差分)。DB 接続不要の純関数テスト
 * (§13.1 sales-diff.test.ts — 実装計画書「成果物5」で明記されたテストファイル)。
 */

function baseSnapshot(overrides: Partial<IssuedContentSnapshot> = {}): IssuedContentSnapshot {
  return {
    doc_type: "quote",
    doc_no: "Q-2026-0001",
    version: 1,
    issue_date: "2026-07-01",
    transaction_date: "2026-07-01",
    valid_until: "2026-07-31",
    billing_name: "隈部太郎",
    billing_suffix: "様",
    billing_address: "熊本県熊本市中央区1-1-1",
    site_name: "本社工場",
    site_address: "熊本県熊本市中央区2-2-2",
    notes: null,
    tax_rounding: "floor",
    issuer: {
      issuer_name: "隈部塗装",
      registration_number: "T1234567890123",
      address: null,
      tel: null,
      email: null,
      seal_storage_path: null,
      bank_account: null,
      transfer_fee_note: null,
    },
    lines: [
      {
        position: 0,
        description: "3Dプリント表面処理・塗装",
        quantity: 10,
        unit: "個",
        unit_price_jpy: 1000,
        amount_jpy: 10000,
        tax_category: "standard_10",
      },
    ],
    subtotal_jpy: 10000,
    tax_summary: [{ tax_category: "standard_10", taxable_jpy: 10000, tax_jpy: 1000 }],
    total_jpy: 11000,
    ...overrides,
  };
}

describe("diffIssuedSnapshots (§11.1 版間差分)", () => {
  it("完全同一なら identical=true・全ての差分配列が空", () => {
    const snapshot = baseSnapshot();
    const result = diffIssuedSnapshots(snapshot, { ...snapshot });
    expect(result.identical).toBe(true);
    expect(result.headerDiffs).toEqual([]);
    expect(result.lineDiffs.every((l) => l.status === "unchanged")).toBe(true);
    expect(result.subtotalDiff.changed).toBe(false);
    expect(result.totalDiff.changed).toBe(false);
    expect(result.taxSummaryDiffs.every((t) => !t.changed)).toBe(true);
  });

  it("ヘッダ1項目変更 (billing_name) を検出する", () => {
    const older = baseSnapshot();
    const newer = baseSnapshot({ billing_name: "隈部次郎" });
    const result = diffIssuedSnapshots(older, newer);
    expect(result.identical).toBe(false);
    expect(result.headerDiffs).toContainEqual({ field: "billing_name", old: "隈部太郎", new: "隈部次郎" });
    // 他のヘッダフィールドは変化なしのため含まれない
    expect(result.headerDiffs).toHaveLength(1);
  });

  it("issuer は issuer_name・registration_number のみ比較対象 (issuer.address 等の変化は無視)", () => {
    const older = baseSnapshot();
    const newer = baseSnapshot({
      issuer: { ...older.issuer, address: "熊本県熊本市中央区9-9-9" },
    });
    const result = diffIssuedSnapshots(older, newer);
    expect(result.identical).toBe(true);
    expect(result.headerDiffs).toEqual([]);
  });

  it("valid_until が null → 値ありに変わる差分を空文字との比較で検出する", () => {
    const older = baseSnapshot({ valid_until: null });
    const newer = baseSnapshot({ valid_until: "2026-08-31" });
    const result = diffIssuedSnapshots(older, newer);
    expect(result.headerDiffs).toContainEqual({ field: "valid_until", old: "", new: "2026-08-31" });
  });

  it("明細行の追加を検出する (added)", () => {
    const older = baseSnapshot();
    const newer = baseSnapshot({
      lines: [
        ...older.lines,
        {
          position: 1,
          description: "送料（実費）",
          quantity: 1,
          unit: "式",
          unit_price_jpy: 800,
          amount_jpy: 800,
          tax_category: "standard_10",
        },
      ],
      subtotal_jpy: 10800,
      tax_summary: [{ tax_category: "standard_10", taxable_jpy: 10800, tax_jpy: 1080 }],
      total_jpy: 11880,
    });
    const result = diffIssuedSnapshots(older, newer);
    expect(result.identical).toBe(false);
    const added = result.lineDiffs.filter((l) => l.status === "added");
    expect(added).toHaveLength(1);
    expect(added[0]?.text).toContain("送料（実費）");
    const unchanged = result.lineDiffs.filter((l) => l.status === "unchanged");
    expect(unchanged).toHaveLength(1);
  });

  it("明細行の削除を検出する (removed)", () => {
    const older = baseSnapshot({
      lines: [
        ...baseSnapshot().lines,
        {
          position: 1,
          description: "送料（実費）",
          quantity: 1,
          unit: "式",
          unit_price_jpy: 800,
          amount_jpy: 800,
          tax_category: "standard_10",
        },
      ],
    });
    const newer = baseSnapshot();
    const result = diffIssuedSnapshots(older, newer);
    const removed = result.lineDiffs.filter((l) => l.status === "removed");
    expect(removed).toHaveLength(1);
    expect(removed[0]?.text).toContain("送料（実費）");
  });

  it("明細行の変更 (単価改定) は削除+追加として検出される (行文字列正規化の一致判定)", () => {
    const older = baseSnapshot();
    const newer = baseSnapshot({
      lines: [{ ...older.lines[0]!, unit_price_jpy: 1200, amount_jpy: 12000 }],
      subtotal_jpy: 12000,
      tax_summary: [{ tax_category: "standard_10", taxable_jpy: 12000, tax_jpy: 1200 }],
      total_jpy: 13200,
    });
    const result = diffIssuedSnapshots(older, newer);
    expect(result.lineDiffs.some((l) => l.status === "removed" && l.text.includes("@1000"))).toBe(true);
    expect(result.lineDiffs.some((l) => l.status === "added" && l.text.includes("@1200"))).toBe(true);
  });

  it("tax_summary・total の増減サマリを算出する", () => {
    const older = baseSnapshot();
    const newer = baseSnapshot({
      lines: [{ ...older.lines[0]!, quantity: 12, amount_jpy: 12000 }],
      subtotal_jpy: 12000,
      tax_summary: [{ tax_category: "standard_10", taxable_jpy: 12000, tax_jpy: 1200 }],
      total_jpy: 13200,
    });
    const result = diffIssuedSnapshots(older, newer);
    expect(result.subtotalDiff).toEqual({ old: 10000, new: 12000, changed: true });
    expect(result.totalDiff).toEqual({ old: 11000, new: 13200, changed: true });
    const standardDiff = result.taxSummaryDiffs.find((t) => t.tax_category === "standard_10");
    expect(standardDiff).toEqual({
      tax_category: "standard_10",
      old_taxable_jpy: 10000,
      old_tax_jpy: 1000,
      new_taxable_jpy: 12000,
      new_tax_jpy: 1200,
      changed: true,
    });
  });

  it("税区分の追加 (旧版に無かった reduced_8 が新版に出現) を null 側込みで検出する", () => {
    const older = baseSnapshot();
    const newer = baseSnapshot({
      tax_summary: [
        { tax_category: "standard_10", taxable_jpy: 10000, tax_jpy: 1000 },
        { tax_category: "reduced_8", taxable_jpy: 500, tax_jpy: 40 },
      ],
      total_jpy: 11540,
    });
    const result = diffIssuedSnapshots(older, newer);
    const reducedDiff = result.taxSummaryDiffs.find((t) => t.tax_category === "reduced_8");
    expect(reducedDiff).toEqual({
      tax_category: "reduced_8",
      old_taxable_jpy: null,
      old_tax_jpy: null,
      new_taxable_jpy: 500,
      new_tax_jpy: 40,
      changed: true,
    });
  });

  it("older・newer の入力順を入れ替えても対称に動作する (old/new が入れ替わるだけでロジックは崩れない)", () => {
    const a = baseSnapshot();
    const b = baseSnapshot({ billing_name: "隈部次郎", total_jpy: 22000 });
    const forward = diffIssuedSnapshots(a, b);
    const backward = diffIssuedSnapshots(b, a);
    expect(forward.headerDiffs).toContainEqual({ field: "billing_name", old: "隈部太郎", new: "隈部次郎" });
    expect(backward.headerDiffs).toContainEqual({ field: "billing_name", old: "隈部次郎", new: "隈部太郎" });
    expect(forward.totalDiff).toEqual({ old: 11000, new: 22000, changed: true });
    expect(backward.totalDiff).toEqual({ old: 22000, new: 11000, changed: true });
  });
});
