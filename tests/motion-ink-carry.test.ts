import { describe, expect, it } from "vitest";

import {
  INK_FALLBACK,
  INK_MIN_CONTRAST,
  INK_REFERENCE_BG,
  contrastRatio,
  extractCssVarName,
  hexToRgb,
  relativeLuminance,
  resolveInkColor,
} from "@/components/motion/ink-carry";

/**
 * ink-carry.ts (Wave5 W5-A) の純関数テスト。輝度・コントラスト計算・
 * DD-090 (淡色) フォールバック判定を検証する。DOM/sessionStorage 依存の
 * ラッパ (resolveCssColorValue / applyInkCssVar 等) は §1.7 規約により
 * unit では追わない (実機 E2E に委ねる)。
 */

describe("hexToRgb", () => {
  it("6桁 hex を正しくパースする", () => {
    expect(hexToRgb("#a80f22")).toEqual({ r: 168, g: 15, b: 34 });
  });
  it("先頭 # なしでも解釈する", () => {
    expect(hexToRgb("ffffff")).toEqual({ r: 255, g: 255, b: 255 });
  });
  it("3桁 hex を展開する", () => {
    expect(hexToRgb("#fff")).toEqual({ r: 255, g: 255, b: 255 });
  });
  it("不正な値は null", () => {
    expect(hexToRgb("var(--dd-090-a)")).toBeNull();
    expect(hexToRgb("not-a-color")).toBeNull();
  });
});

describe("relativeLuminance (WCAG)", () => {
  it("白は輝度 1、黒は輝度 0", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
  });
  it("不正な hex は 0 (安全側) を返す", () => {
    expect(relativeLuminance("nope")).toBe(0);
  });
});

describe("contrastRatio (WCAG)", () => {
  it("白 vs 黒 は 21:1", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
  });
  it("同色は 1:1", () => {
    expect(contrastRatio("#a80f22", "#a80f22")).toBeCloseTo(1, 5);
  });
  it("順序を入れ替えても同じ結果", () => {
    expect(contrastRatio("#fbfbf8", "#212428")).toBeCloseTo(
      contrastRatio("#212428", "#fbfbf8"),
      5,
    );
  });
});

describe("resolveInkColor — 淡色フォールバック (実装計画 §5 W5-A)", () => {
  it("DD-090 (プレシャスホワイトパール #f8f6f0) は --paper とのコントラストが 3:1 未満のため --soul にフォールバックする", () => {
    const dd090 = "#f8f6f0";
    expect(contrastRatio(dd090, INK_REFERENCE_BG)).toBeLessThan(
      INK_MIN_CONTRAST,
    );
    expect(resolveInkColor(dd090)).toBe(INK_FALLBACK);
  });

  it("DD-202 (ブラック #212428) は十分なコントラストがあるためそのまま使う", () => {
    const dd202 = "#212428";
    expect(contrastRatio(dd202, INK_REFERENCE_BG)).toBeGreaterThanOrEqual(
      INK_MIN_CONTRAST,
    );
    expect(resolveInkColor(dd202)).toBe(dd202);
  });

  it("DD-46V (ソウルレッドクリスタル #c4132e) はコントラスト十分でそのまま使う", () => {
    const dd46v = "#c4132e";
    expect(resolveInkColor(dd46v)).toBe(dd46v);
  });

  it("不正な hex は常にフォールバック", () => {
    expect(resolveInkColor("var(--dd-090-a)")).toBe(INK_FALLBACK);
  });

  it("カスタムの参照背景・フォールバックも差し替え可能 (純関数として)", () => {
    // 黒背景に対しては白系の淡色でも十分なコントラストが出る
    expect(resolveInkColor("#f8f6f0", "#000000", "#ff00ff")).toBe("#f8f6f0");
  });
});

describe("extractCssVarName", () => {
  it("var(--foo-bar) から --foo-bar を取り出す", () => {
    expect(extractCssVarName("var(--dd-090-a)")).toBe("--dd-090-a");
  });
  it("前後の空白を許容する", () => {
    expect(extractCssVarName("  var(--dd-090-a)  ")).toBe("--dd-090-a");
  });
  it("var() 形式でなければ null", () => {
    expect(extractCssVarName("#f8f6f0")).toBeNull();
    expect(extractCssVarName("linear-gradient(red, blue)")).toBeNull();
  });
});
