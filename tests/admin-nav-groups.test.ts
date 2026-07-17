import { describe, expect, it } from "vitest";

import { ADMIN_NAV_GROUPS, ADMIN_NAV_ITEMS } from "@/app/admin/nav-items";
import { NAV_BADGE_HREFS } from "@/modules/nav-badges/contracts";

/**
 * #94: 管理画面左ナビのグルーピング化。
 * #118 (R1): 「リソース別」→「業務フェーズ別」IA へ再編。**href は不変**で
 * ラベル・グループ・順序・フェーズ番号のみ変更した。
 * #126 (R5): content 系 5 項目 (works/posts/voices/media/visual) を「ホームページ更新」
 * 1 項目 (href=/admin/works) へ統合し、最終形の 6 グループ 14 項目とした。posts/voices/media/
 * visual の 4 ルートはナビ項目からは外れるが、URL 自体は不変で、/admin/works 配下の
 * SiteSecondaryTabs (5 タブ) から到達可能なため、ここで検証する「ナビ項目 href 集合」は 14 になる。
 */
const NAV_HREFS = [
  "/admin",
  "/admin/customers",
  "/admin/deals",
  "/admin/tasks",
  "/admin/documents",
  "/admin/calendar",
  "/admin/calls",
  "/admin/works",
  "/admin/prices",
  "/admin/inquiries",
  "/admin/studio",
  "/admin/channels",
  "/admin/costs",
  "/admin/settings",
] as const;

// #118 (R1) 確定の業務フェーズ別グループ id (順序込み)。
const EXPECTED_GROUP_IDS = [
  "dashboard",
  "create-customers",
  "intake",
  "sales",
  "production",
  "misc",
] as const;

describe("ADMIN_NAV_GROUPS", () => {
  it("flatten した href 集合が最終形14ルートと完全一致し、重複がない (全ナビルート到達可能を維持)", () => {
    const hrefs = ADMIN_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs).toHaveLength(14);
    expect(new Set(hrefs).size).toBe(14);
    expect(new Set(hrefs)).toEqual(new Set(NAV_HREFS));
  });

  it("R5 で統合された content サブルート (posts/voices/media/visual) はナビ項目から外れる (URL は不変・ハブタブから到達)", () => {
    const hrefs = new Set(ADMIN_NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href)));
    for (const merged of ["/admin/posts", "/admin/voices", "/admin/media", "/admin/visual"]) {
      expect(hrefs.has(merged)).toBe(false);
    }
    // ハブの入口 (ホームページ更新) は /admin/works として残る。
    expect(hrefs.has("/admin/works")).toBe(true);
  });

  it("ADMIN_NAV_ITEMS (後方互換 derived export) が ADMIN_NAV_GROUPS の flatten と一致する", () => {
    expect(ADMIN_NAV_ITEMS).toEqual(ADMIN_NAV_GROUPS.flatMap((group) => group.items));
    expect(ADMIN_NAV_ITEMS).toHaveLength(14);
  });

  it("各項目がちょうど1グループに属する (重複なし)", () => {
    const counts = new Map<string, number>();
    for (const group of ADMIN_NAV_GROUPS) {
      for (const item of group.items) {
        counts.set(item.href, (counts.get(item.href) ?? 0) + 1);
      }
    }
    for (const href of NAV_HREFS) {
      expect(counts.get(href)).toBe(1);
    }
  });

  it("グループ id が一意で、業務フェーズ別6グループの構成・順序と一致する", () => {
    const ids = ADMIN_NAV_GROUPS.map((group) => group.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...EXPECTED_GROUP_IDS]);
  });

  it("label: null は今日の仕事 (dashboard) グループのみで、/admin を単独で持つ", () => {
    const nullLabelGroups = ADMIN_NAV_GROUPS.filter((group) => group.label === null);
    expect(nullLabelGroups).toHaveLength(1);
    expect(nullLabelGroups[0]?.id).toBe("dashboard");
    expect(nullLabelGroups[0]?.items.map((item) => item.href)).toEqual(["/admin"]);
  });

  it("フェーズ番号 (①〜④) は受付〜製造・請求の4グループに付与され、単独/その他には無い", () => {
    const phaseById = new Map(ADMIN_NAV_GROUPS.map((group) => [group.id, group.phaseNo]));
    expect(phaseById.get("create-customers")).toBe("①");
    expect(phaseById.get("intake")).toBe("②");
    expect(phaseById.get("sales")).toBe("③");
    expect(phaseById.get("production")).toBe("④");
    expect(phaseById.get("dashboard")).toBeUndefined();
    expect(phaseById.get("misc")).toBeUndefined();
  });

  it("NAV_BADGE_HREFS (#129 バッジ宛先の真実源) の href がすべて実在するナビ項目を指す", () => {
    const navHrefs = new Set(ADMIN_NAV_ITEMS.map((item) => item.href));
    for (const href of Object.values(NAV_BADGE_HREFS)) {
      expect(navHrefs.has(href)).toBe(true);
    }
    // R6c で件数バッジを持つのは 問い合わせ・通話・やること の 3 項目に固定 (真実源の分散を禁止)。
    expect(new Set(Object.values(NAV_BADGE_HREFS))).toEqual(
      new Set(["/admin/inquiries", "/admin/calls", "/admin/tasks"]),
    );
  });

  it("確定済みのラベル改称が nav-items に反映されている (href→label)", () => {
    const labelByHref = new Map(ADMIN_NAV_ITEMS.map((item) => [item.href, item.label]));
    expect(labelByHref.get("/admin")).toBe("今日の仕事");
    expect(labelByHref.get("/admin/documents")).toBe("見積書・請求書");
    // #126 (R5): content 5 項目統合後、/admin/works は「ホームページ更新」ハブの入口ラベルになる。
    expect(labelByHref.get("/admin/works")).toBe("ホームページ更新");
    expect(labelByHref.get("/admin/studio")).toBe("発信スタジオ");
    expect(labelByHref.get("/admin/channels")).toBe("SNSの接続");
    expect(labelByHref.get("/admin/settings")).toBe("設定");
    expect(labelByHref.get("/admin/costs")).toBe("AI利用料金");
  });
});
