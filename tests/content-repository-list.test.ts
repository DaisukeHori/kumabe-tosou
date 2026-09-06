import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { listPostsAdmin, listPublishedRows, listWorksAdmin } from "@/modules/content/repository";

/**
 * content repository の一覧クエリ組み立て (canonical: docs/design/cms-ai-pipeline.md §6.1)。
 * content-cas.test.ts と同じフェイククエリビルダ方式で、実 DB に触れずに
 * (1) admin 検索の .or() が ilikeContainsFilter (引用符囲み) で組まれること、
 * (2) 公開一覧 (listPublishedRows) が published_at <= now() を明示すること、
 * (3) admin 一覧では status=published でも published_at 条件を課さないこと、を検証する。
 */

type Call = [string, unknown[]];

class FakeSelectQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  constructor(
    private response: { data: unknown; error: unknown },
    private calls: Call[],
  ) {}
  select(cols?: string): this {
    this.calls.push(["select", [cols]]);
    return this;
  }
  order(col: string, opts?: unknown): this {
    this.calls.push(["order", [col, opts]]);
    return this;
  }
  limit(n: number): this {
    this.calls.push(["limit", [n]]);
    return this;
  }
  eq(col: string, value: unknown): this {
    this.calls.push(["eq", [col, value]]);
    return this;
  }
  lte(col: string, value: unknown): this {
    this.calls.push(["lte", [col, value]]);
    return this;
  }
  or(expr: string): this {
    this.calls.push(["or", [expr]]);
    return this;
  }
  then<TResult1, TResult2>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.response).then(onfulfilled, onrejected);
  }
}

function buildFakeClient(calls: Call[]) {
  const client = {
    from(table: string) {
      calls.push(["from", [table]]);
      return new FakeSelectQuery({ data: [], error: null }, calls);
    },
  };
  return client as unknown as SupabaseClient;
}

function orExprs(calls: Call[]): string[] {
  return calls.filter(([m]) => m === "or").map(([, args]) => args[0] as string);
}

describe("admin 一覧の検索 (.or) は ilikeContainsFilter で組み立てる", () => {
  it("works: title/slug/category の 3 項を引用符囲みで連結する", async () => {
    const calls: Call[] = [];
    await listWorksAdmin(buildFakeClient(calls), { search: "黒", cursor: null, limit: 50 });

    expect(orExprs(calls)).toEqual([
      'title.ilike."%黒%",slug.ilike."%黒%",category.ilike."%黒%"',
    ]);
  });

  it("検索語にカンマ・括弧が含まれてもフィルタ構文を壊さない (値が引用符で囲まれる)", async () => {
    const calls: Call[] = [];
    await listPostsAdmin(buildFakeClient(calls), { search: "a,b(c)", kind: "reading", cursor: null, limit: 50 });

    const [expr] = orExprs(calls);
    expect(expr).toBe('title.ilike."%a,b(c)%",slug.ilike."%a,b(c)%",excerpt.ilike."%a,b(c)%"');
    // 引用符の外に生のカンマ/括弧が出ていない (3 項の区切りカンマのみ)
    const outsideQuotes = expr.replace(/"[^"]*"/g, "");
    expect(outsideQuotes).toBe("title.ilike.,slug.ilike.,excerpt.ilike.");
  });

  it("LIKE のワイルドカード (% _) はエスケープされる", async () => {
    const calls: Call[] = [];
    await listWorksAdmin(buildFakeClient(calls), { search: "50%_x", cursor: null, limit: 50 });

    // escapeLikePattern で `\%` `\_` にした後、quotePostgrestValue が引用符内の `\` を `\\` に重ねる
    expect(orExprs(calls)[0]).toContain('title.ilike."%50\\\\%\\\\_x%"');
  });

  it("検索語が無ければ検索用の .or() は発行しない", async () => {
    const calls: Call[] = [];
    await listWorksAdmin(buildFakeClient(calls), { cursor: null, limit: 50 });

    expect(orExprs(calls)).toEqual([]);
  });
});

describe("公開一覧 (listPublishedRows) は published_at <= now() を明示する", () => {
  it("status=published の eq と published_at の lte (ISO 文字列) を両方課す", async () => {
    const calls: Call[] = [];
    const before = Date.now();
    await listPublishedRows(buildFakeClient(calls), "works", null, { cursor: null, limit: 20 });
    const after = Date.now();

    expect(calls).toContainEqual(["eq", ["status", "published"]]);
    const lte = calls.find(([m, args]) => m === "lte" && args[0] === "published_at");
    expect(lte).toBeDefined();
    const bound = Date.parse((lte as Call)[1][1] as string);
    expect(bound).toBeGreaterThanOrEqual(before);
    expect(bound).toBeLessThanOrEqual(after);
  });

  it("posts は kind も eq で絞る", async () => {
    const calls: Call[] = [];
    await listPublishedRows(buildFakeClient(calls), "posts", "blog", { cursor: null, limit: 20 });

    expect(calls).toContainEqual(["eq", ["kind", "blog"]]);
    expect(calls.some(([m, args]) => m === "lte" && args[0] === "published_at")).toBe(true);
  });

  it("admin 一覧は status=published で絞っても published_at 条件を課さない (予約中も見せる)", async () => {
    const calls: Call[] = [];
    await listWorksAdmin(buildFakeClient(calls), { status: "published", cursor: null, limit: 50 });

    expect(calls).toContainEqual(["eq", ["status", "published"]]);
    expect(calls.some(([m]) => m === "lte")).toBe(false);
  });
});
