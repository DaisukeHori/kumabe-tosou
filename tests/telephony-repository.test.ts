import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  countAmbiguousCalls,
  countFailedCallJobs,
  countStaleCallJobs,
  linkCallToCustomerRow,
  listCallsPage,
  reflectLinkResultToCalls,
  retryCallJobRpc,
  updateCallMemo,
  type CallRow,
} from "@/modules/telephony/repository";
import { CALL_JOB_RUNNABLE_STATUSES } from "@/modules/telephony/internal/stage-machine";

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

/**
 * ============================================================
 * #59: /admin/calls 一覧・詳細・楽観排他 UPDATE・集計クエリの単体テスト
 * (計画書 issue-59.md テスト戦略「新規 repository 関数のうち純粋にクエリ組み立てロジックが
 * あるもの (keyset cursor 組み立て等) は既存 telephony-repository.test.ts に追加」)。
 * FakeChain/buildClient パターン (上記 retryCallJobRpc/reflectLinkResultToCalls と同型) を
 * 踏襲した軽量モック。実 DB には触れない。
 * ============================================================
 */

type RowResult = { data: unknown; error: unknown };

/** select/eq/in/or/order/limit をチェーン可能にした軽量モック (listCallsPage 用)。 */
class RowChain implements PromiseLike<RowResult> {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  constructor(private readonly result: RowResult) {}
  private record(method: string, args: unknown[]): this {
    this.calls.push({ method, args });
    return this;
  }
  select(...a: unknown[]): this {
    return this.record("select", a);
  }
  eq(...a: unknown[]): this {
    return this.record("eq", a);
  }
  in(...a: unknown[]): this {
    return this.record("in", a);
  }
  or(...a: unknown[]): this {
    return this.record("or", a);
  }
  order(...a: unknown[]): this {
    return this.record("order", a);
  }
  limit(...a: unknown[]): this {
    return this.record("limit", a);
  }
  then<T1 = RowResult, T2 = never>(
    onfulfilled?: ((value: RowResult) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

function buildRowClient(fromQueue: RowChain[]) {
  let cursor = 0;
  const fromCalls: string[] = [];
  const client = {
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      const chain = fromQueue[cursor];
      cursor += 1;
      if (!chain) throw new Error(`unexpected extra from("${table}") call (#${cursor})`);
      return chain;
    }),
  };
  return { client: client as unknown as SupabaseClient, fromCalls };
}

function makeCallRow(overrides: Partial<CallRow> & Pick<CallRow, "id" | "started_at">): CallRow {
  return {
    call_sid: `CA${overrides.id}`,
    direction: "inbound",
    from_e164: "+819012345678",
    from_raw: "090-1234-5678",
    to_e164: "+81961234567",
    twilio_status: "completed",
    handling: "forwarded",
    match_status: "pending",
    customer_id: null,
    duration_seconds: 30,
    ended_at: null,
    twilio_cost_estimate_micro_usd: 0,
    ai_cost_micro_usd: 0,
    memo: null,
    created_at: overrides.started_at,
    updated_at: overrides.started_at,
    ...overrides,
  };
}

function encodeCursor(startedAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ startedAt, id }), "utf-8").toString("base64url");
}

function decodeCursor(raw: string): { startedAt: string; id: string } {
  return JSON.parse(Buffer.from(raw, "base64url").toString("utf-8")) as { startedAt: string; id: string };
}

/**
 * listCallsPage (§7.2/§8.1 — keyset (started_at desc, id desc) + フィルタ集約)。
 * 計画書の明示地雷: 「jobFailed フィルタは事前に call_id 集合を取得して .in() で絞る
 * (JS 側の後絞りはしない — post-filter だと keyset ページングと相性が悪く 50 件に満たない
 * 結果が生まれる)」を repository 実装が守っていることを検証する。
 */
