import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  budgetReserve,
  budgetSettle,
  getCurrentMonthBudget,
  getUsageSummaryRows,
  insertUsageLog,
  maskSecretsInString,
  sanitizeForStorage,
} from "@/modules/ai-providers/repository";

/**
 * canonical: docs/design/ai-studio-v2.md §1 BLOCKER-2 (予算 RPC reserve/settle の意味論)。
 * 実 Postgres 関数 (migration 20260710000015 の ai_budget_reserve/ai_budget_settle) は
 * DB 未適用のため呼べない。ここでは repository 層が
 *  (a) 正しい RPC 名・パラメータ名で呼び出すこと
 *  (b) table 関数の戻り値 (配列 or 単一行の両方) を正しくパースすること
 * を検証する (設計書 §13「予算 RPC の意味論 (モック)」)。
 *
 * tester 検証 (HIGH) 対応: v2 は reservation 方式 (ai_budget_reservations) に変更され、
 * budgetReserve は discriminated union ({ok:true; reservationId} | {ok:false; reservationId:null})
 * を返し、budgetSettle は reservationId を受け取る (estimateMicroUsd を直接は渡さない)。
 */

class FakeSelectChain implements PromiseLike<{ data: unknown; error: unknown }> {
  gteCalls: [string, unknown][] = [];
  ltCalls: [string, unknown][] = [];
  constructor(private response: { data: unknown; error: unknown }) {}
  select(): this {
    return this;
  }
  gte(col: string, value: unknown): this {
    this.gteCalls.push([col, value]);
    return this;
  }
  lt(col: string, value: unknown): this {
    this.ltCalls.push([col, value]);
    return this;
  }
  then<TResult1, TResult2>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.response).then(onfulfilled, onrejected);
  }
}

function buildFakeClient(config: {
  rpcResponses?: Record<string, { data: unknown; error: unknown }>;
  insertResponse?: { data: unknown; error: unknown };
  selectResponse?: { data: unknown; error: unknown };
  onRpc?: (name: string, params: unknown) => void;
  onInsert?: (payload: unknown) => void;
}) {
  const client = {
    rpc(name: string, params: unknown) {
      config.onRpc?.(name, params);
      return Promise.resolve(config.rpcResponses?.[name] ?? { data: null, error: { message: `no mock: ${name}` } });
    },
    from() {
      return {
        insert(payload: unknown) {
          config.onInsert?.(payload);
          return {
            select: () => ({
              single: async () => config.insertResponse ?? { data: { id: "usage-log-id" }, error: null },
            }),
          };
        },
        select: () => new FakeSelectChain(config.selectResponse ?? { data: [], error: null }),
      };
    },
  };
  return client as unknown as SupabaseClient;
}

describe("budgetReserve (RPC 呼び出し規約 + 戻り値パース)", () => {
  it("正しい RPC 名・パラメータ名 (p_estimate_micro_usd / p_image_count) で呼び出す", async () => {
    let capturedName = "";
    let capturedParams: unknown;
    const client = buildFakeClient({
      rpcResponses: {
        ai_budget_reserve: { data: [{ reservation_id: "r-1", ok: true, error_code: null }], error: null },
      },
      onRpc: (name, params) => {
        capturedName = name;
        capturedParams = params;
      },
    });

    await budgetReserve(client, 1_000_000, 2);
    expect(capturedName).toBe("ai_budget_reserve");
    expect(capturedParams).toEqual({ p_estimate_micro_usd: 1_000_000, p_image_count: 2 });
  });

  it("成功時は reservation_id を discriminated union (ok:true) として返す", async () => {
    const client = buildFakeClient({
      rpcResponses: {
        ai_budget_reserve: { data: [{ reservation_id: "r-2", ok: true, error_code: null }], error: null },
      },
    });
    const result = await budgetReserve(client, 1, 0);
    expect(result).toEqual({ ok: true, value: { ok: true, reservationId: "r-2" } });
  });

  it("予算超過時は ok:false + reservationId:null (reservation 行は作られない)", async () => {
    const client = buildFakeClient({
      rpcResponses: {
        ai_budget_reserve: { data: [{ reservation_id: null, ok: false, error_code: "KMB-E407" }], error: null },
      },
    });
    const result = await budgetReserve(client, 1, 0);
    expect(result).toEqual({
      ok: true,
      value: { ok: false, reservationId: null, errorCode: "KMB-E407" },
    });
  });

  it("単一オブジェクトで返っても解釈できる (防御的パース)", async () => {
    const client = buildFakeClient({
      rpcResponses: {
        ai_budget_reserve: { data: { reservation_id: "r-3", ok: true, error_code: null }, error: null },
      },
    });
    const result = await budgetReserve(client, 1, 0);
    expect(result).toEqual({ ok: true, value: { ok: true, reservationId: "r-3" } });
  });

  it("RPC エラーは KMB-E901 として伝播する", async () => {
    const client = buildFakeClient({
      rpcResponses: { ai_budget_reserve: { data: null, error: { message: "permission denied" } } },
    });
    const result = await budgetReserve(client, 1, 0);
    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "permission denied" });
  });
});

