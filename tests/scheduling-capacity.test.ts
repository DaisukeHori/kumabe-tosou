import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/crm-suite/03-scheduling.md §7.2 (週間キャパシティ計算)。
 * 実装計画書 (worktree issue-53.md) §13.2 の必須ケース:
 *  JST 週境界 (月曜00:00丁度・日曜23:59) / 非拘束除外 / done 計上 / cancelled 除外 /
 *  負残 / 非月曜 E101 / キー欠落フォールバック (P28)。
 *
 * 3 層に分けて検証する (docker 無し運用 — 実 DB には接続しない):
 *  1. internal/capacity.ts の純関数 (isJstMonday / resolveWeekRangeJst / computeWeeklyCapacity)
 *  2. repository.getWeeklyBookedBlocks のクエリ形状 (「非拘束除外/done計上/cancelled除外」を
 *     実現しているのは SQL フィルタそのものなので、FakeChain でクエリビルダへの呼び出し引数を
 *     検証する — sales-repository.test.ts の FakeChain パターン踏襲)
 *  3. facade.getWeeklyCapacity の分岐 (非月曜 E101 / P28 フォールバック / repository 例外→E901)
 *
 * vi.mock はファイル内でホイストされるため、repository.ts 自体はこのファイル全体を通じて
 * 実体のまま使う (mock するのは createSupabaseServerClient (@/lib/supabase/server) と
 * settingsFacade (@/modules/settings/facade) の 2 つだけ) — 層 2 と層 3 で repository を
 * 部分モックし分けると、同一ファイル内の vi.mock ホイスト順序により層 2 が「モック済みの
 * getWeeklyBookedBlocks」を掴んでしまい、検証したいクエリ形状が一切実行されなくなる事故を防ぐ。
 */

import {
  computeWeeklyCapacity,
  isJstMonday,
  resolveWeekRangeJst,
} from "@/modules/scheduling/internal/capacity";

// ============================================================
// 1. internal/capacity.ts (純関数)
// ============================================================

describe("isJstMonday", () => {
  it("2026-07-13 (月曜) は true", () => {
    expect(isJstMonday("2026-07-13")).toBe(true);
  });
  it("2026-07-19 (日曜) は false", () => {
    expect(isJstMonday("2026-07-19")).toBe(false);
  });
  it("2026-07-14 (火曜) は false", () => {
    expect(isJstMonday("2026-07-14")).toBe(false);
  });
});

