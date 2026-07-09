import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/visual-text-editor.md §3 (resolver 契約) / §4.2 (不変条件:
 * page_text が空なら公開ページは現行と 1 文字も変わらない) / §8。
 *
 * page_text への実 DB アクセスをスタブし、resolver (facade.resolveAllTextsFresh /
 * resolveAllTexts) の組み立てロジックのみを検証する
 * (tests/page-media-resolver.test.ts の vi.mock 方式に倣う)。
 */

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    NEXT_PUBLIC_SUPABASE_URL: "https://example-project.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-stub",
  }),
}));

type FakeRow = { slot_key: string; text_override: string };
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
import { TEXT_REGISTRY } from "@/modules/page-media/text-registry";

beforeEach(() => {
  fakeResponse = { data: [], error: null };
});

describe("resolveAllTextsFresh: 行なし = registry の defaultText (§1)", () => {
  it("page_text に行が無いスロットは defaultText / isDefault=true を返す", async () => {
    fakeResponse = { data: [], error: null };
    const result = await pageMediaFacade.resolveAllTextsFresh();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const slot = result.value["home.statement.heading"];
    expect(slot).toEqual({
      text: TEXT_REGISTRY.find((s) => s.key === "home.statement.heading")!.defaultText,
      isDefault: true,
    });
  });

  it("page_text に行があるスロットは text_override / isDefault=false を返す", async () => {
    fakeResponse = {
      data: [{ slot_key: "home.cta.note", text_override: "カスタム文言です。" }],
      error: null,
    };
    const result = await pageMediaFacade.resolveAllTextsFresh();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value["home.cta.note"]).toEqual({
      text: "カスタム文言です。",
      isDefault: false,
    });
  });

  it("SLOT_REGISTRY 全キーが解決結果に含まれる (74 件)", async () => {
    const result = await pageMediaFacade.resolveAllTextsFresh();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value).length).toBe(TEXT_REGISTRY.length);
    for (const slot of TEXT_REGISTRY) {
      expect(result.value[slot.key]).toBeDefined();
    }
  });
});

describe("resolveAllTextsFresh: JSON-safe 不変条件 (Map 混入検知)", () => {
  it("戻り値は plain object (Record) であり、JSON.parse(JSON.stringify(x)) で内容が不変", async () => {
    fakeResponse = {
      data: [{ slot_key: "home.cta.note", text_override: "テスト文言" }],
      error: null,
    };
    const result = await pageMediaFacade.resolveAllTextsFresh();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).not.toBeInstanceOf(Map);
    const roundTripped = JSON.parse(JSON.stringify(result.value));
    expect(roundTripped).toEqual(result.value);
    expect(Object.keys(roundTripped).length).toBe(TEXT_REGISTRY.length);
  });
});

describe("resolveAllTextsFresh: 取得エラー時のフォールバック (§3: 公開ページを落とさない)", () => {
  it("view 取得がエラーの場合、ok:true かつ全 slot が isDefault=true で返る", async () => {
    fakeResponse = { data: null, error: { message: "connection refused (test stub)" } };
    const result = await pageMediaFacade.resolveAllTextsFresh();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(Object.keys(result.value).length).toBe(TEXT_REGISTRY.length);
    for (const slot of TEXT_REGISTRY) {
      expect(result.value[slot.key]).toEqual({ text: slot.defaultText, isDefault: true });
    }
  });
});

describe("resolveAllTexts: 全 slot が TEXT_REGISTRY と 1:1", () => {
  // 注: unstable_cache はプレーン vitest (node) 環境では invariant エラーになり、
  // resolveAllTexts() の catch フォールバック経路を通る (page-media-resolver.test.ts の
  // resolveAll と同じ既知の制約)。本テストは「全 slot キーが揃う」不変条件の確認に限定する。
  it("TEXT_REGISTRY の全キーが解決結果に含まれる", async () => {
    fakeResponse = { data: [], error: null };
    const result = await pageMediaFacade.resolveAllTexts();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const slot of TEXT_REGISTRY) {
      expect(result.value[slot.key]).toBeDefined();
    }
  });
});

describe("§4.2 不変条件: page_text 空の状態で defaultText が現行文言と 1 文字も変わらない", () => {
  it("行が 1 件も無いとき、全スロットの解決結果は registry.defaultText と完全一致する", async () => {
    fakeResponse = { data: [], error: null };
    const result = await pageMediaFacade.resolveAllTextsFresh();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const slot of TEXT_REGISTRY) {
      expect(result.value[slot.key].text).toBe(slot.defaultText);
      expect(result.value[slot.key].isDefault).toBe(true);
    }
  });
});
