import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  EDITABLE_ROUTES,
  REGISTRY_HASH,
  SLOT_REGISTRY,
  isValidSlotKey,
  slotsForRoute,
} from "@/modules/page-media/registry";
import { zSetSlotReq } from "@/modules/page-media/contracts";

/**
 * canonical: docs/design/visual-media-editor.md §3 (レジストリ) / §5.3a (EDITABLE_ROUTES) / §8。
 */

describe("SLOT_REGISTRY", () => {
  it("slot_key は一意である", () => {
    const keys = SLOT_REGISTRY.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  /**
   * 設計書 §1/§3 は「41 既存写真 + 4 未来枠 = 45」と記載しているが、実際に (site) の
   * 各 page.tsx を Read して転記した結果、既存の固定画像は 40 枚 (§0.2 の「固定パス 40 箇所」
   * とも一致) しか存在しない。実ページに無い 41 枚目を発明しないため、本実装は
   * 40 既存 + 4 未来枠 = 44 で確定している (registry.ts 冒頭コメント参照)。
   */
  it("実測 44 件 (40 既存 + 4 未来枠)", () => {
    expect(SLOT_REGISTRY.length).toBe(44);
  });

  it("route はすべて非空文字列で、EDITABLE_ROUTES に含まれる", () => {
    for (const slot of SLOT_REGISTRY) {
      expect(slot.route.length).toBeGreaterThan(0);
      expect(EDITABLE_ROUTES).toContain(slot.route);
    }
  });

  it("route ごとの件数を合計すると 44 になる (slotsForRoute が全域を重複無く被覆する)", () => {
    const routes = Array.from(new Set(SLOT_REGISTRY.map((s) => s.route)));
    const total = routes.reduce((sum, route) => sum + slotsForRoute(route).length, 0);
    expect(total).toBe(SLOT_REGISTRY.length);
    expect(total).toBe(44);
  });

  it("home.hero のみ priority=true", () => {
    const priorityKeys = SLOT_REGISTRY.filter((s) => s.priority).map((s) => s.key);
    expect(priorityKeys).toEqual(["home.hero"]);
  });

  it("未来枠 (story.portrait / shop.product.1-3) は defaultSrc=null", () => {
    const futureKeys = ["story.portrait", "shop.product.1", "shop.product.2", "shop.product.3"];
    for (const key of futureKeys) {
      const slot = SLOT_REGISTRY.find((s) => s.key === key);
      expect(slot).toBeDefined();
      expect(slot?.defaultSrc).toBeNull();
    }
  });

  it("未来枠以外は defaultSrc が非 null (既存写真は必ず default を持つ)", () => {
    const futureKeys = new Set(["story.portrait", "shop.product.1", "shop.product.2", "shop.product.3"]);
    for (const slot of SLOT_REGISTRY) {
      if (futureKeys.has(slot.key)) continue;
      expect(slot.defaultSrc).not.toBeNull();
    }
  });
});

describe("isValidSlotKey / slotsForRoute", () => {
  it("isValidSlotKey: registry に存在するキーのみ true", () => {
    expect(isValidSlotKey("home.hero")).toBe(true);
    expect(isValidSlotKey("home.nonexistent")).toBe(false);
  });

  it("slotsForRoute: 指定した route のスロットのみ返す", () => {
    const homeSlots = slotsForRoute("/");
    expect(homeSlots.length).toBeGreaterThan(0);
    expect(homeSlots.every((s) => s.route === "/")).toBe(true);

    const shopSlots = slotsForRoute("/shop");
    expect(shopSlots.map((s) => s.key)).toContain("shop.product.1");
  });

  it("slotsForRoute: 未知の route は空配列", () => {
    expect(slotsForRoute("/nonexistent")).toEqual([]);
  });
});

describe("EDITABLE_ROUTES (§5.3a)", () => {
  it("コンテンツ画像専用の一覧ページを含む", () => {
    expect(EDITABLE_ROUTES).toContain("/works");
    expect(EDITABLE_ROUTES).toContain("/voices");
    expect(EDITABLE_ROUTES).toContain("/notes");
    expect(EDITABLE_ROUTES).toContain("/blog");
  });

  it("動的 detail パターンを含む", () => {
    expect(EDITABLE_ROUTES).toContain("works/[slug]");
    expect(EDITABLE_ROUTES).toContain("notes/[slug]");
    expect(EDITABLE_ROUTES).toContain("blog/[slug]");
  });
});

describe("REGISTRY_HASH (BLOCKER-v1.4: unstable_cache の keyParts 用)", () => {
  it("SLOT_REGISTRY の JSON 内容を sha1 したものと一致する (build 時計算の再現性)", () => {
    const recomputed = createHash("sha1").update(JSON.stringify(SLOT_REGISTRY)).digest("hex");
    expect(REGISTRY_HASH).toBe(recomputed);
  });

  it("registry の内容が変われば、2 つの入力に対するハッシュは異なる", () => {
    const a = createHash("sha1").update(JSON.stringify(SLOT_REGISTRY)).digest("hex");
    const mutated = SLOT_REGISTRY.map((s, i) =>
      i === 0 ? { ...s, label: `${s.label} (mutated for test)` } : s,
    );
    const b = createHash("sha1").update(JSON.stringify(mutated)).digest("hex");
    expect(a).not.toBe(b);
  });
});

describe("zSetSlotReq: slot_key は registry キーに限定する", () => {
  it("registry に存在する slot_key は許可される", () => {
    const result = zSetSlotReq.safeParse({
      slot_key: "home.hero",
      media_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.success).toBe(true);
  });

  it("registry に存在しない slot_key は拒否される (KMB-E107 相当)", () => {
    const result = zSetSlotReq.safeParse({ slot_key: "home.nonexistent", media_id: null });
    expect(result.success).toBe(false);
  });

  it("media_id は null を許可する (既定に戻す)", () => {
    const result = zSetSlotReq.safeParse({ slot_key: "home.hero", media_id: null });
    expect(result.success).toBe(true);
  });
});
