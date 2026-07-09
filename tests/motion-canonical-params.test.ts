import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Wave 4 全体受入 — 正典パラメータ監査で発見した「未検証の重要ロジック」の
 * 回帰防止テスト (motion-implementation-plan.md §7 / motion-gap-report.md §5)。
 *
 * motion-hover-suite.test.ts (M2) は自区画のソースガードを持つが、他 6 区画
 * (signature / scroll-texture / page-home の一部 / page-colors /
 * page-story-process / page-rest) には正典値のリテラル回帰テストが無かった
 * (Wave 4 統合検証で発見)。DOM/CSSOM を組み立てず、ソースを fs で読んで
 * 正典パラメータを grep 検証する (M2 方式を踏襲。jsdom 偽陽性回避)。
 */

function readSrc(relPath: string): string {
  return readFileSync(path.resolve(__dirname, "..", relPath), "utf-8");
}

function section(css: string, name: string): string {
  const start = css.indexOf(`=== motion: ${name} ===`);
  const end = css.indexOf(`=== /motion: ${name} ===`);
  expect(start, `区画マーカー開始が見つからない: ${name}`).toBeGreaterThan(-1);
  expect(end, `区画マーカー終了が見つからない: ${name}`).toBeGreaterThan(start);
  return css.slice(start, end);
}

const globalsCss = readSrc("src/app/globals.css");

describe("motion: signature (M1) 正典パラメータ", () => {
  const sig = section(globalsCss, "signature");

  it.each([
    "transform: skewX(-14deg)", // G2 プログレスバー刷毛先端 (採用EXTRA)
    "transform: scaleX(0)", // G4 下線初期状態
    "transition: transform 0.35s var(--ease)", // G4 下線 0.35s
    "opacity 0.5s var(--ease)", // G3 インジケータ opacity
    "width 0.3s var(--ease)", // G1 カーソルリング状態遷移 0.3s
    "width: 32px", // G1 リング既定 32px
    "width: 48px", // G1 リンク hover 48px
    "width: 62px", // G1 VIEW 62px
    "background: rgba(168, 15, 34, 0.92)", // G1 VIEW 背景
  ])("正典値 %s を含む", (literal) => {
    expect(sig).toContain(literal);
  });

  it("全称ブランケット kill (*, *::before, *::after 0.01ms) を単独所有する", () => {
    expect(sig).toContain("transition-duration: 0.01ms !important");
    expect(sig).toContain("animation-duration: 0.01ms !important");
  });

  it("全称ブランケット kill はファイル全体で 1 箇所のみ (§1.5 #8 / §2-8 dedup)", () => {
    const occurrences = (
      globalsCss.match(/transition-duration: 0\.01ms !important/g) ?? []
    ).length;
    expect(occurrences).toBe(1);
  });

  it("cursor は pointer:fine + prefers-reduced-motion:no-preference の複合ガード", () => {
    expect(sig).toContain(
      "@media (pointer: fine) and (prefers-reduced-motion: no-preference)",
    );
  });
});

