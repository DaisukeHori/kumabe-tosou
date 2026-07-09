import { describe, expect, it } from "vitest";

import { buildNoteNav, formatNoteNo, noteNumberOf } from "@/app/_lib/note-nav";
import type { PublicPostListItem } from "@/app/_lib/public-content";

/**
 * canonical: docs/design/motion-specs/page-rest.md §6-2。
 * 統合計画 §1.7 / §2 #9 によりテストは tests/ 直下に配置 (vitest include: tests/**\/*.test.ts)。
 */

const post = (slug: string): PublicPostListItem => ({
  id: slug,
  slug,
  kind: "reading",
  title: `title-${slug}`,
  excerpt: "",
  cover: null,
  publishedAt: "2026-01-01T00:00:00Z",
});

// published_at 降順 = 新しい順 (note-03 が最新)
const posts = [post("note-03"), post("note-02"), post("note-01")];

describe("noteNumberOf", () => {
  it("最古の記事が NOTE 01 になる", () => {
    expect(noteNumberOf(posts, 2)).toBe(1);
    expect(noteNumberOf(posts, 0)).toBe(3);
  });
});

describe("formatNoteNo", () => {
  it("2 桁ゼロ詰め", () => {
    expect(formatNoteNo(1)).toBe("NOTE 01");
    expect(formatNoteNo(12)).toBe("NOTE 12");
  });
});

describe("buildNoteNav", () => {
  it("中間記事: prev=古い方 / next=新しい方", () => {
    const nav = buildNoteNav(posts, "note-02");
    expect(nav.noteNo).toBe(2);
    expect(nav.prev?.slug).toBe("note-01");
    expect(nav.next?.slug).toBe("note-03");
  });
  it("最新記事は next なし、最古記事は prev なし", () => {
    expect(buildNoteNav(posts, "note-03").next).toBeNull();
    expect(buildNoteNav(posts, "note-01").prev).toBeNull();
  });
  it("未知 slug は全て null", () => {
    expect(buildNoteNav(posts, "nope")).toEqual({
      noteNo: null,
      prev: null,
      next: null,
    });
  });
});
