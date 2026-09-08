import { describe, expect, it } from "vitest";

import { shouldToggleConsentFromLabelClick } from "@/components/contact/consent-label";

/**
 * 同意チェックボックスのラベルクリック判定の単体テスト。
 *
 * 検証担当の指摘 (E2E でラベルを固定座標クリックするとリンクに当たり「チェックが入らない」
 * ように見える) を、期待仕様としてコード側に固定するもの。
 * - リンク (<a>) の内側のクリック → トグルしない (別タブでポリシーを開く)
 * - それ以外のラベル文字のクリック → トグルする
 */

/** closest("a") がヒットする / しない target のスタブ */
function targetIn(selectorsHit: string | null) {
  return {
    closest(selectors: string) {
      return selectors === selectorsHit ? { tagName: "A" } : null;
    },
  };
}

describe("shouldToggleConsentFromLabelClick", () => {
  it("リンクの内側のクリックではトグルしない (ポリシーを別タブで開く動作を優先)", () => {
    expect(shouldToggleConsentFromLabelClick(targetIn("a"))).toBe(false);
  });

  it("リンク以外のラベル文字 (「に同意する」「*」など) のクリックではトグルする", () => {
    expect(shouldToggleConsentFromLabelClick(targetIn(null))).toBe(true);
  });

  it("target が null / 非オブジェクトでもトグル側にフォールバックする", () => {
    expect(shouldToggleConsentFromLabelClick(null)).toBe(true);
    expect(shouldToggleConsentFromLabelClick(undefined)).toBe(true);
    expect(shouldToggleConsentFromLabelClick("label")).toBe(true);
  });

  it("closest を持たない target (SVG など古い実装差異) でもトグル側にフォールバックする", () => {
    expect(shouldToggleConsentFromLabelClick({})).toBe(true);
  });

  it("closest が undefined を返す実装でもリンク外扱いにする", () => {
    expect(shouldToggleConsentFromLabelClick({ closest: () => undefined })).toBe(true);
  });
});
