import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * hover-suite (M2) 実装のソースガードテスト。
 * canonical: docs/design/motion-specs/hover-suite.md §6.1 /
 * docs/design/motion-implementation-plan.md §3-2。
 * DOM/CSSOM を組み立てず、ソースを fs で読んで正典パラメータ・配線を grep 検証する
 * (M2 方式。jsdom 偽陽性を避けるため hover/reduce の実挙動は実機 E2E に委ねる)。
 */

function readSrc(relPath: string): string {
  return readFileSync(path.resolve(__dirname, "..", relPath), "utf-8");
}

function listFilesRecursive(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...listFilesRecursive(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

const globalsCss = readSrc("src/app/globals.css");

describe("motion: hover-suite globals.css", () => {
  it("班区画マーカーが存在する", () => {
    expect(globalsCss).toContain("=== motion: hover-suite ===");
    expect(globalsCss).toContain("=== /motion: hover-suite ===");
  });

  it.each([
    "translateX(-104%) skewX(-14deg)",
    "transform 0.42s",
    "0.38s",
    "translateX(-16px)",
    "translateX(-13px)",
    "grayscale(0.9)",
    "filter 0.7s",
    "transform 1s",
    "scale(1.04)",
    "background-size 1.1s",
    "translateY(-6px)",
    "0 18px 40px -22px",
    "kt-vt-out 0.28s",
    "kt-vt-in 0.44s",
    "scroll-behavior: smooth",
  ])("正典値 %s を含む", (literal) => {
    expect(globalsCss).toContain(literal);
  });

  it("順序ガード (B3/G13 回帰防止): smooth の出現位置より後に reduce ブロックの auto が存在する", () => {
    const smoothIndex = globalsCss.indexOf("scroll-behavior: smooth");
    const lastAutoIndex = globalsCss.lastIndexOf("scroll-behavior: auto");
    expect(smoothIndex).toBeGreaterThan(-1);
    expect(lastAutoIndex).toBeGreaterThan(smoothIndex);
  });

  it("hover-suite 区画内に prefers-reduced-motion: reduce の一括キルスイッチを持つ", () => {
    const start = globalsCss.indexOf("=== motion: hover-suite ===");
    const end = globalsCss.indexOf("=== /motion: hover-suite ===");
    const section = globalsCss.slice(start, end);
    expect(section).toContain("@media (prefers-reduced-motion: reduce)");
    expect(section).toContain(".kt-btn-brush");
    expect(section).toContain(".kt-photo-img");
    expect(section).toContain(".kt-footer-giant");
    expect(section).toContain(".kt-card-lift");
  });
});

describe("motion: hover-suite 配線 (CSS⇔TSX 対)", () => {
  it("slot-image.tsx と media-cover.tsx が kt-photo-img を含む", () => {
    expect(readSrc("src/components/site/slot-image.tsx")).toContain("kt-photo-img");
    expect(readSrc("src/components/site/media-cover.tsx")).toContain("kt-photo-img");
  });

  it("page-blocks.tsx の ArrowButton・CtaBand が kt-btn-brush を含む", () => {
    const src = readSrc("src/components/site/page-blocks.tsx");
    expect(src).toContain("kt-btn-brush");
    expect(src).toContain("kt-btn-brush--soul");
  });

  it("site-footer.tsx が kt-footer-giant を含む", () => {
    expect(readSrc("src/components/site/site-footer.tsx")).toContain("kt-footer-giant");
  });

  it("works・voices の page-body.tsx が Reveal を import している", () => {
    expect(readSrc("src/app/(site)/works/page-body.tsx")).toContain(
      '@/components/site/reveal',
    );
    expect(readSrc("src/app/(site)/voices/page-body.tsx")).toContain(
      '@/components/site/reveal',
    );
  });

  it("colors/page-body.tsx が kt-swatch-host を含む", () => {
    expect(readSrc("src/app/(site)/colors/page-body.tsx")).toContain("kt-swatch-host");
  });

  it("(site)/layout.tsx が PageTransition を含み、(editor)/layout.tsx は含まない", () => {
    expect(readSrc("src/app/(site)/layout.tsx")).toContain("PageTransition");
    expect(readSrc("src/app/(editor)/layout.tsx")).not.toContain("PageTransition");
  });

  it("/admin に kt-btn-brush が漏れていない (git grep kt-btn-brush src/app/admin 相当)", () => {
    const adminDir = path.resolve(__dirname, "..", "src/app/admin");
    const files = listFilesRecursive(adminDir).filter(
      (f) => f.endsWith(".ts") || f.endsWith(".tsx"),
    );
    const offenders = files.filter((f) => readFileSync(f, "utf-8").includes("kt-btn-brush"));
    expect(offenders).toEqual([]);
  });
});

describe("motion: page-transition.tsx", () => {
  const src = readSrc("src/components/motion/page-transition.tsx");

  it('"use client" で始まる', () => {
    expect(src.trimStart().startsWith('"use client";')).toBe(true);
  });

  it("prefers-reduced-motion の matchMedia ガードを含む", () => {
    expect(src).toContain('window.matchMedia("(prefers-reduced-motion: reduce)")');
  });

  it("正典値 440 / cubic-bezier(0.22, 1, 0.36, 1) を含む", () => {
    expect(src).toContain("440");
    expect(src).toContain("cubic-bezier(0.22, 1, 0.36, 1)");
  });
});
