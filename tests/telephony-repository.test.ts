import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { reflectLinkResultToCalls, retryCallJobRpc } from "@/modules/telephony/repository";

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

/**
 * reflectLinkResultToCalls (§6.5.4-5 calls 反映 — 敵対レビュー BLOCKER/MAJOR 対応)。
 *
 * BLOCKER: 手動確定保護ガードは `match_status='manual'` だけでなく
 * `customer_id が非null かつ match_status != 'pending'` (= 既に matched/created で確定済み) でも
 * 発火しなければならない (canonical §6.5.4-5 の OR 条件)。1 通話に複数 call_jobs が存在し得る
 * (転送録音 + 留守電フォールバック — §10-15) ため、先着 job が matched/created を確定させた後に
 * 後発 job が別の outcome (ambiguous・別顧客) で上書きしないことを検証する。
 *
 * MAJOR: ai_cost_micro_usd の反映は「現在値 + delta」の非冪等な加算ではなく、call_id 単位で
 * call_jobs.ai_cost_micro_usd を都度 SUM 再集計する冪等な方式でなければならない
 * (commit 直前クラッシュ再入で二重加算されないことを検証する)。
 *
 * 実 DB には触れない (単体テスト)。tests/sales-repository.test.ts 系の FakeChain パターンを踏襲。
 */