describe("listCallsPage (#59 — /admin/calls 一覧 keyset + フィルタ集約)", () => {
  it("jobFailed=true かつ failed が0件の場合、calls への追加問い合わせを行わず空ページを返す", async () => {
    const { client, fromCalls } = buildRowClient([new RowChain({ data: [], error: null })]);
    const result = await listCallsPage(client, { jobFailed: true }, { cursor: null, limit: 50 });
    expect(result).toEqual({ ok: true, value: { items: [], next_cursor: null } });
    expect(fromCalls).toEqual(["call_jobs"]);
  });

  it("jobFailed=true: 同一 call_id を持つ複数ジョブは重複排除して calls クエリの .in() へ渡す", async () => {
    const failedChain = new RowChain({
      data: [{ call_id: "c1" }, { call_id: "c1" }, { call_id: "c2" }],
      error: null,
    });
    const callsChain = new RowChain({
      data: [makeCallRow({ id: "c1", started_at: "2026-07-10T00:00:00.000Z" })],
      error: null,
    });
    const jobsChain = new RowChain({ data: [], error: null });
    const { client } = buildRowClient([failedChain, callsChain, jobsChain]);

    await listCallsPage(client, { jobFailed: true }, { cursor: null, limit: 50 });

    const inCall = callsChain.calls.find((c) => c.method === "in");
    expect(inCall?.args).toEqual(["id", ["c1", "c2"]]);
  });

  it("handling/needsReview フィルタは calls クエリへ対応する .eq() として渡す (JS 後絞りしない)", async () => {
    const callsChain = new RowChain({ data: [], error: null });
    const { client } = buildRowClient([callsChain]);

    const result = await listCallsPage(
      client,
      { handling: "forwarded", needsReview: true },
      { cursor: null, limit: 50 },
    );

    expect(result).toEqual({ ok: true, value: { items: [], next_cursor: null } });
    const eqCalls = callsChain.calls.filter((c) => c.method === "eq");
    expect(eqCalls).toContainEqual({ method: "eq", args: ["handling", "forwarded"] });
    expect(eqCalls).toContainEqual({ method: "eq", args: ["match_status", "ambiguous"] });
  });

  it("calls が limit+1 件返る (hasMore) 場合、超過分は除外し next_cursor は最後に保持した行から生成する", async () => {
    const rows = [
      makeCallRow({ id: "r1", started_at: "2026-07-10T03:00:00.000Z" }),
      makeCallRow({ id: "r2", started_at: "2026-07-10T02:00:00.000Z" }),
      makeCallRow({ id: "r3", started_at: "2026-07-10T01:00:00.000Z" }), // limit(2)+1 の超過分
    ];
    const callsChain = new RowChain({ data: rows, error: null });
    const jobsChain = new RowChain({ data: [], error: null });
    const { client } = buildRowClient([callsChain, jobsChain]);

    const result = await listCallsPage(client, {}, { cursor: null, limit: 2 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items.map((r) => r.id)).toEqual(["r1", "r2"]); // r3 は含まれない
    expect(result.value.next_cursor).not.toBeNull();
    expect(decodeCursor(result.value.next_cursor as string)).toEqual({
      startedAt: "2026-07-10T02:00:00.000Z", // 最後に「保持した」行 (r2) — 超過分 r3 ではない
      id: "r2",
    });
  });

  it("calls が limit 件ちょうど (hasMore なし) の場合、next_cursor は null", async () => {
    const rows = [
      makeCallRow({ id: "r1", started_at: "2026-07-10T03:00:00.000Z" }),
      makeCallRow({ id: "r2", started_at: "2026-07-10T02:00:00.000Z" }),
    ];
    const { client } = buildRowClient([new RowChain({ data: rows, error: null }), new RowChain({ data: [], error: null })]);

    const result = await listCallsPage(client, {}, { cursor: null, limit: 2 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items).toHaveLength(2);
    expect(result.value.next_cursor).toBeNull();
  });

  it("job_status 集約: 同一 call_id に複数 job がある場合、クエリ順序 (created_at desc) の先頭を採用する", async () => {
    const callsChain = new RowChain({
      data: [makeCallRow({ id: "c1", started_at: "2026-07-10T00:00:00.000Z" })],
      error: null,
    });
    // 実クエリは call_id asc, created_at desc で返す前提 — 同一 call_id の先頭行が「最新」。
    const jobsChain = new RowChain({
      data: [
        { call_id: "c1", status: "failed", created_at: "2026-07-10T00:10:00.000Z" },
        { call_id: "c1", status: "done", created_at: "2026-07-10T00:05:00.000Z" },
      ],
      error: null,
    });
    const { client } = buildRowClient([callsChain, jobsChain]);

    const result = await listCallsPage(client, {}, { cursor: null, limit: 50 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items[0]?.job_status).toBe("failed");
  });

  it("job を1件も持たない通話は job_status: null になる", async () => {
    const callsChain = new RowChain({
      data: [makeCallRow({ id: "c1", started_at: "2026-07-10T00:00:00.000Z" })],
      error: null,
    });
    const { client } = buildRowClient([callsChain, new RowChain({ data: [], error: null })]);

    const result = await listCallsPage(client, {}, { cursor: null, limit: 50 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items[0]?.job_status).toBeNull();
  });

  it("job_status と同じ最新行 (call_id asc, created_at desc の先頭) から error_code/analysis も併せて採る (§8.1 一覧 error_code ツールチップ/要約冒頭40字用 — レビュー指摘是正)", async () => {
    const callsChain = new RowChain({
      data: [makeCallRow({ id: "c1", started_at: "2026-07-10T00:00:00.000Z" })],
      error: null,
    });
    const jobsChain = new RowChain({
      data: [
        { call_id: "c1", status: "failed", error_code: "KMB-E821", analysis: null, created_at: "2026-07-10T00:10:00.000Z" },
        { call_id: "c1", status: "analyzing", error_code: null, analysis: null, created_at: "2026-07-10T00:05:00.000Z" },
      ],
      error: null,
    });
    const { client } = buildRowClient([callsChain, jobsChain]);

    const result = await listCallsPage(client, {}, { cursor: null, limit: 50 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items[0]?.job_status).toBe("failed");
    expect(result.value.items[0]?.job_error_code).toBe("KMB-E821");
  });

  it("job を1件も持たない通話は job_error_code/job_analysis も null になる (握り潰しではなく単純な未存在)", async () => {
    const callsChain = new RowChain({
      data: [makeCallRow({ id: "c1", started_at: "2026-07-10T00:00:00.000Z" })],
      error: null,
    });
    const { client } = buildRowClient([callsChain, new RowChain({ data: [], error: null })]);

    const result = await listCallsPage(client, {}, { cursor: null, limit: 50 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.items[0]?.job_error_code).toBeNull();
    expect(result.value.items[0]?.job_analysis).toBeNull();
  });

  it("不正な cursor (decode 失敗) は無視され .or() を呼ばずに問い合わせる", async () => {
    const callsChain = new RowChain({ data: [], error: null });
    const { client } = buildRowClient([callsChain]);

    await listCallsPage(client, {}, { cursor: "!!!not-valid-base64!!!", limit: 50 });

    expect(callsChain.calls.some((c) => c.method === "or")).toBe(false);
  });

  it("正常な cursor は started_at/id の範囲条件で .or() に渡す (keyset継続)", async () => {
    const callsChain = new RowChain({ data: [], error: null });
    const { client } = buildRowClient([callsChain]);
    const cursor = encodeCursor("2026-07-01T00:00:00.000Z", "abc-123");

    await listCallsPage(client, {}, { cursor, limit: 50 });

    const orCall = callsChain.calls.find((c) => c.method === "or");
    expect(orCall?.args).toEqual([
      "started_at.lt.2026-07-01T00:00:00.000Z,and(started_at.eq.2026-07-01T00:00:00.000Z,id.lt.abc-123)",
    ]);
  });

  it("calls クエリのエラーは握り潰さずそのまま伝播する (call_jobs 集約クエリは呼ばれない)", async () => {
    const { client, fromCalls } = buildRowClient([
      new RowChain({ data: null, error: { message: "connection reset" } }),
    ]);

    const result = await listCallsPage(client, {}, { cursor: null, limit: 50 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E901");
    expect(fromCalls).toEqual(["calls"]);
  });
});

/** 楽観排他 (updated_at 生文字列比較) の CAS チェーン (linkCallToCustomerRow/updateCallMemo 共通)。 */
class CasChain implements PromiseLike<RowResult> {
  updatePayload: Record<string, unknown> | null = null;
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  constructor(private readonly result: RowResult) {}
  private record(method: string, args: unknown[]): this {
    this.calls.push({ method, args });
    return this;
  }
  update(payload: Record<string, unknown>): this {
    this.updatePayload = payload;
    return this.record("update", [payload]);
  }
  select(...a: unknown[]): this {
    return this.record("select", a);
  }
  eq(...a: unknown[]): this {
    return this.record("eq", a);
  }
  async maybeSingle(): Promise<RowResult> {
    return this.result;
  }
  then<T1 = RowResult, T2 = never>(
    onfulfilled?: ((value: RowResult) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

function buildCasClient(fromQueue: CasChain[]) {
  let cursor = 0;
  const fromCalls: string[] = [];
  const client = {
    from: vi.fn((table: string) => {
      fromCalls.push(table);
      const chain = fromQueue[cursor];
      cursor += 1;
      if (!chain) throw new Error(`unexpected extra from("${table}") call (#${cursor})`);
      return chain;
    }),
  };
  return { client: client as unknown as SupabaseClient, fromCalls };
}

const LINK_CALL_ID = "55555555-5555-5555-5555-555555555555";
const EXPECTED_UPDATED_AT = "2026-07-10T00:00:00.000000+00:00";

describe("linkCallToCustomerRow (#59 — 顧客紐づけ CAS 更新 + E103/E804 判別)", () => {
  it("CAS 一致で成功: payload に customer_id/match_status='manual' を渡し、存在確認は呼ばれない", async () => {
    const updateChain = new CasChain({
      data: makeCallRow({ id: LINK_CALL_ID, started_at: EXPECTED_UPDATED_AT, customer_id: "cust-1" }),
      error: null,
    });
    const { client, fromCalls } = buildCasClient([updateChain]);

    const result = await linkCallToCustomerRow(client, LINK_CALL_ID, "cust-1", EXPECTED_UPDATED_AT);

    expect(result.ok).toBe(true);
    expect(updateChain.updatePayload).toEqual({ customer_id: "cust-1", match_status: "manual" });
    expect(fromCalls).toEqual(["calls"]);
  });

  it("customerId=null (紐づけ解除) も payload にそのまま渡す (§5.2.2 v1.1: manual は customer_id null 可)", async () => {
    const updateChain = new CasChain({
      data: makeCallRow({ id: LINK_CALL_ID, started_at: EXPECTED_UPDATED_AT, customer_id: null }),
      error: null,
    });
    const { client } = buildCasClient([updateChain]);

    await linkCallToCustomerRow(client, LINK_CALL_ID, null, EXPECTED_UPDATED_AT);

    expect(updateChain.updatePayload).toEqual({ customer_id: null, match_status: "manual" });
  });

  it("CAS 不一致 + 対象行が存在する場合は KMB-E103 (他操作による更新) を返す", async () => {
    const updateChain = new CasChain({ data: null, error: null });
    const existChain = new CasChain({ data: { id: LINK_CALL_ID }, error: null });
    const { client } = buildCasClient([updateChain, existChain]);

    const result = await linkCallToCustomerRow(client, LINK_CALL_ID, "cust-1", EXPECTED_UPDATED_AT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E103");
  });

  it("CAS 不一致 + 対象行が存在しない場合は KMB-E804 を返す", async () => {
    const updateChain = new CasChain({ data: null, error: null });
    const existChain = new CasChain({ data: null, error: null });
    const { client } = buildCasClient([updateChain, existChain]);

    const result = await linkCallToCustomerRow(client, LINK_CALL_ID, "cust-1", EXPECTED_UPDATED_AT);

    expect(result).toEqual({
      ok: false,
      code: "KMB-E804",
      detail: expect.stringContaining(LINK_CALL_ID),
    });
  });

  it("update クエリ自体のエラーは握り潰さず伝播する (存在確認は呼ばれない)", async () => {
    const updateChain = new CasChain({ data: null, error: { message: "connection reset" } });
    const { client, fromCalls } = buildCasClient([updateChain]);

    const result = await linkCallToCustomerRow(client, LINK_CALL_ID, "cust-1", EXPECTED_UPDATED_AT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E901");
    expect(fromCalls).toEqual(["calls"]);
  });

  it("存在確認クエリ自体のエラーも握り潰さず伝播する", async () => {
    const updateChain = new CasChain({ data: null, error: null });
    const existChain = new CasChain({ data: null, error: { message: "connection reset" } });
    const { client } = buildCasClient([updateChain, existChain]);

    const result = await linkCallToCustomerRow(client, LINK_CALL_ID, "cust-1", EXPECTED_UPDATED_AT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E901");
  });
});

describe("updateCallMemo (#59 — メモ欄 CAS 更新 + E103/E804 判別。計画書未解決点#2 の追加実装分)", () => {
  it("CAS 一致で成功: payload に memo のみを渡す", async () => {
    const updateChain = new CasChain({
      data: makeCallRow({ id: LINK_CALL_ID, started_at: EXPECTED_UPDATED_AT, memo: "折り返し希望" }),
      error: null,
    });
    const { client } = buildCasClient([updateChain]);

    const result = await updateCallMemo(client, LINK_CALL_ID, "折り返し希望", EXPECTED_UPDATED_AT);

    expect(result.ok).toBe(true);
    expect(updateChain.updatePayload).toEqual({ memo: "折り返し希望" });
  });

  it("memo=null (クリア) も許容する", async () => {
    const updateChain = new CasChain({
      data: makeCallRow({ id: LINK_CALL_ID, started_at: EXPECTED_UPDATED_AT, memo: null }),
      error: null,
    });
    const { client } = buildCasClient([updateChain]);

    await updateCallMemo(client, LINK_CALL_ID, null, EXPECTED_UPDATED_AT);

    expect(updateChain.updatePayload).toEqual({ memo: null });
  });

  it("CAS 不一致 + 対象行が存在する場合は KMB-E103 を返す", async () => {
    const { client } = buildCasClient([
      new CasChain({ data: null, error: null }),
      new CasChain({ data: { id: LINK_CALL_ID }, error: null }),
    ]);

    const result = await updateCallMemo(client, LINK_CALL_ID, "memo", EXPECTED_UPDATED_AT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E103");
  });

  it("CAS 不一致 + 対象行が存在しない場合は KMB-E804 を返す", async () => {
    const { client } = buildCasClient([
      new CasChain({ data: null, error: null }),
      new CasChain({ data: null, error: null }),
    ]);

    const result = await updateCallMemo(client, LINK_CALL_ID, "memo", EXPECTED_UPDATED_AT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E804");
  });

  it("update クエリ自体のエラーは握り潰さず伝播する", async () => {
    const { client } = buildCasClient([new CasChain({ data: null, error: { message: "connection reset" } })]);

    const result = await updateCallMemo(client, LINK_CALL_ID, "memo", EXPECTED_UPDATED_AT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E901");
  });
});

/** count クエリ ({count:"exact",head:true} 形式 — data ではなく count を返す) のチェーン。 */
type CountResult = { count: number | null; error: unknown };
class CountChain implements PromiseLike<CountResult> {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  constructor(private readonly result: CountResult) {}
  private record(method: string, args: unknown[]): this {
    this.calls.push({ method, args });
    return this;
  }
  select(...a: unknown[]): this {
    return this.record("select", a);
  }
  eq(...a: unknown[]): this {
    return this.record("eq", a);
  }
  in(...a: unknown[]): this {
    return this.record("in", a);
  }
  lt(...a: unknown[]): this {
    return this.record("lt", a);
  }
  then<T1 = CountResult, T2 = never>(
    onfulfilled?: ((value: CountResult) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

function buildCountClient(chain: CountChain) {
  const client = { from: vi.fn(() => chain) };
  return client as unknown as SupabaseClient;
}

/**
 * §7.2/§8.4 の集計3関数。「エラー握り潰し厳禁」の要石: count クエリが失敗した場合に
 * 0 件へフォールバックしてしまうと、admin から見て「異常が無い (0件)」と「本当に0件」の
 * 区別がつかなくなり、DB 障害を静かに隠蔽してしまう (最重要地雷)。
 */
describe("countFailedCallJobs / countAmbiguousCalls / countStaleCallJobs (#59 — getCallAlertCounts/getTelephonySetupStatus 集計)", () => {
  it("countFailedCallJobs: 正常時は status='failed' で絞った count を返す", async () => {
    const chain = new CountChain({ count: 3, error: null });
    const result = await countFailedCallJobs(buildCountClient(chain));
    expect(result).toEqual({ ok: true, value: 3 });
    expect(chain.calls).toContainEqual({ method: "eq", args: ["status", "failed"] });
  });

  it("countFailedCallJobs: count が null の場合は 0 を返す (0件と未取得の区別は error の有無で行う)", async () => {
    const result = await countFailedCallJobs(buildCountClient(new CountChain({ count: null, error: null })));
    expect(result).toEqual({ ok: true, value: 0 });
  });

  it("countFailedCallJobs: クエリエラーは 0 へ丸めず握り潰さずそのまま伝播する", async () => {
    const result = await countFailedCallJobs(
      buildCountClient(new CountChain({ count: null, error: { message: "connection reset" } })),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E901");
  });

  it("countAmbiguousCalls: 正常時は match_status='ambiguous' で絞った count を返す", async () => {
    const chain = new CountChain({ count: 2, error: null });
    const result = await countAmbiguousCalls(buildCountClient(chain));
    expect(result).toEqual({ ok: true, value: 2 });
    expect(chain.calls).toContainEqual({ method: "eq", args: ["match_status", "ambiguous"] });
  });

  it("countAmbiguousCalls: クエリエラーは握り潰さずそのまま伝播する", async () => {
    const result = await countAmbiguousCalls(
      buildCountClient(new CountChain({ count: null, error: { message: "connection reset" } })),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E901");
  });

  it("countStaleCallJobs: CALL_JOB_RUNNABLE_STATUSES (非終端) かつ created_at < now-30分 で絞る", async () => {
    const chain = new CountChain({ count: 1, error: null });
    const before = Date.now();
    const result = await countStaleCallJobs(buildCountClient(chain));
    const after = Date.now();

    expect(result).toEqual({ ok: true, value: 1 });
    const inCall = chain.calls.find((c) => c.method === "in");
    expect(inCall?.args).toEqual(["status", [...CALL_JOB_RUNNABLE_STATUSES]]);
    const ltCall = chain.calls.find((c) => c.method === "lt");
    expect(ltCall?.args[0]).toBe("created_at");
    const staleBeforeMs = new Date(ltCall?.args[1] as string).getTime();
    // 「created_at < now() - 30分」の閾値が実行時刻を基準に ±数秒の誤差内で算出されていること
    expect(staleBeforeMs).toBeGreaterThanOrEqual(before - 30 * 60 * 1000 - 2000);
    expect(staleBeforeMs).toBeLessThanOrEqual(after - 30 * 60 * 1000 + 2000);
  });

  it("countStaleCallJobs: クエリエラーは握り潰さずそのまま伝播する (getTelephonySetupStatus/getCallAlertCounts 両方がこの関数を共有するため回帰の影響が大きい)", async () => {
    const result = await countStaleCallJobs(
      buildCountClient(new CountChain({ count: null, error: { message: "connection reset" } })),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E901");
  });
});
