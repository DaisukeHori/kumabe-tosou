import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/crm-suite/03-scheduling.md §6.1 (recordActual) / §7.3 (実績確定と
 * work_log activity 連携) / §5.1 (状態機械 — backlog/cancelled への実績入力は KMB-E705)。
 *
 * 実 DB 接続なしの facade 単体テスト (docker 無し運用 — worktree 実装計画書テスト戦略の
 * 「結合 = repository をモックした facade 単体テスト」方針どおり。scheduling-facade.test.ts
 * と同型)。repository.ts の型付き例外は importOriginal で実体を残し、getWorkBlockById /
 * recordWorkBlockActual のみ差し替える。crmFacade.appendActivity は vi.mock で完全に差し替える
 * (sales-facade.test.ts の crmFacade モックパターン踏襲)。
 *
 * 対象 (実装計画書 §13.2):
 *  - recordActual → crmFacade.appendActivity 呼び出し確認 (初回確定)
 *  - 二重確定 (旧 status === 'done') で appendActivity 非呼び出し確認
 *  - deal_id NULL で appendActivity スキップ確認
 *  - backlog/cancelled への実績入力で KMB-E705
 *  - appendActivity 失敗時も recordActual 自体は ok:true (エラーはログのみ — §7.3 で明記された
 *    唯一の例外的握り潰し。console.error で必ずログが残ることも確認し、無言化していないことを担保する)
 */

const getWorkBlockByIdMock = vi.fn();
const recordWorkBlockActualMock = vi.fn();
vi.mock("@/modules/scheduling/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/scheduling/repository")>();
  return {
    ...actual,
    getWorkBlockById: (...args: unknown[]) => getWorkBlockByIdMock(...args),
    recordWorkBlockActual: (...args: unknown[]) => recordWorkBlockActualMock(...args),
  };
});

const appendActivityMock = vi.fn();
vi.mock("@/modules/crm/facade", () => ({
  crmFacade: {
    appendActivity: (...args: unknown[]) => appendActivityMock(...args),
  },
}));

import { createSchedulingFacade } from "@/modules/scheduling/facade";
import { OptimisticLockError } from "@/modules/scheduling/repository";
import type { WorkBlockStatus } from "@/modules/scheduling/contracts";
import type { WorkBlockJoinRow } from "@/modules/scheduling/repository";

const BLOCK_ID = "11111111-1111-4111-8111-111111111111";
const DEAL_ID = "22222222-2222-4222-a222-222222222222";
const EXPECTED_UPDATED_AT = "2026-01-01T00:00:00.000Z";

function blockRow(overrides: Partial<WorkBlockJoinRow> = {}): WorkBlockJoinRow {
  return {
    id: BLOCK_ID,
    deal_id: DEAL_ID,
    source_document_id: null,
    work_type_id: "33333333-3333-4333-b333-333333333333",
    title: "研磨",
    status: "scheduled",
    starts_at: "2026-07-13T00:00:00.000Z",
    ends_at: "2026-07-13T03:00:00.000Z",
    planned_hours: 3,
    actual_hours: null,
    performed_on: null,
    consumes_capacity: true,
    quantity: null,
    memo: null,
    updated_at: EXPECTED_UPDATED_AT,
    work_types: { key: "sanding", label: "研磨", color: "#8d6e63" },
    ...overrides,
  };
}

function actualInput(overrides: { actual_hours?: number; performed_on?: string } = {}) {
  return { actual_hours: 2.5, performed_on: "2026-07-13", ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  recordWorkBlockActualMock.mockResolvedValue({ updated_at: "2026-07-13T04:00:00.000Z" });
});