describe("motion: scroll-texture (M3) 正典パラメータ (animation-range)", () => {
  const st = section(globalsCss, "scroll-texture");

  it.each([
    ["kt-sd-rule (罫線)", "animation-range: entry 0% entry 62%"],
    ["kt-sd-title (タイトルパララックス)", "animation-range: entry 0% entry 55%"],
    ["kt-sd-photo (写真せり上がり)", "animation-range: entry 0% entry 45%"],
    ["kt-sd-swatch (色板塗り登場)", "animation-range: entry 6% entry 60%"],
  ])("%s の animation-range が正典と一致", (_label, literal) => {
    expect(st).toContain(literal);
  });

  it("G7 全種が @supports(animation-timeline:view()) の no-preference 内にある", () => {
    expect(st).toContain("@supports (animation-timeline: view())");
    expect(st).toContain("@media (prefers-reduced-motion: no-preference)");
  });

  it("print ガードから page-colors/page-rest 所有クラスを除去済み (移管ずみ)", () => {
    const printBlockStart = st.indexOf("@media print {");
    const printBlock = st.slice(printBlockStart, printBlockStart + 300);
    expect(printBlock).not.toContain(".kt-color-entry");
    expect(printBlock).not.toContain(".kt-sd-qty");
  });

  it("G7-5/G7-6 (colors 透かし番号 / qty バー) を自区画から除外している", () => {
    expect(st).not.toContain(".kt-colors-sec");
    expect(st).not.toMatch(/\.kt-sd-qty\s*{/);
    expect(st).not.toContain("kt-qty-grow");
  });
});

describe("motion: page-colors (M4) 正典パラメータ + 採用EXTRA", () => {
  const pc = section(globalsCss, "page-colors");

  it("透かし番号パララックスの animation-range は cover (全区間)", () => {
    expect(pc).toContain("animation-range: cover");
  });

  it("チルト係数 (rx=6deg/ry=7deg) が tilt-math.ts 側の正典と対応する", () => {
    // CSS 側はカスタムプロパティ (--rx/--ry) を perspective/rotate に適用するだけで
    // 係数そのものは JS 側 (tilt-math.ts) が正典。ここでは配線を確認する。
    expect(pc).toContain("rotateX(var(--rx, 0deg))");
    expect(pc).toContain("rotateY(var(--ry, 0deg))");
  });

  it("チルト reset は 0.45s var(--ease)", () => {
    expect(pc).toContain("transform 0.45s var(--ease)");
  });

  it("EXTRA① 色見本連動: stroke color-mix 13% + var(--wm) フォールバック", () => {
    expect(pc).toContain(
      "-webkit-text-stroke: 1px color-mix(in oklab, var(--wm, #17191b) 13%, transparent)",
    );
  });

  it("EXTRA② グレア色温度連動: color-mix(in oklab, #fff 78%, var(--dd-a))", () => {
    expect(pc).toContain("color-mix(in oklab, #fff 78%, var(--dd-a, #fff))");
  });

  it("EXTRA③ hover 滲み: rgba(168, 15, 34, 0.28) 0.45s / hover+pointer:fine ガード", () => {
    expect(pc).toContain("rgba(168, 15, 34, 0.28)");
    expect(pc).toContain("@media (hover: hover) and (pointer: fine)");
  });

  it("colors/page-body.tsx が --wm と DD-090 淡色フォールバックを配線している", () => {
    const src = readSrc("src/app/(site)/colors/page-body.tsx");
    expect(src).toContain('"--wm"');
    expect(src).toContain("c-090");
  });
});

describe("motion: page-story-process (M4) 正典パラメータ + 採用EXTRA", () => {
  const sp = section(globalsCss, "page-story-process");

  it("ドロップキャップの乾着は 0.6s var(--ease) (primer→carbon)", () => {
    expect(sp).toContain("transition: color 0.6s var(--ease)");
  });

  it("process 工程番号 hover は 0.3s var(--ease) (正典即時塗り)", () => {
    expect(sp).toContain("-webkit-text-stroke-color 0.3s var(--ease)");
  });

  it("-webkit-text-stroke 非対応フォールバックを持つ (§1.5 の内容性数字ルール)", () => {
    expect(sp).toContain("@supports not (-webkit-text-stroke: 1px #000)");
  });

  it("章見出し sticky は 900px 以上限定・top:100px", () => {
    expect(sp).toContain("@media (min-width: 900px)");
    expect(sp).toContain("top: 100px");
  });
});

describe("motion: page-rest (M4) 正典パラメータ + 採用EXTRA", () => {
  const pr = section(globalsCss, "page-rest");

  it("qty バーの animation-range は entry 10%-70% (正典)", () => {
    expect(pr).toContain("animation-range: entry 10% entry 70%");
  });

  it("qty バーは @supports(animation-timeline:view()) + print ガードを持つ", () => {
    expect(pr).toContain("@supports (animation-timeline: view())");
    const printIdx = pr.indexOf("@media print {");
    expect(printIdx).toBeGreaterThan(-1);
    expect(pr.slice(printIdx, printIdx + 200)).toContain(".kt-qty-fill");
  });

  it("検品スタンプの 0.06s stagger が 8 件分ある (EXTRA)", () => {
    for (const n of [0, 0.06, 0.12, 0.18, 0.24, 0.3, 0.36, 0.42]) {
      expect(pr).toContain(`transition-delay: ${n}s`);
    }
  });

  it("前後記事ナビの塗り下線は G4 正典 (0.35s) を流用", () => {
    expect(pr).toContain("transition: transform 0.35s var(--ease)");
  });

  it("全称ブランケットを自区画で再定義していない (M1 単独所有・§2-8)", () => {
    expect(pr).not.toMatch(/\*,\s*\n\s*\*::before,\s*\n\s*\*::after\s*{/);
  });

  it("service/page-body.tsx が page-rest の qty クラスを使い、kt-sd-qty は使わない", () => {
    const src = readSrc("src/app/(site)/service/page-body.tsx");
    expect(src).toContain("kt-qty-track");
    expect(src).toContain("kt-qty-fill");
    expect(src).not.toContain("kt-sd-qty");
  });

  it("(editor)/edit/page-map.tsx が notes-detail で nav 付き NoteDetailPageBody を描画する (§2-10)", () => {
    const src = readSrc("src/app/(editor)/edit/page-map.tsx");
    expect(src).toContain("buildNoteNav");
    expect(src).toMatch(/NoteDetailPageBody[\s\S]{0,80}nav={?nav}?/);
  });
});

describe("motion: z-index 階層表 (計画 §1.1) の全数突合", () => {
  it("カーソルは 9999/9998 (最上位)", () => {
    expect(globalsCss).toContain("z-index: 9999");
    expect(globalsCss).toContain("z-index: 9998");
  });

  it("セクションインジケータは z:60", () => {
    const sig = section(globalsCss, "signature");
    expect(sig).toContain("z-index: 60");
  });

  it("紙ノイズは z:-1 (背景レイヤ)", () => {
    const st = section(globalsCss, "scroll-texture");
    expect(st).toContain("z-index: -1");
  });

  it("50-60 帯 (Sheet/Dialog 予約帯) に新規オーバーレイの z-index が無い", () => {
    // 計画 §1.1: 0〜1 はページ内局所 stacking (グローバル階層に不参加) として許容。
    // 50=ヘッダー/60=インジケータの間 (51-59) への新規追加のみを禁止対象とする。
    const forbidden = [...globalsCss.matchAll(/z-index:\s*(-?\d+)/g)]
      .map((m) => Number(m[1]))
      .filter((z) => z > 50 && z < 60);
    expect(forbidden).toEqual([]);
  });
});
