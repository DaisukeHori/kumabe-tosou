import { describe, expect, it } from "vitest";

import { isCurrentPath } from "@/components/motion/path-current";

describe("isCurrentPath", () => {
  it("ルートは完全一致のみ", () => {
    expect(isCurrentPath("/", "/")).toBe(true);
    expect(isCurrentPath("/story", "/")).toBe(false);
  });
  it("完全一致で現在地", () => {
    expect(isCurrentPath("/works", "/works")).toBe(true);
    expect(isCurrentPath("/colors", "/colors")).toBe(true);
  });
  it("配下ページも現在地 (works/notes の詳細)", () => {
    expect(isCurrentPath("/works/some-slug", "/works")).toBe(true);
    expect(isCurrentPath("/notes/2026-01", "/notes")).toBe(true);
  });
  it("前方一致の誤検知をしない", () => {
    expect(isCurrentPath("/shopping", "/shop")).toBe(false);
    expect(isCurrentPath("/notes-archive", "/notes")).toBe(false);
  });
  it("trailing slash を正規化", () => {
    expect(isCurrentPath("/works/", "/works")).toBe(true);
  });
  it("非該当", () => {
    expect(isCurrentPath("/about", "/story")).toBe(false);
  });
});
