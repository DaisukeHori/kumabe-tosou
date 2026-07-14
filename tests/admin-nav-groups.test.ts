import { describe, expect, it } from "vitest";

import { ADMIN_NAV_GROUPS, ADMIN_NAV_ITEMS } from "@/app/admin/nav-items";

/**
 * #94: 管理画面左ナビのグルーピング化。
 * URL ルーティング変更なし (従来のフラット 18 項目からの回帰を防ぐ)。
 */
const LEGACY_HREFS = [
  "/admin",
  "/admin/customers",
  "/admin/deals",
  "/admin/tasks",
  "/admin/documents",
  "/admin/calendar",
  "/admin/calls",
  "/admin/works",
  "/admin/posts",
  "/admin/voices",
  "/admin/prices",
  "/admin/media",
  "/admin/visual",
  "/admin/inquiries",
  "/admin/studio",
  "/admin/channels",
  "/admin/costs",
  "/admin/settings",
] as const;

describe("ADMIN_NAV_GROUPS", () => {
  it("flatten した href 集合が従来18ルートと完全一致し、重複がない", () => {
    const hrefs = ADMIN_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs).toHaveLength(18);
    expect(new Set(hrefs).size).toBe(18);
    expect(new Set(hrefs)).toEqual(new Set(LEGACY_HREFS));
  });

  it("ADMIN_NAV_ITEMS (後方互換 derived export) が ADMIN_NAV_GROUPS の flatten と一致する", () => {
    expect(ADMIN_NAV_ITEMS).toEqual(ADMIN_NAV_GROUPS.flatMap((group) => group.items));
    expect(ADMIN_NAV_ITEMS).toHaveLength(18);
  });

  it("各項目がちょうど1グループに属する (重複なし)", () => {
    const counts = new Map<string, number>();
    for (const group of ADMIN_NAV_GROUPS) {
      for (const item of group.items) {
        counts.set(item.href, (counts.get(item.href) ?? 0) + 1);
      }
    }
    for (const href of LEGACY_HREFS) {
      expect(counts.get(href)).toBe(1);
    }
  });

  it("グループ id が一意", () => {
    const ids = ADMIN_NAV_GROUPS.map((group) => group.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("label: null はダッシュボードグループのみ", () => {
    const nullLabelGroups = ADMIN_NAV_GROUPS.filter((group) => group.label === null);
    expect(nullLabelGroups).toHaveLength(1);
    expect(nullLabelGroups[0]?.items.map((item) => item.href)).toEqual(["/admin"]);
  });
});
