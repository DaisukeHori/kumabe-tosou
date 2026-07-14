import { describe, expect, it } from "vitest";

import { isEditableTarget } from "@/app/admin/_ui/use-escape-to-list";

/**
 * Issue #96 §F: `useEscapeToList` (Esc→一覧戻り共通フック) のうち、DOM 非依存で単体テストできる
 * `isEditableTarget` (フォーム入力中の Esc 誤爆防止) のみを検証する。`isOverlayOpen` は
 * `document.querySelector` に依存し vitest.config.ts の environment は "node" (jsdom 無し) の
 * ため、この環境では直接検証できない (calls/[id]/CallDetailInteractive.tsx の既存
 * `isDialogOpen()` も同じ理由でテスト対象外になっている既存方針に倣う)。
 */
function fakeElement(props: Partial<{ tagName: string; isContentEditable: boolean }>): EventTarget {
  return { tagName: "DIV", isContentEditable: false, ...props } as unknown as EventTarget;
}

describe("isEditableTarget", () => {
  it("null は false", () => {
    expect(isEditableTarget(null)).toBe(false);
  });

  it("INPUT は true", () => {
    expect(isEditableTarget(fakeElement({ tagName: "INPUT" }))).toBe(true);
  });

  it("TEXTAREA は true", () => {
    expect(isEditableTarget(fakeElement({ tagName: "TEXTAREA" }))).toBe(true);
  });

  it("SELECT は true", () => {
    expect(isEditableTarget(fakeElement({ tagName: "SELECT" }))).toBe(true);
  });

  it("isContentEditable な DIV は true", () => {
    expect(isEditableTarget(fakeElement({ tagName: "DIV", isContentEditable: true }))).toBe(true);
  });

  it("通常の DIV/BUTTON は false", () => {
    expect(isEditableTarget(fakeElement({ tagName: "DIV" }))).toBe(false);
    expect(isEditableTarget(fakeElement({ tagName: "BUTTON" }))).toBe(false);
  });
});
