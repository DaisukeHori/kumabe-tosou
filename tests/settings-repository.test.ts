import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { upsertSetting } from "@/modules/settings/repository";

/**
 * 回帰テスト (KMB-E103 本番バグ): site_settings の楽観排他は updated_at の
 * **生文字列**をそのまま `.eq()` に渡す必要がある。
 *
 * Postgres の timestamptz はマイクロ秒精度 (例 "2026-07-08T07:38:52.287954+00:00") で
 * 保存・返却されるが、`new Date(str).toISOString()` を経由するとミリ秒精度に丸められ
 * (例 "2026-07-08T07:38:52.287Z")、下 3 桁が失われる。この結果 `.eq("updated_at", ...)` が
 * 常に不一致になり、他者が誰も編集していなくても毎回 conflict (KMB-E103) が誤発火する。
 *
 * content/repository.ts の updateWithOptimisticLock, pricing/repository.ts の upsertGrade
 * と同じ「生文字列比較」方式に統一したことを検証する。
 */

type EqCall = [string, unknown];

class FakeSelectQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  eqCalls: EqCall[] = [];
  constructor(private response: { data: unknown; error: unknown }) {}
  select(): this {
    return this;
  }
  eq(col: string, value: unknown): this {
    this.eqCalls.push([col, value]);
    return this;
  }
  then<TResult1, TResult2>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.response).then(onfulfilled, onrejected);
  }
  async maybeSingle() {
    return this.response;
  }
}

class FakeUpdateQuery {
  eqCalls: EqCall[] = [];
  constructor(
    private response: { data: unknown; error: unknown },
    private onMaybeSingle?: (eqCalls: EqCall[]) => void,
  ) {}
  eq(col: string, value: unknown): this {
    this.eqCalls.push([col, value]);
    return this;
  }
  select(): this {
    return this;
  }
  async maybeSingle() {
    this.onMaybeSingle?.(this.eqCalls);
    return this.response;
  }
}

function buildFakeClient(config: {
  selectResponse: { data: unknown; error: unknown };
  updateResponse: { data: unknown; error: unknown };
  onUpdateEq?: (eqCalls: EqCall[]) => void;
}) {
  const client = {
    from() {
      return {
        select: () => new FakeSelectQuery(config.selectResponse),
        update: () => new FakeUpdateQuery(config.updateResponse, config.onUpdateEq),
        insert: async () => ({ error: null }),
      };
    },
  };
  return client as unknown as SupabaseClient;
}

const MICROSECOND_UPDATED_AT = "2026-07-08T07:38:52.287954+00:00";
// バグ再現用: Date.toISOString() を経由すると下 3 桁 (954) が失われミリ秒精度になる。
const TRUNCATED_TO_MILLIS = new Date(MICROSECOND_UPDATED_AT).toISOString();

describe("upsertSetting: 楽観排他は updated_at の生文字列比較", () => {
  it("マイクロ秒精度の文字列がそのまま .eq('updated_at', ...) に渡る (丸められない)", async () => {
    const recordedEq: EqCall[] = [];
    const client = buildFakeClient({
      selectResponse: {
        data: { key: "company", value: {}, updated_at: MICROSECOND_UPDATED_AT },
        error: null,
      },
      updateResponse: { data: { key: "company" }, error: null },
      onUpdateEq: (eqCalls) => recordedEq.push(...eqCalls),
    });

    const result = await upsertSetting(client, "company", {}, MICROSECOND_UPDATED_AT, "user-1");

    expect(result).toEqual({ kind: "updated" });
    expect(recordedEq).toContainEqual(["updated_at", MICROSECOND_UPDATED_AT]);
    // 丸められたミリ秒精度の値は決して渡されない (これが本番バグの直接原因だった)。
    expect(recordedEq).not.toContainEqual(["updated_at", TRUNCATED_TO_MILLIS]);
  });

  it("Date.toISOString() で丸めた値を渡すと (旧バグ挙動) DB の生値と不一致になり conflict になる", async () => {
    // このテストは「Date 経由だと精度が落ちる」こと自体の回帰確認 (repository の外側、
    // JS 標準動作の確認)。settings 側が二度と Date を経由しないことを保証する。
    expect(TRUNCATED_TO_MILLIS).not.toBe(MICROSECOND_UPDATED_AT);

    const recordedEq: EqCall[] = [];
    const client = buildFakeClient({
      selectResponse: {
        data: { key: "company", value: {}, updated_at: MICROSECOND_UPDATED_AT },
        error: null,
      },
      // DB の .eq が本物なら不一致で 0 行 (= data: null) になるはずの状況を模す。
      updateResponse: { data: null, error: null },
      onUpdateEq: (eqCalls) => recordedEq.push(...eqCalls),
    });

    const result = await upsertSetting(client, "company", {}, TRUNCATED_TO_MILLIS, "user-1");

    expect(result).toEqual({ kind: "conflict" });
    expect(recordedEq).toContainEqual(["updated_at", TRUNCATED_TO_MILLIS]);
  });

  it("行が存在しない場合は expectedUpdatedAt を無視して新規 INSERT する", async () => {
    const client = buildFakeClient({
      selectResponse: { data: null, error: null },
      updateResponse: { data: null, error: null },
    });

    const result = await upsertSetting(client, "company", {}, "", "user-1");
    expect(result).toEqual({ kind: "inserted" });
  });
});
