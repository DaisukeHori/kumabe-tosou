import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { retryCallJobRpc } from "@/modules/telephony/repository";

/**
 * canonical: docs/design/crm-suite/04-telephony.md §7.1 (D8 TelephonyFacade エラー表 —
 * retryCallJob は「E807(failed以外) / E804(不存在 — RPC 例外を E807 と区別して変換) /
 * E201/E202」)。migration 0033 `call_job_retry` RPC は「対象が存在しない」場合と
 * 「status!=failed」場合をどちらも同一の `raise exception 'KMB-E807: ...'` 経路で扱う
 * (SQL 側コメント参照)。repository.ts の `retryCallJobRpc` は KMB-E807 のときに限り
 * 対象行の存在を追加確認し、存在しなければ E804 へ変換する (敵対レビュー MAJOR 対応)。
 *
 * tests/sales-repository.test.ts の FakeChain/buildClient パターンを踏襲した軽量モック。
 * 実 DB には触れない (単体テスト)。
 */

type PgResult = { data: unknown; error: unknown };

class FakeChain implements PromiseLike<PgResult> {
  constructor(private readonly result: PgResult) {}
  select(): this {
    return this;
  }
  eq(): this {
    return this;
  }
  async maybeSingle(): Promise<PgResult> {
    return this.result;
  }
  then<T1 = PgResult, T2 = never>(
    onfulfilled?: ((value: PgResult) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

function buildClient(opts: { rpc: PgResult; existsCheck?: PgResult }) {
  const fromCalls: string[] = [];
  const client = {
    rpc: vi.fn(() => Promise.resolve(opts.rpc)),
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      if (!opts.existsCheck) {
        throw new Error(`unexpected from("${table}") call — existsCheck not configured`);
      }
      return new FakeChain(opts.existsCheck);
    }),
  };
  return { client: client as unknown as SupabaseClient, fromCalls };
}

const JOB_ID = "33333333-3333-3333-3333-333333333333";

describe("retryCallJobRpc (call_job_retry RPC ラッパー — E804/E807/E202 の区別)", () => {
  it("RPC 成功時はそのまま status を返す (existsCheck は呼ばれない)", async () => {
    const { client, fromCalls } = buildClient({ rpc: { data: "pending", error: null } });
    const result = await retryCallJobRpc(client, JOB_ID);
    expect(result).toEqual({ ok: true, value: "pending" });
    expect(fromCalls).toEqual([]);
  });

  it("KMB-E807 かつ対象行が存在する (failed 以外への retry) 場合は E807 のまま返す", async () => {
    const { client } = buildClient({
      rpc: { data: null, error: { message: "KMB-E807: 再実行できるのは failed のジョブのみです" } },
      existsCheck: { data: { id: JOB_ID }, error: null }, // 行は存在する
    });
    const result = await retryCallJobRpc(client, JOB_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E807");
  });

  it("KMB-E807 かつ対象行が存在しない場合は E804 へ変換する (敵対レビュー MAJOR 本体)", async () => {
    const { client } = buildClient({
      rpc: { data: null, error: { message: "KMB-E807: 再実行できるのは failed のジョブのみです" } },
      existsCheck: { data: null, error: null }, // 行が存在しない
    });
    const result = await retryCallJobRpc(client, JOB_ID);
    expect(result).toEqual({
      ok: false,
      code: "KMB-E804",
      detail: expect.stringContaining(JOB_ID),
    });
  });

  it("KMB-E807 だが存在確認クエリ自体が失敗した場合は E804 を騙らず元の E807 を返す", async () => {
    const { client } = buildClient({
      rpc: { data: null, error: { message: "KMB-E807: 再実行できるのは failed のジョブのみです" } },
      existsCheck: { data: null, error: { message: "connection reset" } },
    });
    const result = await retryCallJobRpc(client, JOB_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E807");
  });

  it("is_admin_or_service ガードの permission denied は E202 のまま返す (存在確認を行わない — 非admin は RLS で行が見えず誤って E804 化する地雷を回避)", async () => {
    const { client, fromCalls } = buildClient({
      rpc: { data: null, error: { message: "permission denied: call_job_retry requires admin or service_role" } },
    });
    const result = await retryCallJobRpc(client, JOB_ID);
    expect(result).toEqual({
      ok: false,
      code: "KMB-E202",
      detail: "permission denied: call_job_retry requires admin or service_role",
    });
    // E202 は KMB-E807 ではないため existsCheck (from("call_jobs")) は一切呼ばれない
    expect(fromCalls).toEqual([]);
  });

  it("想定外の DB エラーは KMB-E901 のまま返す (existsCheck を行わない)", async () => {
    const { client, fromCalls } = buildClient({
      rpc: { data: null, error: { message: "unexpected failure", code: "XX000" } },
    });
    const result = await retryCallJobRpc(client, JOB_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E901");
    expect(fromCalls).toEqual([]);
  });
});
