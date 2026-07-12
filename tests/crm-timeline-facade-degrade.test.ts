import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/crm-suite/01-crm.md §5.4 (行1071) / §8.5 (行1390)。
 * crmFacade.listTimeline の「行単位フォールバック degrade」を検証する。
 *
 * #44 実装時の是正点: facade.ts の旧実装は payload parse に 1 件でも失敗すると Result 全体を
 * `{ok:false, code:'KMB-E604'}` で失敗させていたが、canonical (上記 2 箇所) は「未知 payload は
 * 行単位で『表示できない記録』にフォールバックし、ページ全体は失敗させない」と明記している。
 * facade.ts はこの矛盾を是正し、parse 失敗行のみ payload=null / payload_error=メッセージで
 * 個別 degrade するよう修正済み (facade.ts listTimeline 実装コメント参照)。本テストはこの
 * 是正内容が壊れないことをロックする回帰テスト。
 *
 * 加えて「エラー握り潰し厳禁」地雷 (全 Issue で繰り返し刺さった最重要地雷) の回帰防止として、
 * DB エラー (getCustomerById / listTimelinePage の Result.ok=false) が listTimeline から
 * そのまま伝播し、空配列や ok:true への無言変換が起きないことも合わせて確認する。
 *
 * getSessionAndClient / crm/repository をモックし実 DB には接続しない
 * (tests/sales-facade.test.ts / tests/scheduling-facade.test.ts と同型パターン踏襲)。
 */

const getSessionAndClientMock = vi.fn();
vi.mock("@/lib/supabase/session", () => ({
  getSessionAndClient: (...args: unknown[]) => getSessionAndClientMock(...args),
}));

const getCustomerByIdMock = vi.fn();
const listTimelinePageMock = vi.fn();

vi.mock("@/modules/crm/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/crm/repository")>();
  return {
    ...actual,
    getCustomerById: (...args: unknown[]) => getCustomerByIdMock(...args),
    listTimelinePage: (...args: unknown[]) => listTimelinePageMock(...args),
  };
});

import { crmFacade } from "@/modules/crm/facade";
import type { ActivityRow } from "@/modules/crm/repository";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";

function activityRow(overrides: Partial<ActivityRow>): ActivityRow {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    activity_type: "note",
    occurred_at: "2026-07-11T00:00:00.000Z",
    title: "メモ",
    body: "本文",
    payload: {},
    ref_table: null,
    ref_id: null,
    created_by: null,
    created_at: "2026-07-11T00:00:00.000Z",
    updated_at: "2026-07-11T00:00:00.000Z",
    ...overrides,
  };
}

describe("crmFacade.listTimeline", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    getSessionAndClientMock.mockResolvedValue({ supabase: {}, user: { id: "user-1" } });
    getCustomerByIdMock.mockResolvedValue({ ok: true, value: { id: CUSTOMER_ID } });
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("payload parse に失敗した行は payload=null/payload_error 付きで個別 degrade され、正常行と併せて全件返る (ページ全体を失敗させない)", async () => {
    listTimelinePageMock.mockResolvedValue({
      ok: true,
      value: {
        items: [
          activityRow({ id: "row-ok", activity_type: "note", payload: {} }),
          activityRow({ id: "row-bad", activity_type: "call", payload: { not: "valid" } }),
        ],
        next_cursor: null,
      },
    });

    const result = await crmFacade.listTimeline({ customer_id: CUSTOMER_ID }, { cursor: null, limit: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.items).toHaveLength(2);

    const ok = result.value.items.find((i) => i.id === "row-ok");
    const bad = result.value.items.find((i) => i.id === "row-bad");
    expect(ok?.payload).toEqual({});
    expect(ok?.payload_error).toBeNull();
    expect(bad?.payload).toBeNull();
    expect(typeof bad?.payload_error).toBe("string");
    expect(bad?.payload_error).not.toBe("");
    // parse失敗はログで可視化される (握り潰さず console.warn — E901系の既存ログ規約踏襲)
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("全行が正常 payload の場合は payload_error が全て null で warn も呼ばれない", async () => {
    listTimelinePageMock.mockResolvedValue({
      ok: true,
      value: { items: [activityRow({ id: "row-1" }), activityRow({ id: "row-2" })], next_cursor: null },
    });

    const result = await crmFacade.listTimeline({ customer_id: CUSTOMER_ID }, { cursor: null, limit: 50 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value.items.every((i) => i.payload_error === null)).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("対象顧客取得の DB エラー (getCustomerById が ok:false) はそのまま Result として伝播する (空配列/ok:true への握り潰し禁止)", async () => {
    getCustomerByIdMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "db down" });
    const result = await crmFacade.listTimeline({ customer_id: CUSTOMER_ID }, { cursor: null, limit: 50 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("KMB-E901");
    expect(listTimelinePageMock).not.toHaveBeenCalled();
  });

  it("対象顧客が存在しない (null) 場合は KMB-E603 を返す", async () => {
    getCustomerByIdMock.mockResolvedValue({ ok: true, value: null });
    const result = await crmFacade.listTimeline({ customer_id: CUSTOMER_ID }, { cursor: null, limit: 50 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("KMB-E603");
  });

  it("listTimelinePage 自体の DB エラーはそのまま Result として伝播する (空配列への握り潰し禁止)", async () => {
    listTimelinePageMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "query failed" });
    const result = await crmFacade.listTimeline({ customer_id: CUSTOMER_ID }, { cursor: null, limit: 50 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("KMB-E901");
  });

  it("不正な target (customer_id が UUID でない) は KMB-E101 を返す", async () => {
    const result = await crmFacade.listTimeline({ customer_id: "not-a-uuid" }, { cursor: null, limit: 50 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("KMB-E101");
    expect(getCustomerByIdMock).not.toHaveBeenCalled();
  });
});