describe("createSchedulingFacade().recordActual — appendActivity 連携", () => {
  it("初回確定 (旧status='scheduled', deal_id 非NULL) は crmFacade.appendActivity を正しい入力で呼ぶ", async () => {
    getWorkBlockByIdMock.mockResolvedValue(blockRow({ status: "scheduled" }));
    appendActivityMock.mockResolvedValue({ ok: true, value: { activity_id: "act-1", created: true } });

    const facade = createSchedulingFacade();
    const result = await facade.recordActual(BLOCK_ID, actualInput(), EXPECTED_UPDATED_AT);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(recordWorkBlockActualMock).toHaveBeenCalledWith(BLOCK_ID, 2.5, "2026-07-13", EXPECTED_UPDATED_AT);
    expect(appendActivityMock).toHaveBeenCalledTimes(1);
    expect(appendActivityMock).toHaveBeenCalledWith({
      activity_type: "work_log",
      occurred_at: "2026-07-13T12:00:00+09:00",
      title: "作業実績: 研磨",
      body: null,
      payload: {
        work_block_id: BLOCK_ID,
        work_type_key: "sanding",
        work_type_label: "研磨",
        planned_hours: 3,
        actual_hours: 2.5,
        performed_on: "2026-07-13",
      },
      ref_table: "work_blocks",
      ref_id: BLOCK_ID,
      links: [{ customer_id: null, company_id: null, deal_id: DEAL_ID }],
    });
  });

  it("in_progress からの初回確定でも appendActivity を呼ぶ", async () => {
    getWorkBlockByIdMock.mockResolvedValue(blockRow({ status: "in_progress" }));
    appendActivityMock.mockResolvedValue({ ok: true, value: { activity_id: "act-1", created: true } });

    const facade = createSchedulingFacade();
    const result = await facade.recordActual(BLOCK_ID, actualInput(), EXPECTED_UPDATED_AT);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(appendActivityMock).toHaveBeenCalledTimes(1);
  });

  it("二重確定 (旧status='done' — 実績訂正) では appendActivity を呼ばない", async () => {
    getWorkBlockByIdMock.mockResolvedValue(
      blockRow({ status: "done", actual_hours: 2, performed_on: "2026-07-12" }),
    );

    const facade = createSchedulingFacade();
    const result = await facade.recordActual(BLOCK_ID, actualInput(), EXPECTED_UPDATED_AT);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(recordWorkBlockActualMock).toHaveBeenCalledTimes(1);
    expect(appendActivityMock).not.toHaveBeenCalled();
  });

  it("deal_id が NULL のブロックは初回確定でも appendActivity を呼ばない (スキップ)", async () => {
    getWorkBlockByIdMock.mockResolvedValue(blockRow({ status: "scheduled", deal_id: null }));

    const facade = createSchedulingFacade();
    const result = await facade.recordActual(BLOCK_ID, actualInput(), EXPECTED_UPDATED_AT);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(appendActivityMock).not.toHaveBeenCalled();
  });

  it("appendActivity が失敗しても recordActual 自体は ok:true のまま (実績確定は既に成立済み)、ただし console.error でログは必ず残す (無言握り潰し禁止)", async () => {
    getWorkBlockByIdMock.mockResolvedValue(blockRow({ status: "scheduled" }));
    appendActivityMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "crm down" });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const facade = createSchedulingFacade();
    const result = await facade.recordActual(BLOCK_ID, actualInput(), EXPECTED_UPDATED_AT);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0]?.[0]).toContain(BLOCK_ID);
    expect(consoleErrorSpy.mock.calls[0]?.[0]).toContain("KMB-E901");
    consoleErrorSpy.mockRestore();
  });
});

describe("createSchedulingFacade().recordActual — 状態遷移ガード (§5.1)", () => {
  it.each<WorkBlockStatus>(["backlog", "cancelled"])(
    "%s への実績入力は KMB-E705 を返し、recordWorkBlockActual / appendActivity は呼ばれない",
    async (status) => {
      getWorkBlockByIdMock.mockResolvedValue(blockRow({ status }));

      const facade = createSchedulingFacade();
      const result = await facade.recordActual(BLOCK_ID, actualInput(), EXPECTED_UPDATED_AT);

      expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E705" }));
      expect(recordWorkBlockActualMock).not.toHaveBeenCalled();
      expect(appendActivityMock).not.toHaveBeenCalled();
    },
  );

  it("対象ブロックが存在しない場合は KMB-E109 を返す", async () => {
    getWorkBlockByIdMock.mockResolvedValue(null);

    const facade = createSchedulingFacade();
    const result = await facade.recordActual(BLOCK_ID, actualInput(), EXPECTED_UPDATED_AT);

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E109" }));
    expect(recordWorkBlockActualMock).not.toHaveBeenCalled();
  });

  it("Zod parse 失敗 (actual_hours が負) は KMB-E101 を返し、DB 読み取りすら行わない", async () => {
    const facade = createSchedulingFacade();
    const result = await facade.recordActual(BLOCK_ID, actualInput({ actual_hours: -1 }), EXPECTED_UPDATED_AT);

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E101" }));
    expect(getWorkBlockByIdMock).not.toHaveBeenCalled();
  });

  it("楽観排他違反 (OptimisticLockError) は KMB-E103 を返す", async () => {
    getWorkBlockByIdMock.mockResolvedValue(blockRow({ status: "scheduled" }));
    recordWorkBlockActualMock.mockRejectedValue(new OptimisticLockError());

    const facade = createSchedulingFacade();
    const result = await facade.recordActual(BLOCK_ID, actualInput(), EXPECTED_UPDATED_AT);

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E103" }));
    expect(appendActivityMock).not.toHaveBeenCalled();
  });

  it("想定外の例外は KMB-E901 に変換する (エラー握り潰し禁止)", async () => {
    getWorkBlockByIdMock.mockResolvedValue(blockRow({ status: "scheduled" }));
    recordWorkBlockActualMock.mockRejectedValue(new Error("db down"));

    const facade = createSchedulingFacade();
    const result = await facade.recordActual(BLOCK_ID, actualInput(), EXPECTED_UPDATED_AT);

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "KMB-E901" }));
  });
});
