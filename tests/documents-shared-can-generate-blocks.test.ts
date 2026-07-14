import { describe, expect, it } from "vitest";

import { canGenerateBlocks } from "@/app/admin/documents/_shared";

/**
 * Issue #96 §C-左4: 「作業ブロックを用意」ボタンの表示専用判定 (実装計画書 issue-61.md 成果物2)。
 * `document-detail.tsx` の private 関数を `../_shared` へ export 移動し、`DealWorkSummaryCard.tsx`
 * からも同一判定を再利用できるようにした (2 箇所で判定がズレることを防ぐ)。表示専用の
 * ショートカットであり、実際の可否は generateBlocksAction 側 (facade) が再検証する。
 */
describe("canGenerateBlocks", () => {
  it("order かつ issued は true", () => {
    expect(canGenerateBlocks("order", "issued")).toBe(true);
  });

  it("order かつ accepted は true", () => {
    expect(canGenerateBlocks("order", "accepted")).toBe(true);
  });

  it("order かつ draft は false (発行前)", () => {
    expect(canGenerateBlocks("order", "draft")).toBe(false);
  });

  it("order かつ voided は false", () => {
    expect(canGenerateBlocks("order", "voided")).toBe(false);
  });

  it("quote は status に関わらず false (order 以外の doc_type は対象外)", () => {
    expect(canGenerateBlocks("quote", "issued")).toBe(false);
    expect(canGenerateBlocks("quote", "accepted")).toBe(false);
  });

  it("invoice は status に関わらず false", () => {
    expect(canGenerateBlocks("invoice", "issued")).toBe(false);
  });
});