describe("reflectLinkResultToCalls (§6.5.4-5 calls 反映)", () => {
  type ReadResult = { data: unknown; error: unknown };

  class ReadChain implements PromiseLike<ReadResult> {
    constructor(private readonly result: ReadResult) {}
    select(): this {
      return this;
    }
    eq(): this {
      return this;
    }
    async maybeSingle(): Promise<ReadResult> {
      return this.result;
    }
    then<T1 = ReadResult, T2 = never>(
      onfulfilled?: ((value: ReadResult) => T1 | PromiseLike<T1>) | null,
      onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
    ): PromiseLike<T1 | T2> {
      return Promise.resolve(this.result).then(onfulfilled, onrejected);
    }
  }

  class UpdateChain implements PromiseLike<ReadResult> {
    constructor(
      private readonly result: ReadResult,
      private readonly onUpdate: (payload: Record<string, unknown>) => void,
    ) {}
    update(payload: Record<string, unknown>): this {
      this.onUpdate(payload);
      return this;
    }
    eq(): this {
      return this;
    }
    then<T1 = ReadResult, T2 = never>(
      onfulfilled?: ((value: ReadResult) => T1 | PromiseLike<T1>) | null,
      onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
    ): PromiseLike<T1 | T2> {
      return Promise.resolve(this.result).then(onfulfilled, onrejected);
    }
  }

  const CALL_ID = "44444444-4444-4444-4444-444444444444";

  function buildReflectClient(opts: {
    callRow: { id: string; match_status: string; customer_id: string | null } | null;
    jobCostRows?: { ai_cost_micro_usd: number }[];
    jobsQueryError?: { message: string } | null;
    updateError?: { message: string } | null;
  }) {
    const updatePayloads: Record<string, unknown>[] = [];
    let callsSelectDone = false;
    const client = {
      from: vi.fn((table: string) => {
        if (table === "call_jobs") {
          if (opts.jobsQueryError) return new ReadChain({ data: null, error: opts.jobsQueryError });
          return new ReadChain({ data: opts.jobCostRows ?? [], error: null });
        }
        if (table !== "calls") throw new Error(`unexpected from("${table}") call`);
        if (!callsSelectDone) {
          callsSelectDone = true;
          return new ReadChain({ data: opts.callRow, error: null });
        }
        return new UpdateChain({ data: null, error: opts.updateError ?? null }, (payload) =>
          updatePayloads.push(payload),
        );
      }),
    };
    return { client: client as unknown as SupabaseClient, updatePayloads };
  }

  it("【BLOCKER】match_status='manual' の場合、customer_id/match_status を更新せず ai_cost_micro_usd の SUM 反映のみ行う", async () => {
    const { client, updatePayloads } = buildReflectClient({
      callRow: { id: CALL_ID, match_status: "manual", customer_id: "cust-manual" },
      jobCostRows: [{ ai_cost_micro_usd: 50 }, { ai_cost_micro_usd: 80 }],
    });

    const result = await reflectLinkResultToCalls(client, CALL_ID, {
      customerId: "cust-other",
      matchStatus: "matched",
      aiCostDeltaMicroUsd: 999,
    });

    expect(result).toEqual({ ok: true, value: { skipped: true } });
    expect(updatePayloads).toEqual([{ ai_cost_micro_usd: 130 }]);
  });

  it("【BLOCKER 本体】customer_id 既設定 + match_status='matched' (2ジョブ目のレース) は上書きされずスキップされる", async () => {
    const { client, updatePayloads } = buildReflectClient({
      callRow: { id: CALL_ID, match_status: "matched", customer_id: "cust-A" },
      jobCostRows: [{ ai_cost_micro_usd: 130 }],
    });

    // 後発 job (別録音・同一通話) が ambiguous / 別顧客を検出しても、先着 job の matched/created を
    // 上書きしてはならない (canonical §6.5.4-5 OR 条件 — match_status='manual' だけでは防げない)。
    const result = await reflectLinkResultToCalls(client, CALL_ID, {
      customerId: "cust-B",
      matchStatus: "ambiguous",
      aiCostDeltaMicroUsd: 999,
    });

    expect(result).toEqual({ ok: true, value: { skipped: true } });
    expect(updatePayloads).toEqual([{ ai_cost_micro_usd: 130 }]);
  });

  it("【BLOCKER】customer_id 既設定 + match_status='created' も同様に保護される", async () => {
    const { client, updatePayloads } = buildReflectClient({
      callRow: { id: CALL_ID, match_status: "created", customer_id: "cust-A" },
      jobCostRows: [{ ai_cost_micro_usd: 10 }],
    });

    const result = await reflectLinkResultToCalls(client, CALL_ID, {
      customerId: "cust-B",
      matchStatus: "matched",
      aiCostDeltaMicroUsd: 0,
    });

    expect(result).toEqual({ ok: true, value: { skipped: true } });
    expect(updatePayloads).toEqual([{ ai_cost_micro_usd: 10 }]);
  });

  it("match_status='pending' (customer_id null): 通常どおり customer_id/match_status/ai_cost を一括更新する", async () => {
    const { client, updatePayloads } = buildReflectClient({
      callRow: { id: CALL_ID, match_status: "pending", customer_id: null },
      jobCostRows: [{ ai_cost_micro_usd: 20 }],
    });

    const result = await reflectLinkResultToCalls(client, CALL_ID, {
      customerId: "cust-new",
      matchStatus: "matched",
      aiCostDeltaMicroUsd: 20,
    });

    expect(result).toEqual({ ok: true, value: { skipped: false } });
    expect(updatePayloads).toEqual([{ customer_id: "cust-new", match_status: "matched", ai_cost_micro_usd: 20 }]);
  });

  it("match_status='ambiguous' (customer_id null) はガード対象外 — 後発 job による自動再解決を妨げない", async () => {
    const { client, updatePayloads } = buildReflectClient({
      callRow: { id: CALL_ID, match_status: "ambiguous", customer_id: null },
      jobCostRows: [{ ai_cost_micro_usd: 5 }],
    });

    const result = await reflectLinkResultToCalls(client, CALL_ID, {
      customerId: "cust-resolved",
      matchStatus: "matched",
      aiCostDeltaMicroUsd: 5,
    });

    expect(result).toEqual({ ok: true, value: { skipped: false } });
    expect(updatePayloads).toEqual([
      { customer_id: "cust-resolved", match_status: "matched", ai_cost_micro_usd: 5 },
    ]);
  });

  it("【MAJOR 本体】commit直前クラッシュ再入を模した2回連続呼び出しでも ai_cost_micro_usd は二重加算されない (SUM 再集計の冪等性)", async () => {
    // 1回目 (crash 前): call_jobs.ai_cost_micro_usd の SUM = 130 が calls へ反映される想定。
    const first = buildReflectClient({
      callRow: { id: CALL_ID, match_status: "pending", customer_id: null },
      jobCostRows: [{ ai_cost_micro_usd: 130 }],
    });
    const firstResult = await reflectLinkResultToCalls(first.client, CALL_ID, {
      customerId: "cust-1",
      matchStatus: "matched",
      aiCostDeltaMicroUsd: 130,
    });
    expect(firstResult).toEqual({ ok: true, value: { skipped: false } });
    expect(first.updatePayloads[0]?.ai_cost_micro_usd).toBe(130);

    // 2回目 (commitCallJobStage 前にクラッシュ → link_result 未確定のまま lease 失効 → 再入)。
    // call_jobs 側の行は変化していない (SUM は同じ 130) — 旧実装 (current + delta) なら
    // 1回目の反映結果 (130) に再度 130 を加算して 260 になってしまっていたはずの箇所。
    const second = buildReflectClient({
      callRow: { id: CALL_ID, match_status: "pending", customer_id: null },
      jobCostRows: [{ ai_cost_micro_usd: 130 }],
    });
    const secondResult = await reflectLinkResultToCalls(second.client, CALL_ID, {
      customerId: "cust-1",
      matchStatus: "matched",
      aiCostDeltaMicroUsd: 130,
    });
    expect(secondResult).toEqual({ ok: true, value: { skipped: false } });
    expect(second.updatePayloads[0]?.ai_cost_micro_usd).toBe(130); // 260 ではない (非二重加算)
  });

  it("通話が見つからない場合は KMB-E804 (握り潰さない)", async () => {
    const { client } = buildReflectClient({ callRow: null });

    const result = await reflectLinkResultToCalls(client, CALL_ID, {
      customerId: "cust-1",
      matchStatus: "matched",
      aiCostDeltaMicroUsd: 0,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E804");
  });

  it("call_jobs SUM クエリが失敗した場合はそのままエラーを伝播する (握り潰さない)", async () => {
    const { client } = buildReflectClient({
      callRow: { id: CALL_ID, match_status: "pending", customer_id: null },
      jobsQueryError: { message: "connection reset" },
    });

    const result = await reflectLinkResultToCalls(client, CALL_ID, {
      customerId: "cust-1",
      matchStatus: "matched",
      aiCostDeltaMicroUsd: 0,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E901");
  });

  it("update 自体が失敗した場合はそのままエラーを伝播する (握り潰さない)", async () => {
    const { client } = buildReflectClient({
      callRow: { id: CALL_ID, match_status: "pending", customer_id: null },
      jobCostRows: [{ ai_cost_micro_usd: 0 }],
      updateError: { message: "connection reset" },
    });

    const result = await reflectLinkResultToCalls(client, CALL_ID, {
      customerId: "cust-1",
      matchStatus: "matched",
      aiCostDeltaMicroUsd: 0,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E901");
  });
});
