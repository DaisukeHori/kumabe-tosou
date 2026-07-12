import { describe, expect, it } from "vitest";

import { DERIVATION_RULES, type DocType, type DocumentStatus } from "@/modules/sales/contracts";
import { canTransition, computeDerivableTo } from "@/modules/sales/internal/state";

/**
 * canonical: docs/design/crm-suite/02-sales.md §4.1 (documents.status 状態機械図) / §4.2
 * (状態 × 意味論表) / §4.4 (deriveDocument の派生可能条件)。
 *
 * 解釈方針 (実装計画書「未解決点1」): canTransition は §4.1 の状態機械図が持つ**全エッジ**を
 * 実装する純関数として検証する (facade が実際に session UPDATE で使うのはこのうち
 * accepted/declined/expired/voided 関連の遷移のみだが、canTransition 自体は図の全エッジに
 * true/false を持つ)。このテストは全 7 状態 × 全 7 遷移 × 全 4 書類種別 (= 196 通り) を
 * 網羅する独立した期待値テーブル (EXPECTED_EDGES) で検証する — 実装 (internal/state.ts の
 * TRANSITION_EDGES) をそのまま import して比較する退行防止ではなく、02-sales.md §4.1 の
 * 図から独立して書き起こした期待値と突き合わせる。
 */

const STATES: DocumentStatus[] = ["draft", "issued", "accepted", "declined", "expired", "paid", "voided"];
const DOC_TYPES: DocType[] = ["quote", "order", "delivery", "invoice"];

type ExpectedEdge = { from: DocumentStatus; to: DocumentStatus; docTypes: "all" | DocType[] };

/**
 * §4.1 図を独立して書き起こした期待値テーブル。
 *   draft --issue--> issued (全種別)
 *   issued --voided--> voided (全種別。発行後のみ。invoice は入金 0 件時のみだが、その入金ガードは
 *     trigger 側の責務であり canTransition (種別×状態の純粋な可否) の対象外)
 *   issued --accepted/declined/expired--> (quote のみ)
 *   issued --paid--> (invoice のみ)
 *   accepted --voided--> (quote のみ)
 *   expired --accepted--> (quote のみ。遅れ承諾)
 *   expired --voided--> (quote のみ)
 *   paid --issued--> (invoice のみ。入金削除による trigger 専用の自動復帰経路)
 * それ以外 (voided/declined を from とする遷移、from===to、上記に無い組み合わせ) は全て false。
 */
const EXPECTED_EDGES: ExpectedEdge[] = [
  { from: "draft", to: "issued", docTypes: "all" },
  { from: "issued", to: "voided", docTypes: "all" },
  { from: "issued", to: "accepted", docTypes: ["quote"] },
  { from: "issued", to: "declined", docTypes: ["quote"] },
  { from: "issued", to: "expired", docTypes: ["quote"] },
  { from: "issued", to: "paid", docTypes: ["invoice"] },
  { from: "accepted", to: "voided", docTypes: ["quote"] },
  { from: "expired", to: "accepted", docTypes: ["quote"] },
  { from: "expired", to: "voided", docTypes: ["quote"] },
  { from: "paid", to: "issued", docTypes: ["invoice"] },
];

function expectedCanTransition(docType: DocType, from: DocumentStatus, to: DocumentStatus): boolean {
  return EXPECTED_EDGES.some(
    (edge) => edge.from === from && edge.to === to && (edge.docTypes === "all" || edge.docTypes.includes(docType)),
  );
}

describe("canTransition — 全7状態×全7遷移×全4書類種別の網羅マトリクス (§4.1/§4.2と1:1、196通り)", () => {
  for (const docType of DOC_TYPES) {
    for (const from of STATES) {
      for (const to of STATES) {
        const expected = expectedCanTransition(docType, from, to);
        it(`${docType}: ${from} → ${to} は ${expected ? "許可" : "禁止"}`, () => {
          expect(canTransition(docType, from, to)).toBe(expected);
        });
      }
    }
  }
});

describe("canTransition — voided は完全終端 (from='voided' はどの to/docType でも常に false)", () => {
  for (const docType of DOC_TYPES) {
    for (const to of STATES) {
      it(`${docType}: voided → ${to} は禁止`, () => {
        expect(canTransition(docType, "voided", to)).toBe(false);
      });
    }
  }
});

describe("canTransition — declined も終端 (from='declined' はどの to/docType でも常に false)", () => {
  for (const docType of DOC_TYPES) {
    for (const to of STATES) {
      it(`${docType}: declined → ${to} は禁止`, () => {
        expect(canTransition(docType, "declined", to)).toBe(false);
      });
    }
  }
});