describe("resolveWeekRangeJst (JST 週境界: 月曜00:00丁度 ⇔ 次週月曜00:00丁度)", () => {
  it("2026-07-13 (月曜) → [2026-07-12T15:00:00.000Z, 2026-07-19T15:00:00.000Z) (JST 00:00 = UTC 前日15:00)", () => {
    const { startUtc, endUtc } = resolveWeekRangeJst("2026-07-13");
    expect(startUtc).toBe("2026-07-12T15:00:00.000Z");
    expect(endUtc).toBe("2026-07-19T15:00:00.000Z");
  });

  it("endUtc の 1ms 前が「日曜23:59」丁度側の境界 (次週月曜00:00 の直前) — 半開区間 [start, end) を保証する", () => {
    const { endUtc } = resolveWeekRangeJst("2026-07-13");
    const justBeforeEnd = new Date(new Date(endUtc).getTime() - 1);
    // JST では 2026-07-19 (日曜) 23:59:59.999 に相当する
    expect(justBeforeEnd.toISOString()).toBe("2026-07-19T14:59:59.999Z");
  });

  it("ちょうど 7 日間の範囲を返す", () => {
    const { startUtc, endUtc } = resolveWeekRangeJst("2026-07-13");
    const diffMs = new Date(endUtc).getTime() - new Date(startUtc).getTime();
    expect(diffMs).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("computeWeeklyCapacity (絞り込み済み配列の合算のみ — フィルタ責務は repository 側)", () => {
  it("booked_hours = Σ planned_hours (配置スパンではなく工数の合算)", () => {
    const result = computeWeeklyCapacity(40, [
      { planned_hours: 3 },
      { planned_hours: 6 },
      { planned_hours: 1.5 },
    ]);
    expect(result).toEqual({ weekly_hours: 40, booked_hours: 10.5, remaining_hours: 29.5 });
  });

  it("booked が空配列なら booked_hours=0, remaining_hours=weekly_hours", () => {
    const result = computeWeeklyCapacity(40, []);
    expect(result).toEqual({ weekly_hours: 40, booked_hours: 0, remaining_hours: 40 });
  });

  it("booked > weekly のとき remaining_hours は負値を許容する (P27)", () => {
    const result = computeWeeklyCapacity(10, [{ planned_hours: 8 }, { planned_hours: 5 }]);
    expect(result).toEqual({ weekly_hours: 10, booked_hours: 13, remaining_hours: -3 });
  });
});

// ============================================================
// 2 & 3. repository.getWeeklyBookedBlocks のクエリ形状 + facade.getWeeklyCapacity の分岐
// ============================================================

type PgResult = { data: unknown; error: unknown };

class FakeChain implements PromiseLike<PgResult> {
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  constructor(private readonly result: PgResult) {}
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
  gte(...a: unknown[]): this {
    return this.record("gte", a);
  }
  lt(...a: unknown[]): this {
    return this.record("lt", a);
  }
  then<T1 = PgResult, T2 = never>(
    onfulfilled?: ((value: PgResult) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

const createSupabaseServerClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: (...args: unknown[]) => createSupabaseServerClientMock(...args),
}));

const settingsGetMock = vi.fn();
vi.mock("@/modules/settings/facade", () => ({
  settingsFacade: { get: (...args: unknown[]) => settingsGetMock(...args) },
}));

import { getWeeklyBookedBlocks } from "@/modules/scheduling/repository";
import { createSchedulingFacade } from "@/modules/scheduling/facade";

function mockChain(result: PgResult): { chain: FakeChain; fromMock: ReturnType<typeof vi.fn> } {
  const chain = new FakeChain(result);
  const fromMock = vi.fn().mockReturnValue(chain);
  createSupabaseServerClientMock.mockResolvedValue({ from: fromMock });
  return { chain, fromMock };
}

describe("repository.getWeeklyBookedBlocks (クエリ形状)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("consumes_capacity=true (非拘束除外) と status in (scheduled,in_progress,done) (done計上・cancelled/backlog除外) と starts_at 範囲を SQL フィルタとして渡す", async () => {
    const { chain, fromMock } = mockChain({ data: [{ planned_hours: 3 }], error: null });

    const result = await getWeeklyBookedBlocks("2026-07-12T15:00:00.000Z", "2026-07-19T15:00:00.000Z");

    expect(fromMock).toHaveBeenCalledWith("work_blocks");
    expect(chain.calls).toEqual([
      { method: "select", args: ["planned_hours"] },
      { method: "eq", args: ["consumes_capacity", true] },
      { method: "in", args: ["status", ["scheduled", "in_progress", "done"]] },
      { method: "gte", args: ["starts_at", "2026-07-12T15:00:00.000Z"] },
      { method: "lt", args: ["starts_at", "2026-07-19T15:00:00.000Z"] },
    ]);
    expect(result).toEqual([{ planned_hours: 3 }]);
  });

  it("DB エラーは無言で空配列にせず例外として伝播する (エラー握り潰し禁止)", async () => {
    mockChain({ data: null, error: { message: "connection lost" } });
    await expect(
      getWeeklyBookedBlocks("2026-07-12T15:00:00.000Z", "2026-07-19T15:00:00.000Z"),
    ).rejects.toThrow("connection lost");
  });
});

describe("createSchedulingFacade().getWeeklyCapacity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("非月曜の weekStart は KMB-E101 を返し、repository を呼ばない (createSupabaseServerClient 未呼び出し)", async () => {
    const facade = createSchedulingFacade();
    const result = await facade.getWeeklyCapacity("2026-07-14"); // 火曜
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E101" }));
    expect(createSupabaseServerClientMock).not.toHaveBeenCalled();
  });

  it("settingsFacade.get 成功時は設定値の weekly_hours を使う", async () => {
    settingsGetMock.mockResolvedValue({ ok: true, value: { weekly_hours: 30 } });
    mockChain({ data: [{ planned_hours: 5 }], error: null });
    const facade = createSchedulingFacade();
    const result = await facade.getWeeklyCapacity("2026-07-13"); // 月曜
    expect(result).toEqual({
      ok: true,
      value: {
        week_start: "2026-07-13",
        weekly_hours: 30,
        booked_hours: 5,
        remaining_hours: 25,
      },
    });
  });

  it("settingsFacade.get 失敗時は {weekly_hours:40} にフォールバックする (P28、E101にしない)", async () => {
    settingsGetMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "settings down" });
    mockChain({ data: [], error: null });
    const facade = createSchedulingFacade();
    const result = await facade.getWeeklyCapacity("2026-07-13");
    expect(result).toEqual({
      ok: true,
      value: {
        week_start: "2026-07-13",
        weekly_hours: 40,
        booked_hours: 0,
        remaining_hours: 40,
      },
    });
  });

  it("repository が例外を投げたら KMB-E901 を返す (エラー握り潰し禁止)", async () => {
    settingsGetMock.mockResolvedValue({ ok: true, value: { weekly_hours: 40 } });
    mockChain({ data: null, error: { message: "db down" } });
    const facade = createSchedulingFacade();
    const result = await facade.getWeeklyCapacity("2026-07-13");
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E901" }));
  });
});