describe("budgetSettle (RPC 呼び出し規約。reservation 方式)", () => {
  it("正しいパラメータ名 (p_reservation_id/p_actual_micro_usd/p_actual_image_count) で呼び出す", async () => {
    let capturedParams: unknown;
    const client = buildFakeClient({
      rpcResponses: { ai_budget_settle: { data: null, error: null } },
      onRpc: (_name, params) => {
        capturedParams = params;
      },
    });

    await budgetSettle(client, {
      reservationId: "r-1",
      actualMicroUsd: 0,
      actualImageCount: 0,
    });
    expect(capturedParams).toEqual({
      p_reservation_id: "r-1",
      p_actual_micro_usd: 0,
      p_actual_image_count: 0,
    });
  });

  it("失敗時 (全キー失敗) も同一シグネチャで actual=0 を渡して解放できる", async () => {
    let capturedParams: unknown;
    const client = buildFakeClient({
      rpcResponses: { ai_budget_settle: { data: null, error: null } },
      onRpc: (_name, params) => {
        capturedParams = params;
      },
    });

    await budgetSettle(client, { reservationId: "r-2", actualMicroUsd: 0, actualImageCount: 0 });
    expect(capturedParams).toEqual({ p_reservation_id: "r-2", p_actual_micro_usd: 0, p_actual_image_count: 0 });
  });
});

describe("getCurrentMonthBudget (P5 ダッシュボード用の当月 reserved/settled/上限)", () => {
  it("RPC 結果を BudgetState 型へ正しくマッピングする", async () => {
    const client = buildFakeClient({
      rpcResponses: {
        ai_budget_get_current_month: {
          data: [
            {
              month: "2026-07-01",
              reserved_micro_usd: 1_000_000,
              settled_micro_usd: 2_000_000,
              reserved_image_count: 1,
              settled_image_count: 3,
              budget_limit_micro_usd: 50_000_000,
              image_limit: 200,
            },
          ],
          error: null,
        },
      },
    });

    const result = await getCurrentMonthBudget(client);
    expect(result).toEqual({
      ok: true,
      value: {
        month: "2026-07-01",
        reservedMicroUsd: 1_000_000,
        settledMicroUsd: 2_000_000,
        reservedImageCount: 1,
        settledImageCount: 3,
        budgetLimitMicroUsd: 50_000_000,
        imageLimit: 200,
      },
    });
  });

  it("RPC エラーは KMB-E901 として伝播する", async () => {
    const client = buildFakeClient({
      rpcResponses: { ai_budget_get_current_month: { data: null, error: { message: "boom" } } },
    });
    const result = await getCurrentMonthBudget(client);
    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "boom" });
  });
});

describe("maskSecretsInString / sanitizeForStorage (tester 検証 LOW 対応)", () => {
  it("sk- プレフィックスの長トークンをマスクする (OpenAI/Anthropic 系)", () => {
    const masked = maskSecretsInString("Incorrect API key provided: sk-abcd1234EFGH5678. Check your key.");
    expect(masked).toBe("Incorrect API key provided: ***. Check your key.");
    expect(masked).not.toContain("sk-abcd1234EFGH5678");
  });

  it("AIza プレフィックスの長トークンをマスクする (Gemini 系)", () => {
    const masked = maskSecretsInString("invalid key AIzaSyABCDEFGH12345678xyz supplied");
    expect(masked).toBe("invalid key *** supplied");
  });

  it("トークンを含まない文字列はそのまま返す", () => {
    expect(maskSecretsInString("rate limited, please retry later")).toBe("rate limited, please retry later");
  });

  it("sanitizeForStorage はネストしたオブジェクト/配列内の文字列も再帰的にマスクする", () => {
    const input = {
      error: "auth failed for sk-abcd1234EFGH5678",
      nested: { detail: ["contains AIzaSyABCDEFGH12345678xyz here"] },
      count: 3,
      ok: true,
    };
    const sanitized = sanitizeForStorage(input) as typeof input;
    expect(sanitized.error).toBe("auth failed for ***");
    expect(sanitized.nested.detail[0]).toBe("contains *** here");
    expect(sanitized.count).toBe(3);
    expect(sanitized.ok).toBe(true);
  });

  it("null/undefined/数値はそのまま返す (非文字列リーフはマスク対象外)", () => {
    expect(sanitizeForStorage(null)).toBeNull();
    expect(sanitizeForStorage(42)).toBe(42);
    expect(sanitizeForStorage(undefined)).toBeUndefined();
  });
});

