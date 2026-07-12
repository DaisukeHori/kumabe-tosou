import { describe, expect, it } from "vitest";

import type { SimEstimateSnapshot } from "@/modules/crm/contracts";
import { DERIVATION_RULES, type DocType } from "@/modules/sales/contracts";
import {
  buildDerivedDocumentLines,
  buildSimulatorQuoteDraft,
  resolveDerivedTransactionDate,
  type DerivableSourceLine,
} from "@/modules/sales/internal/derive";

/**
 * canonical: docs/design/crm-suite/02-sales.md §4.4 (deriveDocument の複製規則) / §9.1・§9.2
 * (シミュレーター → 見積原案の変換規則)。06-simulator.md §5.4 (T1〜T7) は snapshot 入力意味論の
 * canonical。純関数のみを対象とし DB には接続しない。
 */

const DOC_TYPES: DocType[] = ["quote", "order", "delivery", "invoice"];

// ============================================================
// DERIVATION_RULES: 許可 4 経路 + 禁止代表 (facade.deriveDocument が実際に使う判定式
// `DERIVATION_RULES.some(rule => rule.from === source.doc_type && rule.to === to_type)` を
// そのまま再現して検証する — internal/state.ts の computeDerivableTo は「現在状態」まで
// 合成した別の関心事のため、ここでは DERIVATION_RULES 自体の許可表を独立して検証する)
// ============================================================

function isAllowedDerivation(from: DocType, to: DocType): boolean {
  return DERIVATION_RULES.some((rule) => rule.from === from && rule.to === to);
}

describe("DERIVATION_RULES — 許可 4 経路 + 禁止代表 (facade.deriveDocument の判定式と同型)", () => {
  it("許可: quote→order / quote→invoice / order→delivery / delivery→invoice", () => {
    expect(isAllowedDerivation("quote", "order")).toBe(true);
    expect(isAllowedDerivation("quote", "invoice")).toBe(true);
    expect(isAllowedDerivation("order", "delivery")).toBe(true);
    expect(isAllowedDerivation("delivery", "invoice")).toBe(true);
  });

  it("禁止代表: order→quote (逆行) は許可されない", () => {
    expect(isAllowedDerivation("order", "quote")).toBe(false);
  });

  it("禁止代表: invoice→* (invoice は終端。どこへも派生できない)", () => {
    for (const to of DOC_TYPES) {
      expect(isAllowedDerivation("invoice", to)).toBe(false);
    }
  });

  it("禁止代表: 同種間の派生 (quote→quote 等) は一切許可されない", () => {
    for (const docType of DOC_TYPES) {
      expect(isAllowedDerivation(docType, docType)).toBe(false);
    }
  });

  it("禁止代表: order→invoice (order は delivery を経由する必要があり直行できない)", () => {
    expect(isAllowedDerivation("order", "invoice")).toBe(false);
  });

  it("禁止代表: delivery→order / delivery→quote (逆行・飛び越え)", () => {
    expect(isAllowedDerivation("delivery", "order")).toBe(false);
    expect(isAllowedDerivation("delivery", "quote")).toBe(false);
  });

  it("許可経路は正確に 4 件のみ (想定外の経路が紛れ込んでいないこと)", () => {
    const allowedPairs = DOC_TYPES.flatMap((from) => DOC_TYPES.map((to) => [from, to] as const)).filter(([from, to]) =>
      isAllowedDerivation(from, to),
    );
    expect(allowedPairs).toEqual([
      ["quote", "order"],
      ["quote", "invoice"],
      ["order", "delivery"],
      ["delivery", "invoice"],
    ]);
  });
});

// ============================================================
// buildDerivedDocumentLines (§4.4: 複製対象・非複製、position 維持)
// ============================================================

function sourceLine(overrides: Partial<DerivableSourceLine> = {}): DerivableSourceLine {
  return {
    position: 0,
    description: "施工費",
    quantity: 1,
    unit: "式",
    unit_price_jpy: 10_000,
    amount_jpy: 10_000,
    tax_category: "standard_10",
    work_type_key: "sanding",
    source: { grade_key: "premium", size_key: "m", option_keys: ["clear_coat"] },
    ...overrides,
  };
}

