import { describe, expect, it } from "vitest";

import { EDITABLE_ROUTES } from "@/modules/page-media/registry";

import { matchEditRoute } from "../src/app/(editor)/edit/route-match";

/**
 * canonical: docs/design/visual-media-editor.md §5.3a / §8。
 *
 * EDITABLE_ROUTES (page-media/registry.ts) の全量が page-map (matchEditRoute) で
 * 解決できることを保証する (MAJOR-v1.4: SLOT_REGISTRY の route だけでは
 * コンテンツ専用ページ (/works /voices /notes /blog) と動的 detail パターンを
 * 取りこぼすため、EDITABLE_ROUTES の全量を対象にする)。
 *
 * matchEditRoute() は DB アクセスを行わない純粋関数のため、モック無しで直接テストできる。
 */

/** EDITABLE_ROUTES の route 文字列 (leading slash 付き static / no-slash dynamic pattern の
 *  両方が混在する、registry.ts の実際のフォーマット) を、/edit/[[...path]] の
 *  catch-all セグメント配列に変換する。 */
function routeToPathSegments(route: string): string[] {
  if (route === "/") return [];
  if (route.endsWith("/[slug]")) {
    const base = route.replace(/\/\[slug\]$/, "");
    return [base, "sample-slug"];
  }
  return route.replace(/^\//, "").split("/").filter(Boolean);
}

describe("matchEditRoute: EDITABLE_ROUTES 全量が解決できる (§5.3a)", () => {
  it("EDITABLE_ROUTES は非空である (回帰防止)", () => {
    expect(EDITABLE_ROUTES.length).toBeGreaterThan(0);
  });

  for (const route of EDITABLE_ROUTES) {
    it(`route "${route}" が matchEditRoute で解決できる`, () => {
      const segs = routeToPathSegments(route);
      const match = matchEditRoute(segs);
      expect(match).not.toBeNull();
    });
  }
});

describe("matchEditRoute: 個別パターン", () => {
  it("[] (トップ) は slot-page / page=''", () => {
    expect(matchEditRoute([])).toEqual({ kind: "slot-page", page: "" });
  });

  it("undefined (パスセグメント無し) も [] と同じ扱い", () => {
    expect(matchEditRoute(undefined)).toEqual({ kind: "slot-page", page: "" });
  });

  it("['about'] は slot-page / page='about'", () => {
    expect(matchEditRoute(["about"])).toEqual({ kind: "slot-page", page: "about" });
  });

  it("['works'] は works-list", () => {
    expect(matchEditRoute(["works"])).toEqual({ kind: "works-list" });
  });

  it("['works', 'my-slug'] は works-detail / slug='my-slug'", () => {
    expect(matchEditRoute(["works", "my-slug"])).toEqual({
      kind: "works-detail",
      slug: "my-slug",
    });
  });

  it("['notes', 'my-slug'] は notes-detail", () => {
    expect(matchEditRoute(["notes", "my-slug"])).toEqual({
      kind: "notes-detail",
      slug: "my-slug",
    });
  });

  it("['blog', 'my-slug'] は blog-detail", () => {
    expect(matchEditRoute(["blog", "my-slug"])).toEqual({
      kind: "blog-detail",
      slug: "my-slug",
    });
  });

  it("registry に無い未知の 1 セグメントパスは null (notFound 相当)", () => {
    expect(matchEditRoute(["nonexistent"])).toBeNull();
  });

  it("privacy / tokushoho は EDITABLE_ROUTES に含まれず、page-map でも null", () => {
    expect(EDITABLE_ROUTES).not.toContain("/privacy");
    expect(EDITABLE_ROUTES).not.toContain("/tokushoho");
    expect(matchEditRoute(["privacy"])).toBeNull();
    expect(matchEditRoute(["tokushoho"])).toBeNull();
  });

  it("3 セグメント以上のパスは null", () => {
    expect(matchEditRoute(["works", "my-slug", "extra"])).toBeNull();
  });

  it("動的パターンで prefix が works/notes/blog 以外なら null", () => {
    expect(matchEditRoute(["about", "extra"])).toBeNull();
  });
});

describe("matchEditRoute: エッジケース (V2a 独立検証で追加)", () => {
  it("スラッシュ連打によって生じる空セグメントは既知パスに解決しない", () => {
    // /edit//about のような URL が万一空セグメントとして渡っても、
    // "" は SLOT_PAGE_SEGMENTS にも STATIC_LIST_KIND にも一致せず null になる
    // ([] とは異なり長さ 1 のため "トップ" にもフォールバックしない)。
    expect(matchEditRoute([""])).toBeNull();
    expect(matchEditRoute(["", "about"])).toBeNull();
    expect(matchEditRoute(["about", ""])).toBeNull();
  });

  it("動的 detail パターンで slug が空文字は null (works/ 直後のスラッシュ連打)", () => {
    expect(matchEditRoute(["works", ""])).toBeNull();
    expect(matchEditRoute(["notes", ""])).toBeNull();
    expect(matchEditRoute(["blog", ""])).toBeNull();
  });

  it("深すぎるパス (4 セグメント以上) も null", () => {
    expect(matchEditRoute(["works", "my-slug", "extra", "more"])).toBeNull();
    expect(matchEditRoute(["a", "b", "c", "d", "e"])).toBeNull();
  });

  it("registry に無い未知の 2 セグメントパスも null", () => {
    expect(matchEditRoute(["unknown", "path"])).toBeNull();
  });
});
