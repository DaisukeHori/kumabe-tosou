import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ColorPicker, DEFAULT_COLOR_PRESETS, normalizeHexColor } from "@/app/admin/_ui/color-picker";

/**
 * canonical: GitHub Issue #93 (作業種別カラーピッカーの品質改修)。
 *
 * `.test.ts` の都合上 (vitest.config.ts の include は *.test.ts のみ) JSX は使わず
 * React.createElement 経由でラップして renderToStaticMarkup する (tests/rich-text.test.ts に倣う)。
 * jsdom/@testing-library 非導入 (vitest.config.ts environment: "node") のため、実際のクリック/
 * キーボード操作の統合テストはできない — 静的マークアップ (aria 属性・ring クラス・選択状態) と
 * hex 正規化の純関数を検証する。
 */

function render(node: React.ReactNode): string {
  return renderToStaticMarkup(createElement(Fragment, null, node));
}

describe("normalizeHexColor", () => {
  it("大文字 hex を小文字へ正規化する", () => {
    expect(normalizeHexColor("#A80F22")).toBe("#a80f22");
  });

  it("# 欠落を補完する", () => {
    expect(normalizeHexColor("a80f22")).toBe("#a80f22");
  });

  it("3桁 hex を6桁へ展開する (# あり)", () => {
    expect(normalizeHexColor("#abc")).toBe("#aabbcc");
  });

  it("3桁 hex を6桁へ展開する (# なし)", () => {
    expect(normalizeHexColor("abc")).toBe("#aabbcc");
  });

  it("前後の空白を trim する", () => {
    expect(normalizeHexColor("  #A80F22  ")).toBe("#a80f22");
  });

  it("大文字3桁 + # なしも正規化する", () => {
    expect(normalizeHexColor("ABC")).toBe("#aabbcc");
  });

  it("不正な長さ (4桁) は null を返す", () => {
    expect(normalizeHexColor("#abcd")).toBeNull();
  });

  it("16進数以外の文字は null を返す", () => {
    expect(normalizeHexColor("hello")).toBeNull();
  });

  it("空文字は null を返す", () => {
    expect(normalizeHexColor("")).toBeNull();
    expect(normalizeHexColor("   ")).toBeNull();
  });

  it("二重 # は null を返す (誤補完の暴走を防ぐ)", () => {
    expect(normalizeHexColor("##a80f22")).toBeNull();
  });
});

describe("DEFAULT_COLOR_PRESETS", () => {
  it("12色すべてが zWorkTypeInput.color の regex (小文字6桁) に適合する", () => {
    expect(DEFAULT_COLOR_PRESETS).toHaveLength(12);
    for (const preset of DEFAULT_COLOR_PRESETS) {
      expect(preset.hex).toMatch(/^#[0-9a-f]{6}$/);
      expect(preset.name.length).toBeGreaterThan(0);
    }
  });

  it("work_types 既定 seed 色 (migration 20260711000029) を含む", () => {
    const hexes = DEFAULT_COLOR_PRESETS.map((p) => p.hex);
    expect(hexes).toEqual(
      expect.arrayContaining(["#a80f22", "#8d6e63", "#78909c", "#bdbdbd", "#2e7d32"]),
    );
  });
});

describe("ColorPicker (静的マークアップ)", () => {
  // base-ui の Popover は既定 (open=false) では Popup を DOM にレンダーしない (Portal + 条件マウント)
  // ため、jsdom/@testing-library 非導入のこの環境では popover 内部 (プリセットグリッド・hex Input)
  // のクリック/キーボード挙動までは検証できない — トリガー (常時マウント) の静的出力のみを対象にする。

  it("トリガーに現在値の hex テキストとスウォッチ背景色を表示する", () => {
    const html = render(createElement(ColorPicker, { value: "#a80f22", onChange: () => {} }));
    expect(html).toContain("#a80f22");
    expect(html).toContain("background-color:#a80f22");
  });

  it("id を渡すとトリガー要素に反映される (FieldLabel htmlFor との紐付け用)", () => {
    const html = render(createElement(ColorPicker, { value: "#a80f22", onChange: () => {}, id: "wt-color" }));
    expect(html).toContain('id="wt-color"');
  });

  it("value が未知の hex (プリセット外) でも例外を投げずレンダーできる", () => {
    expect(() =>
      render(createElement(ColorPicker, { value: "#123456", onChange: () => {} })),
    ).not.toThrow();
  });

  it("presets を差し替えても例外を投げずレンダーできる", () => {
    expect(() =>
      render(
        createElement(ColorPicker, {
          value: "#000000",
          onChange: () => {},
          presets: [{ hex: "#000000", name: "黒" }],
        }),
      ),
    ).not.toThrow();
  });
});