describe("buildDerivedDocumentLines — document_lines 全行複製 (§4.4)", () => {
  it("複製対象の全フィールドを引き継ぐ (description/quantity/unit/unit_price_jpy/amount_jpy/tax_category/work_type_key/source)", () => {
    const result = buildDerivedDocumentLines([sourceLine()]);
    expect(result).toEqual([
      {
        description: "施工費",
        quantity: 1,
        unit: "式",
        unit_price_jpy: 10_000,
        amount_jpy: 10_000,
        tax_category: "standard_10",
        work_type_key: "sanding",
        source: { grade_key: "premium", size_key: "m", option_keys: ["clear_coat"] },
      },
    ]);
  });

  it("非複製: id / position / document_id / created_at 相当のフィールドは出力に含まれない (id は DB default 任せ)", () => {
    const result = buildDerivedDocumentLines([sourceLine()]);
    expect(result[0]).not.toHaveProperty("id");
    expect(result[0]).not.toHaveProperty("position");
    expect(result[0]).not.toHaveProperty("document_id");
    expect(result[0]).not.toHaveProperty("created_at");
  });

  it("work_type_key / source が null の行はそのまま null で複製される (非必須フィールド)", () => {
    const result = buildDerivedDocumentLines([sourceLine({ work_type_key: null, source: null })]);
    expect(result[0]?.work_type_key).toBeNull();
    expect(result[0]?.source).toBeNull();
  });

  it("position 維持: 入力が position 順不同でも position 昇順に並べ替えて出力する", () => {
    const result = buildDerivedDocumentLines([
      sourceLine({ position: 2, description: "3番目" }),
      sourceLine({ position: 0, description: "1番目" }),
      sourceLine({ position: 1, description: "2番目" }),
    ]);
    expect(result.map((l) => l.description)).toEqual(["1番目", "2番目", "3番目"]);
  });

  it("空配列を渡した場合は空配列を返す (quote_only 原案の 0 行 draft 等)", () => {
    expect(buildDerivedDocumentLines([])).toEqual([]);
  });

  it("引数の配列を破壊的に変更しない (呼び出し元の source line 配列を書き換えない)", () => {
    const input = [sourceLine({ position: 1 }), sourceLine({ position: 0 })];
    const inputCopy = [...input];
    buildDerivedDocumentLines(input);
    expect(input).toEqual(inputCopy);
  });
});

// ============================================================
// resolveDerivedTransactionDate (§4.4「transaction_date の引継ぎ (v1.1)」)
// ============================================================

describe("resolveDerivedTransactionDate — transaction_date 引継ぎ規則 (delivery→invoice のみ)", () => {
  it("delivery→invoice のみ、派生元の issue_date を引き継ぐ", () => {
    expect(resolveDerivedTransactionDate("delivery", "invoice", "2026-07-01")).toBe("2026-07-01");
  });

  it("delivery→invoice で派生元 issue_date が null の場合も null をそのまま透過する (発行前 delivery からは派生できないはずだが、null 入力自体は素通しする)", () => {
    expect(resolveDerivedTransactionDate("delivery", "invoice", null)).toBeNull();
  });

  it("quote→order は null (draft で編集可)", () => {
    expect(resolveDerivedTransactionDate("quote", "order", "2026-07-01")).toBeNull();
  });

  it("quote→invoice は null (小口向け直行派生。delivery を経由しないため引継ぎ元が無い)", () => {
    expect(resolveDerivedTransactionDate("quote", "invoice", "2026-07-01")).toBeNull();
  });

  it("order→delivery は null", () => {
    expect(resolveDerivedTransactionDate("order", "delivery", "2026-07-01")).toBeNull();
  });

  it("invoice→delivery のような許可されない組み合わせで呼ばれても例外を投げず null を返す (呼び出し側が DERIVATION_RULES で先に弾く前提だが、本関数自体は防御的に null)", () => {
    expect(resolveDerivedTransactionDate("invoice", "delivery", "2026-07-01")).toBeNull();
  });
});

// ============================================================
// buildSimulatorQuoteDraft (§9.1: シミュレーター → 見積原案の変換規則)
// ============================================================

