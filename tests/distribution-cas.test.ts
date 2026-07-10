import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  cancelScheduledChannelPost,
  claimDueScheduledPosts,
  claimNoteDraftCreating,
  retryFailedToScheduled,
} from "@/modules/distribution/repository";

/**
 * canonical: 契約書 §7.2 (CAS: affected rows=1 のみ進行) / 設計書 §4.3 (状態遷移ガード)。
 * Supabase の query builder を模した最小限のフェイクで、
 * 「CAS 対象の状態 (例: status='scheduled') が .eq() 条件に必ず含まれるか」と
 * 「0 行更新 (他プロセスが既に処理済み) の場合に false/skip を返すか」を検証する。
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
  lte(): this {
    return this;
  }
  order(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  then<TResult1, TResult2>(
    onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.response).then(onfulfilled, onrejected);
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
  in(col: string, values: unknown): this {
    this.eqCalls.push([col, values]);
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
  selectResponse?: { data: unknown; error: unknown };
  updateResponses: Array<{ data: unknown; error: unknown }>;
  onUpdateEq?: (eqCalls: EqCall[], callIndex: number) => void;
}) {
  let updateCallIndex = 0;
  const client = {
    from() {
      return {
        select: () => new FakeSelectQuery(config.selectResponse ?? { data: [], error: null }),
        update: () => {
          const idx = updateCallIndex;
          updateCallIndex += 1;
          return new FakeUpdateQuery(config.updateResponses[idx], (eqCalls) =>
            config.onUpdateEq?.(eqCalls, idx),
          );
        },
      };
    },
  };
  return client as unknown as SupabaseClient;
}

describe("cancelScheduledChannelPost: CAS 条件 (scheduled → cancelled)", () => {
  it("id と status='scheduled' の両方を eq 条件に含める", async () => {
    const recordedEq: EqCall[] = [];
    const client = buildFakeClient({
      updateResponses: [{ data: { id: "post-1" }, error: null }],
      onUpdateEq: (eqCalls) => recordedEq.push(...eqCalls),
    });

    const result = await cancelScheduledChannelPost(client, "post-1");
    expect(result).toEqual({ ok: true, value: true });
    expect(recordedEq).toContainEqual(["id", "post-1"]);
    expect(recordedEq).toContainEqual(["status", "scheduled"]);
  });

  it("対象が既に他状態 (0 行更新) の場合は value=false を返す (二重処理防止)", async () => {
    const client = buildFakeClient({ updateResponses: [{ data: null, error: null }] });
    const result = await cancelScheduledChannelPost(client, "post-2");
    expect(result).toEqual({ ok: true, value: false });
  });
});

describe("retryFailedToScheduled: CAS 条件 (failed → scheduled)", () => {
  it("id と status='failed' の両方を eq 条件に含める", async () => {
    const recordedEq: EqCall[] = [];
    const client = buildFakeClient({
      updateResponses: [{ data: { id: "post-3" }, error: null }],
      onUpdateEq: (eqCalls) => recordedEq.push(...eqCalls),
    });

    const result = await retryFailedToScheduled(client, "post-3", "2026-07-08T00:00:00.000Z");
    expect(result).toEqual({ ok: true, value: true });
    expect(recordedEq).toContainEqual(["id", "post-3"]);
    expect(recordedEq).toContainEqual(["status", "failed"]);
  });
});

describe("claimNoteDraftCreating: CAS 条件 (none/failed/unknown → creating のみ許可。§8 MAJOR-3 実装レビューで発見・修正)", () => {
  it("id と note_draft_status in (none,failed,unknown) の両方を条件に含め、成功時は note_draft_status='creating'/note_draft_url=null へ更新する", async () => {
    const recordedEq: EqCall[] = [];
    let updatePayload: Record<string, unknown> | undefined;
    const client = {
      from() {
        return {
          update: (payload: Record<string, unknown>) => {
            updatePayload = payload;
            return new FakeUpdateQuery({ data: { id: "post-1" }, error: null }, (eqCalls) =>
              recordedEq.push(...eqCalls),
            );
          },
        };
      },
    } as unknown as SupabaseClient;

    const result = await claimNoteDraftCreating(client, "post-1");
    expect(result).toEqual({ ok: true, value: true });
    expect(recordedEq).toContainEqual(["id", "post-1"]);
    expect(recordedEq).toContainEqual(["note_draft_status", ["none", "failed", "unknown"]]);
    expect(updatePayload).toEqual({ note_draft_status: "creating", note_draft_url: null });
  });

  it("対象が既に他プロセスに creating を先取りされていた場合 (0 行更新) は value=false を返し、外部 API 呼び出し側が早期リターンできるようにする (二重作成防止)", async () => {
    const client = buildFakeClient({ updateResponses: [{ data: null, error: null }] });
    const result = await claimNoteDraftCreating(client, "post-2");
    expect(result).toEqual({ ok: true, value: false });
  });
});

describe("claimDueScheduledPosts: 候補選定 + 1 件ずつ CAS 取得", () => {
  it("候補 2 件のうち 1 件が他プロセスに先取りされていた場合、claim できたものだけ返す", async () => {
    const recordedEqPerCall: EqCall[][] = [];
    const client = buildFakeClient({
      selectResponse: { data: [{ id: "a" }, { id: "b" }], error: null },
      updateResponses: [
        { data: { id: "a", channel: "x", status: "publishing" }, error: null }, // a: claim 成功
        { data: null, error: null }, // b: 他プロセスが先取り (0 行)
      ],
      onUpdateEq: (eqCalls) => recordedEqPerCall.push(eqCalls),
    });

    const result = await claimDueScheduledPosts(client, 5);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((r) => r.id)).toEqual(["a"]);
    }
    // 両方の CAS 試行が status='scheduled' 条件で行われたことを確認
    for (const eqCalls of recordedEqPerCall) {
      expect(eqCalls).toContainEqual(["status", "scheduled"]);
    }
  });
});
