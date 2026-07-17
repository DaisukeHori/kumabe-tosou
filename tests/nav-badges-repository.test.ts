import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  countDueOrOverdueTasks,
  countReviewCalls,
  countUnhandledInquiries,
  jstTodayDateOnly,
} from "@/modules/nav-badges/repository";

/**
 * canonical: docs/design/admin-redesign/移行設計.md §4 (P6 6c)・§6 / GitHub Issue #129。
 * nav-badges/repository の count クエリが
 *  (a) 正しいテーブル・フィルタで DB 側 count (head:true, count:"exact") を発行すること
 *      (= バッジ件数が既存の各所有モジュール集計と 1:1 で一致する条件になっていること)
 *  (b) DB エラーを握り潰さず KMB-E001 (0xx 横断集計帯) で Result 伝播すること
 *  (c) やること count が「期限超過 + 本日期限」= due_on <= JST今日 で絞ること (JST 境界)
 * を検証する (実 Postgres 未接続。ai-providers-repository.test.ts の fake client 手法を踏襲)。
 */

class FakeCountChain implements PromiseLike<{ count: number | null; error: unknown }> {
  selectArgs: [string, unknown] | null = null;
  eqCalls: [string, unknown][] = [];
  lteCalls: [string, unknown][] = [];
  constructor(
    readonly table: string,
    private readonly response: { count: number | null; error: unknown },
  ) {}
  select(col: string, opts?: unknown): this {
    this.selectArgs = [col, opts];
    return this;
  }
  eq(col: string, value: unknown): this {
    this.eqCalls.push([col, value]);
    return this;
  }
  lte(col: string, value: unknown): this {
    this.lteCalls.push([col, value]);
    return this;
  }
  then<TResult1 = { count: number | null; error: unknown }, TResult2 = never>(
    onfulfilled?:
      | ((value: { count: number | null; error: unknown }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.response).then(onfulfilled, onrejected);
  }
}

function makeClient(response: { count: number | null; error: unknown }) {
  const chains: FakeCountChain[] = [];
  const client = {
    from(table: string) {
      const chain = new FakeCountChain(table, response);
      chains.push(chain);
      return chain;
    },
  } as unknown as SupabaseClient;
  return { client, chains };
}

describe("nav-badges repository — count クエリ規約", () => {
  it("countUnhandledInquiries: contact_inquiries を status='new' で count (head:true, exact)", async () => {
    const { client, chains } = makeClient({ count: 7, error: null });

    const result = await countUnhandledInquiries(client);

    expect(result).toEqual({ ok: true, value: 7 });
    expect(chains).toHaveLength(1);
    expect(chains[0]?.table).toBe("contact_inquiries");
    expect(chains[0]?.selectArgs).toEqual(["id", { count: "exact", head: true }]);
    expect(chains[0]?.eqCalls).toEqual([["status", "new"]]);
    expect(chains[0]?.lteCalls).toEqual([]);
  });

  it("countReviewCalls: calls を match_status='ambiguous' で count", async () => {
    const { client, chains } = makeClient({ count: 2, error: null });

    const result = await countReviewCalls(client);

    expect(result).toEqual({ ok: true, value: 2 });
    expect(chains[0]?.table).toBe("calls");
    expect(chains[0]?.selectArgs).toEqual(["id", { count: "exact", head: true }]);
    expect(chains[0]?.eqCalls).toEqual([["match_status", "ambiguous"]]);
  });

  it("countDueOrOverdueTasks: tasks を status='open' かつ due_on <= JST今日 で count (期限超過+本日期限)", async () => {
    const { client, chains } = makeClient({ count: 4, error: null });
    // JST 境界確認: 2026-07-16T15:30:00Z (+9h = 2026-07-17T00:30 JST) → 今日 = 2026-07-17
    const now = new Date("2026-07-16T15:30:00.000Z");

    const result = await countDueOrOverdueTasks(client, now);

    expect(result).toEqual({ ok: true, value: 4 });
    expect(chains[0]?.table).toBe("tasks");
    expect(chains[0]?.selectArgs).toEqual(["id", { count: "exact", head: true }]);
    expect(chains[0]?.eqCalls).toEqual([["status", "open"]]);
    expect(chains[0]?.lteCalls).toEqual([["due_on", "2026-07-17"]]);
  });

  it("count が null (0 件相当) の場合は 0 に正規化する", async () => {
    const { client } = makeClient({ count: null, error: null });
    const result = await countUnhandledInquiries(client);
    expect(result).toEqual({ ok: true, value: 0 });
  });

  it("DB エラーは握り潰さず KMB-E001 (0xx 横断集計帯) で Result 伝播する", async () => {
    const { client } = makeClient({ count: null, error: { message: "db down" } });

    const result = await countReviewCalls(client);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("KMB-E001");
    expect(result.detail).toContain("db down");
  });
});

describe("nav-badges repository — jstTodayDateOnly (JST 日付境界)", () => {
  it("UTC 15:00 以降は JST 翌日になる (+9h シフト)", () => {
    expect(jstTodayDateOnly(new Date("2026-07-16T15:00:00.000Z"))).toBe("2026-07-17");
    expect(jstTodayDateOnly(new Date("2026-07-16T14:59:59.000Z"))).toBe("2026-07-16");
  });
});