function estimate(overrides: Partial<SimEstimateSnapshot> = {}): SimEstimateSnapshot {
  return {
    grade_key: "premium",
    grade_label: "プレミアム",
    size_key: "m",
    size_label: "M(30cm以下)",
    quantity: 3,
    option_keys: ["clear_coat"],
    quote_only: false,
    total_min: 9_000,
    total_max: 11_000,
    applied_tier: "3〜5個",
    breakdown: [
      { label: "基本塗装", factor: "M" },
      { label: "クリアコート", factor: "+1000円" },
    ],
    ...overrides,
  };
}

describe("buildSimulatorQuoteDraft — quote_only=false (通常1行・単価逆算)", () => {
  it("明細 1 行を生成する (description/quantity/unit/tax_category/work_type_key/source)", () => {
    const result = buildSimulatorQuoteDraft(estimate());
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({
      description: "3Dプリント表面処理・塗装（プレミアム／M(30cm以下)）",
      quantity: 3,
      unit: "個",
      tax_category: "standard_10",
      work_type_key: null,
      source: { grade_key: "premium", size_key: "m", option_keys: ["clear_coat"] },
    });
  });

  it("単価逆算: unit_price_jpy = round(total_max ÷ quantity ÷ 1.1)、amount_jpy = round(unit_price_jpy × quantity)", () => {
    // total_max=11000, quantity=3 → 11000/3/1.1 = 3333.333... → round = 3333
    // amount_jpy = round(3333*3) = 9999
    const result = buildSimulatorQuoteDraft(estimate({ total_max: 11_000, quantity: 3 }));
    expect(result.lines[0]?.unit_price_jpy).toBe(3333);
    expect(result.lines[0]?.amount_jpy).toBe(9999);
  });

  it("単価逆算が割り切れるケースでも同じ式で算出する (total_max=110000, quantity=10 → unit=10000)", () => {
    const result = buildSimulatorQuoteDraft(estimate({ total_max: 110_000, quantity: 10 }));
    expect(result.lines[0]?.unit_price_jpy).toBe(10_000);
    expect(result.lines[0]?.amount_jpy).toBe(100_000);
  });

  it("notes 文言: applied_tier あり・total_min/max はカンマ区切り、breakdown は「・」区切り", () => {
    const result = buildSimulatorQuoteDraft(estimate());
    expect(result.notes).toBe(
      "シミュレーター概算: 税込 ¥9,000〜¥11,000（3〜5個／基本塗装・クリアコート）。上記単価は概算上限からの税抜換算です。正式なお見積もりで確定します。",
    );
  });

  it("notes 文言: applied_tier が null の場合は「数量スライドなし」と表記する", () => {
    const result = buildSimulatorQuoteDraft(estimate({ applied_tier: null }));
    expect(result.notes).toContain("数量スライドなし");
    expect(result.notes).not.toContain("null");
  });

  it("大きい金額でも toLocaleString('ja-JP') のカンマ区切りが正しく適用される", () => {
    const result = buildSimulatorQuoteDraft(estimate({ total_min: 1_234_567, total_max: 2_345_678 }));
    expect(result.notes).toContain("¥1,234,567");
    expect(result.notes).toContain("¥2,345,678");
  });
});

describe("buildSimulatorQuoteDraft — quote_only=true (XL、明細0行+notes)", () => {
  it("明細 0 行を返す (total_min/max は金額として意味を持たないため単価計算しない)", () => {
    const result = buildSimulatorQuoteDraft(estimate({ quote_only: true }));
    expect(result.lines).toEqual([]);
  });

  it("notes は個別見積もりメモのみ (共通レンジ文言は使わない)", () => {
    const result = buildSimulatorQuoteDraft(
      estimate({ quote_only: true, size_label: "XL(30cm超)", quantity: 50 }),
    );
    expect(result.notes).toBe("個別見積もり（XL(30cm超)・50 個）");
    expect(result.notes).not.toContain("シミュレーター概算");
  });

  it("quote_only=true では total_min/total_max/applied_tier/breakdown の値に関わらず notes が変わらない (無視される)", () => {
    const a = buildSimulatorQuoteDraft(
      estimate({ quote_only: true, size_label: "XL", quantity: 10, total_max: 999_999, applied_tier: "無視されるはず" }),
    );
    const b = buildSimulatorQuoteDraft(
      estimate({ quote_only: true, size_label: "XL", quantity: 10, total_max: 1, applied_tier: null }),
    );
    expect(a.notes).toBe(b.notes);
  });
});