describe("insertUsageLog (1 呼び出し 1 行。失敗も記録する契約)", () => {
  it("camelCase 入力を snake_case カラムへ正しくマッピングする", async () => {
    let captured: Record<string, unknown> | undefined;
    const client = buildFakeClient({
      onInsert: (payload) => {
        captured = payload as Record<string, unknown>;
      },
    });

    await insertUsageLog(client, {
      provider: "anthropic",
      model: "claude-opus-4-8",
      keyId: "key-1",
      kind: "text",
      feature: "studio",
      inputTokens: 10,
      outputTokens: 20,
      imageCount: null,
      costMicroUsd: 500,
      status: "ok",
      errorCode: null,
      rawUsage: { input_tokens: 10 },
      rateSnapshot: { computedAt: "2026-07-10T00:00:00.000Z" },
      refTable: "ai_runs",
      refId: "run-1",
    });

    expect(captured).toMatchObject({
      provider: "anthropic",
      model: "claude-opus-4-8",
      key_id: "key-1",
      kind: "text",
      feature: "studio",
      input_tokens: 10,
      output_tokens: 20,
      cost_micro_usd: 500,
      status: "ok",
      ref_table: "ai_runs",
      ref_id: "run-1",
    });
  });

  it("失敗呼び出しも status='error' + errorCode 込みで記録できる", async () => {
    let captured: Record<string, unknown> | undefined;
    const client = buildFakeClient({ onInsert: (p) => (captured = p as Record<string, unknown>) });

    await insertUsageLog(client, {
      provider: "openai",
      model: "gpt-image-2",
      keyId: null,
      kind: "image",
      feature: "image-gen",
      inputTokens: null,
      outputTokens: null,
      imageCount: 0,
      costMicroUsd: 0,
      status: "error",
      errorCode: "auth",
      rawUsage: { error: "invalid key" },
      rateSnapshot: null,
      refTable: null,
      refId: null,
    });

    expect(captured).toMatchObject({ status: "error", error_code: "auth", cost_micro_usd: 0, key_id: null });
  });
});

describe("getUsageSummaryRows (feature/model/key/日別の集計)", () => {
  it("同一 (provider, model, feature, key, date) の行を合算する", async () => {
    const client = buildFakeClient({
      selectResponse: {
        data: [
          {
            provider: "anthropic",
            model: "claude-opus-4-8",
            feature: "studio",
            key_id: "key-1",
            image_count: null,
            cost_micro_usd: 1000,
            created_at: "2026-07-10T01:00:00.000Z",
          },
          {
            provider: "anthropic",
            model: "claude-opus-4-8",
            feature: "studio",
            key_id: "key-1",
            image_count: null,
            cost_micro_usd: 2000,
            created_at: "2026-07-10T05:00:00.000Z",
          },
          {
            provider: "openai",
            model: "gpt-image-2",
            feature: "image-gen",
            key_id: null,
            image_count: 4,
            cost_micro_usd: 500,
            created_at: "2026-07-11T00:00:00.000Z",
          },
        ],
        error: null,
      },
    });

    const result = await getUsageSummaryRows(client, { from: "2026-07-01", to: "2026-08-01" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const studioRow = result.value.find((r) => r.feature === "studio");
    expect(studioRow).toEqual({
      provider: "anthropic",
      model: "claude-opus-4-8",
      feature: "studio",
      keyId: "key-1",
      date: "2026-07-10",
      costMicroUsd: 3000,
      callCount: 2,
      imageCount: 0,
    });

    const imageRow = result.value.find((r) => r.feature === "image-gen");
    expect(imageRow).toEqual({
      provider: "openai",
      model: "gpt-image-2",
      feature: "image-gen",
      keyId: null,
      date: "2026-07-11",
      costMicroUsd: 500,
      callCount: 1,
      imageCount: 4,
    });
  });

  it("空データは空配列を返す", async () => {
    const client = buildFakeClient({ selectResponse: { data: [], error: null } });
    const result = await getUsageSummaryRows(client, { from: "2026-07-01", to: "2026-08-01" });
    expect(result).toEqual({ ok: true, value: [] });
  });
});
