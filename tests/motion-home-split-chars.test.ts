import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SplitChars } from "@/components/motion/split-chars";

/**
 * split-chars.tsx (Server Component) のユニットテスト。
 * "use client" を持たない純関数コンポーネントのため、React は
 * createElement + renderToStaticMarkup で直接テストできる
 * (docs/design/motion-specs/page-home.md §8)。
 */

function charCis(html: string): number[] {
  const matches = [...html.matchAll(/class="kt-hero-char" style="--ci:(\d+)"/g)];
  return matches.map((m) => Number(m[1]));
}

function charCount(html: string): number {
  return (html.match(/kt-hero-char/g) ?? []).length;
}

describe("SplitChars", () => {
  it("「外観に。」→ kt-hero-char が 4 個、--ci:0〜--ci:3", () => {
    const html = renderToStaticMarkup(
      createElement(SplitChars, null, "外観に。"),
    );
    expect(charCount(html)).toBe(4);
    expect(charCis(html)).toEqual([0, 1, 2, 3]);
  });

  it("ネスト (kt-hero-line > span > テキスト + kt-paint-mark) で 12 個・通し番号継続・kt-paint-mark 保存", () => {
    const html = renderToStaticMarkup(
      createElement(
        SplitChars,
        null,
        createElement(
          "span",
          { className: "kt-hero-line" },
          createElement(
            "span",
            null,
            "量産品と",
            createElement(
              "span",
              { className: "kt-paint-mark" },
              "見分けがつかない",
            ),
          ),
        ),
      ),
    );
    expect(charCount(html)).toBe(12);
    expect(charCis(html)).toContain(11);
    expect(html).toContain("kt-paint-mark");
  });

  it('"A B" → span 2 個 (空白は素通し)', () => {
    const html = renderToStaticMarkup(createElement(SplitChars, null, "A B"));
    expect(charCount(html)).toBe(2);
    expect(charCis(html)).toEqual([0, 1]);
  });

  it("3 行のヒーロー実データ → 24 個、--ci:23 が最終", () => {
    const html = renderToStaticMarkup(
      createElement(
        SplitChars,
        null,
        createElement(
          "span",
          { className: "kt-hero-line" },
          createElement("span", null, "3Dプリントを、"),
        ),
        createElement(
          "span",
          { className: "kt-hero-line" },
          createElement(
            "span",
            null,
            "量産品と",
            createElement(
              "span",
              { className: "kt-paint-mark" },
              "見分けがつかない",
            ),
          ),
        ),
        createElement(
          "span",
          { className: "kt-hero-line" },
          createElement("span", null, "外観に。"),
        ),
      ),
    );
    const cis = charCis(html);
    expect(charCount(html)).toBe(24);
    expect(cis.length).toBe(24);
    expect(Math.max(...cis)).toBe(23);
    expect(cis[cis.length - 1]).toBe(23);
  });
});