describe("canTransition — 種別限定 (accepted/declined/expired は quote のみ、paid は invoice のみ)", () => {
  it("order/delivery/invoice は issued→accepted を許可しない (quote 限定)", () => {
    expect(canTransition("order", "issued", "accepted")).toBe(false);
    expect(canTransition("delivery", "issued", "accepted")).toBe(false);
    expect(canTransition("invoice", "issued", "accepted")).toBe(false);
    expect(canTransition("quote", "issued", "accepted")).toBe(true);
  });

  it("order/delivery/invoice は issued→declined を許可しない (quote 限定)", () => {
    expect(canTransition("order", "issued", "declined")).toBe(false);
    expect(canTransition("delivery", "issued", "declined")).toBe(false);
    expect(canTransition("invoice", "issued", "declined")).toBe(false);
    expect(canTransition("quote", "issued", "declined")).toBe(true);
  });

  it("order/delivery/invoice は issued→expired を許可しない (quote 限定)", () => {
    expect(canTransition("order", "issued", "expired")).toBe(false);
    expect(canTransition("delivery", "issued", "expired")).toBe(false);
    expect(canTransition("invoice", "issued", "expired")).toBe(false);
    expect(canTransition("quote", "issued", "expired")).toBe(true);
  });

  it("quote/order/delivery は issued→paid を許可しない (invoice 限定)", () => {
    expect(canTransition("quote", "issued", "paid")).toBe(false);
    expect(canTransition("order", "issued", "paid")).toBe(false);
    expect(canTransition("delivery", "issued", "paid")).toBe(false);
    expect(canTransition("invoice", "issued", "paid")).toBe(true);
  });

  it("quote/order/delivery は paid→issued (入金削除の自動復帰) を許可しない (invoice 限定)", () => {
    expect(canTransition("quote", "paid", "issued")).toBe(false);
    expect(canTransition("order", "paid", "issued")).toBe(false);
    expect(canTransition("delivery", "paid", "issued")).toBe(false);
    expect(canTransition("invoice", "paid", "issued")).toBe(true);
  });

  it("draft→issued と issued→voided は全種別で許可される (docTypes:'all')", () => {
    for (const docType of DOC_TYPES) {
      expect(canTransition(docType, "draft", "issued")).toBe(true);
      expect(canTransition(docType, "issued", "voided")).toBe(true);
    }
  });
});

describe("canTransition — expired→accepted (遅れ承諾、quote 限定)", () => {
  it("quote は expired→accepted を許可する (期限切れ後の遅れ承諾)", () => {
    expect(canTransition("quote", "expired", "accepted")).toBe(true);
  });

  it("order/delivery/invoice は expired 状態自体に到達しないため expired→accepted は禁止", () => {
    expect(canTransition("order", "expired", "accepted")).toBe(false);
    expect(canTransition("delivery", "expired", "accepted")).toBe(false);
    expect(canTransition("invoice", "expired", "accepted")).toBe(false);
  });
});

describe("canTransition — from===to は自己遷移としてどの状態でも常に false (図にエッジとして存在しない)", () => {
  for (const docType of DOC_TYPES) {
    for (const state of STATES) {
      it(`${docType}: ${state} → ${state} は禁止`, () => {
        expect(canTransition(docType, state, state)).toBe(false);
      });
    }
  }
});

// ============================================================
// computeDerivableTo (§4.4: DERIVATION_RULES × 現在状態が issued/accepted のときのみ)
// ============================================================

describe("computeDerivableTo — DERIVATION_RULES × 現状態から派生可能先を算出する", () => {
  it("draft は派生元になれない (issued/accepted のみ許可 — §4.4)", () => {
    expect(computeDerivableTo("quote", "draft")).toEqual([]);
  });

  it("declined/expired/paid/voided も派生元になれない", () => {
    expect(computeDerivableTo("quote", "declined")).toEqual([]);
    expect(computeDerivableTo("quote", "expired")).toEqual([]);
    expect(computeDerivableTo("invoice", "paid")).toEqual([]);
    expect(computeDerivableTo("quote", "voided")).toEqual([]);
  });

  it("quote(issued) は order/invoice へ派生可能 (DERIVATION_RULES 順に一致)", () => {
    expect(computeDerivableTo("quote", "issued")).toEqual(["order", "invoice"]);
  });

  it("quote(accepted) も issued と同じ派生可能先を持つ (accepted も許可条件を満たす)", () => {
    expect(computeDerivableTo("quote", "accepted")).toEqual(["order", "invoice"]);
  });

  it("order(issued) は delivery のみへ派生可能", () => {
    expect(computeDerivableTo("order", "issued")).toEqual(["delivery"]);
  });

  it("delivery(issued) は invoice のみへ派生可能", () => {
    expect(computeDerivableTo("delivery", "issued")).toEqual(["invoice"]);
  });

  it("invoice(issued) は派生先を持たない (DERIVATION_RULES に from='invoice' の行が無い)", () => {
    expect(computeDerivableTo("invoice", "issued")).toEqual([]);
  });

  it("DERIVATION_RULES 自体を書き換えても computeDerivableTo が追従する (ハードコード禁止の回帰) — 現状 4 経路であることの確認", () => {
    expect(DERIVATION_RULES).toEqual([
      { from: "quote", to: "order" },
      { from: "quote", to: "invoice" },
      { from: "order", to: "delivery" },
      { from: "delivery", to: "invoice" },
    ]);
  });
});
