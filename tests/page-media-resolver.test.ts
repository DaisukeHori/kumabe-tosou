import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/visual-media-editor.md §2.1 (全データパターン) / §2.2 (alt 決定順) /
 * §4.1 (resolver 契約。JSON-safe 不変条件 BLOCKER-v1.4) / §8。
 *
 * page_media_resolved view への実 DB アクセスをスタブし、resolver (facade.resolveAllFresh)
 * の組み立てロジックのみを検証する (public-content-media.test.ts の vi.mock 方式に倣う)。
 */

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: "https://example-project.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-stub",
  }),
}));

type FakeRow = { slot_key: string; media_id: string | null; alt_override: string | null; media_alt: string | null };
type FakeResponse = { data: FakeRow[] | null; error: { message: string } | null };

let fakeResponse: FakeResponse = { data: [], error: null };

vi.mock("@/lib/supabase/public", () => ({
  createSupabasePublicClient: () => ({
    from: () => ({
      select: async () => fakeResponse,
    }),
  }),
}));

import { pageMediaFacade } from "@/modules/page-media/facade";
import { SLOT_REGISTRY } from "@/modules/page-media/registry";

const MEDIA_ID = "11111111-1111-1111-1111-111111111111";
const SUPABASE_URL = "https://example-project.supabase.co";

beforeEach(() => {
  fakeResponse = { data: [], error: null };
});

describe("resolveAllFresh: §2.1 全データパターン", () => {
  it("パターン1 (slot 行なし) は registry の defaultSrc / altDefault を返す (source=default)", async () => {
    fakeResponse = { data: [], error: null };
    const result = await pageMediaFacade.resolveAllFresh();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const slot = result.value["home.craft.1"];
    expect(slot).toEqual({
      src: "/img/sanding.jpg",
      alt: "ベルトサンダーで研磨する手元",
      mediaId: null,
      isDefault: true,
      source: "default",
    });
  });

  it("パターン2 (media_id 設定) は決定論 webp URL を返す (source=page_media, isDefault=false)", async () => {
    fakeResponse = {
      data: [{ slot_key: "home.craft.1", media_id: MEDIA_ID, alt_override: null, media_alt: "新しい写真" }],
      error: null,
    };
    const result = await pageMediaFacade.resolveAllFresh();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const slot = result.value["home.craft.1"];
    expect(slot.mediaId).toBe(MEDIA_ID);
    expect(slot.isDefault).toBe(false);
    expect(slot.source).toBe("page_media");
    expect(slot.src).toBe(`${SUPABASE_URL}/storage/v1/object/public/media/${MEDIA_ID}.webp`);
    expect(slot.alt).toBe("新しい写真");
  });

  it("パターン3 (media_id=null / 行あり) は defaultSrc にフォールバックする (既定に戻す)", async () => {
    fakeResponse = {
      data: [{ slot_key: "home.craft.1", media_id: null, alt_override: "カスタム alt", media_alt: null }],
      error: null,
    };
    const result = await pageMediaFacade.resolveAllFresh();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const slot = result.value["home.craft.1"];
    expect(slot.src).toBe("/img/sanding.jpg");
    expect(slot.mediaId).toBeNull();
    expect(slot.isDefault).toBe(true);
    expect(slot.source).toBe("default");
    // alt_override は media_id=null でも保持される (§2.2 の alt 決定順は media_id と独立)
    expect(slot.alt).toBe("カスタム alt");
  });

  it("パターン5 (未来スロットかつ未設定) はプレースホルダ (src=null)", async () => {
    fakeResponse = { data: [], error: null };
    const result = await pageMediaFacade.resolveAllFresh();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const slot = result.value["story.portrait"];
    expect(slot.src).toBeNull();
    expect(slot.mediaId).toBeNull();
    expect(slot.isDefault).toBe(true);
    expect(slot.source).toBe("placeholder");
  });
});

describe("resolveAllFresh: §2.2 alt 決定順 (alt_override ?? media_alt ?? registry.altDefault)", () => {
  it("1. alt_override が非 null なら最優先される", async () => {
    fakeResponse = {
      data: [
        { slot_key: "home.craft.1", media_id: MEDIA_ID, alt_override: "手動編集した alt", media_alt: "media の alt" },
      ],
      error: null,
    };
    const result = await pageMediaFacade.resolveAllFresh();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value["home.craft.1"].alt).toBe("手動編集した alt");
  });

  it("2. alt_override が null なら media.alt (差し替え後の新画像 alt) を使う", async () => {
    fakeResponse = {
      data: [{ slot_key: "home.craft.1", media_id: MEDIA_ID, alt_override: null, media_alt: "media の alt" }],
      error: null,
    };
    const result = await pageMediaFacade.resolveAllFresh();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value["home.craft.1"].alt).toBe("media の alt");
  });

  it("3. alt_override も media.alt も無ければ registry.altDefault を使う", async () => {
    fakeResponse = { data: [], error: null };
    const result = await pageMediaFacade.resolveAllFresh();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value["home.craft.1"].alt).toBe("ベルトサンダーで研磨する手元");
  });
});

describe("resolveAllFresh: JSON-safe 不変条件 (BLOCKER-v1.4, Map 混入検知)", () => {
  it("戻り値は plain object (Record) であり、JSON.parse(JSON.stringify(x)) で内容が不変", async () => {
    fakeResponse = {
      data: [{ slot_key: "home.craft.1", media_id: MEDIA_ID, alt_override: "alt", media_alt: null }],
      error: null,
    };
    const result = await pageMediaFacade.resolveAllFresh();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).not.toBeInstanceOf(Map);
    const roundTripped = JSON.parse(JSON.stringify(result.value));
    expect(roundTripped).toEqual(result.value);
    // Map は JSON.stringify で {} になる — 万一 Map が混入すればこのラウンドトリップは壊れる。
    expect(Object.keys(roundTripped).length).toBe(SLOT_REGISTRY.length);
  });
});

describe("resolveAllFresh: view エラー時のフォールバック", () => {
  it("view 取得がエラーの場合、ok:true かつ全 slot が isDefault=true で返る (公開ページを落とさない)", async () => {
    fakeResponse = { data: null, error: { message: "connection refused (test stub)" } };
    const result = await pageMediaFacade.resolveAllFresh();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(Object.keys(result.value).length).toBe(SLOT_REGISTRY.length);
    for (const slot of SLOT_REGISTRY) {
      expect(result.value[slot.key].isDefault).toBe(true);
    }
  });
});

describe("resolveAll: 全 slot が SLOT_REGISTRY と 1:1", () => {
  // 注: unstable_cache は Next.js サーバランタイム (incrementalCache) 前提のため、
  // プレーン vitest (node) 環境では内部で invariant エラーになり、resolveAll() の
  // catch フォールバック経路を通る。これは pricing facade の getCachedActivePriceTable
  // 等と同じ既知の制約であり、本テストは「全 slot キーが揃う」不変条件の確認に限定する
  // (キャッシュヒット自体の検証は結合/E2E レイヤの対象、§8)。
  it("SLOT_REGISTRY の全キーが解決結果に含まれる", async () => {
    fakeResponse = { data: [], error: null };
    const result = await pageMediaFacade.resolveAll();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const slot of SLOT_REGISTRY) {
      expect(result.value[slot.key]).toBeDefined();
    }
  });
});
