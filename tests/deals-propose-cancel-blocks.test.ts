import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: 実装計画書 issue-61.md 成果物4/10 (00-overview §6.2 行2、01-crm §7.3 行5、
 * 03-scheduling §5.4 行1)。
 *
 * getOpenBlockCountForDealAction (src/app/admin/calendar/actions.ts) は失注確定成功後の
 * 「未着手の作業ブロックを取り消しますか?」提案の事前件数取得用。schedulingFacade.getDealWorkSummary
 * の戻り値 (blocks: 全ステータス混在) から backlog/scheduled のみをフィルタして件数を返す
 * (in_progress/done/cancelled は対象外 — 受入基準どおり)。
 *
 * 実際の一括キャンセルは #53 で実装・export 済みの cancelOpenBlocksForDealAction をそのまま使う
 * 設計のため (計画書「乖離 B」)、本ファイルはそちら (既にテスト済み) を再テストしない。
 *
 * tests/calls-actions.test.ts の確立パターンを踏襲する。実 DB には一切触れない。
 */

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));

const requireAdminMock = vi.fn();
vi.mock("@/modules/platform/facade", () => ({
  platformFacade: { requireAdmin: (...args: unknown[]) => requireAdminMock(...args) },
}));

const getDealRefMock = vi.fn();
const listDealsMock = vi.fn();
vi.mock("@/modules/crm/facade", () => ({
  crmFacade: {
    getDealRef: (...args: unknown[]) => getDealRefMock(...args),
    listDeals: (...args: unknown[]) => listDealsMock(...args),
  },
}));

const getDealWorkSummaryMock = vi.fn();
// calendar/actions.ts はモジュール先頭で `const schedulingFacade = createSchedulingFacade();` を
// 実行するため、実モジュール (server-only 依存) を読み込ませないよう最小モックに差し替える。
// getOpenBlockCountForDealAction が実際に呼ぶのは getDealWorkSummary のみ。
vi.mock("@/modules/scheduling/facade", () => ({
  createSchedulingFacade: () => ({
    getDealWorkSummary: (...args: unknown[]) => getDealWorkSummaryMock(...args),
  }),
}));

import { getOpenBlockCountForDealAction } from "@/app/admin/calendar/actions";

const ADMIN_OK = { ok: true as const, value: { userId: "admin-1" } };
const DEAL_ID = "88888888-8888-4888-8888-888888888888";

type BlockStub = { id: string; work_type_label: string; status: string; planned_hours: number; actual_hours: number | null; performed_on: string | null };

function block(status: string, id = `block-${status}`): BlockStub {
  return { id, work_type_label: "切断", status, planned_hours: 1, actual_hours: null, performed_on: null };
}

function summaryWith(blocks: BlockStub[]) {
  return {
    ok: true as const,
    value: {
      deal_id: DEAL_ID,
      planned_total_hours: blocks.reduce((s, b) => s + b.planned_hours, 0),
      actual_total_hours: 0,
      done_count: blocks.filter((b) => b.status === "done").length,
      open_count: blocks.filter((b) => ["backlog", "scheduled", "in_progress"].includes(b.status)).length,
      blocks,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue(ADMIN_OK);
});

describe("getOpenBlockCountForDealAction — admin gating", () => {
  it("requireAdmin が失敗した場合はそのまま返し getDealWorkSummary を呼ばない", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, code: "KMB-E201" });

    const result = await getOpenBlockCountForDealAction(DEAL_ID);

    expect(result).toEqual({ ok: false, code: "KMB-E201" });
    expect(getDealWorkSummaryMock).not.toHaveBeenCalled();
  });
});

describe("getOpenBlockCountForDealAction — backlog/scheduled のみをカウントする", () => {
  it("backlog + scheduled の件数のみを合算する (in_progress/done/cancelled は除外)", async () => {
    getDealWorkSummaryMock.mockResolvedValue(
      summaryWith([
        block("backlog"),
        block("scheduled"),
        block("in_progress"),
        block("done"),
        block("cancelled"),
      ]),
    );

    const result = await getOpenBlockCountForDealAction(DEAL_ID);

    expect(result).toEqual({ ok: true, value: { count: 2 } });
  });

  it("backlog/scheduled が1件も無ければ count:0 を返す", async () => {
    getDealWorkSummaryMock.mockResolvedValue(summaryWith([block("in_progress"), block("done")]));

    const result = await getOpenBlockCountForDealAction(DEAL_ID);

    expect(result).toEqual({ ok: true, value: { count: 0 } });
  });

  it("blocks が空配列でも count:0 を返す", async () => {
    getDealWorkSummaryMock.mockResolvedValue(summaryWith([]));

    const result = await getOpenBlockCountForDealAction(DEAL_ID);

    expect(result).toEqual({ ok: true, value: { count: 0 } });
  });

  it("backlog/scheduled が複数件あれば正しく合算する", async () => {
    getDealWorkSummaryMock.mockResolvedValue(
      summaryWith([
        block("backlog", "b1"),
        block("backlog", "b2"),
        block("scheduled", "b3"),
        block("scheduled", "b4"),
        block("scheduled", "b5"),
      ]),
    );

    const result = await getOpenBlockCountForDealAction(DEAL_ID);

    expect(result).toEqual({ ok: true, value: { count: 5 } });
  });
});

describe("getOpenBlockCountForDealAction — getDealWorkSummary 失敗時の Result 透過 (握り潰さない)", () => {
  it("getDealWorkSummary が失敗したらそのまま Result を返す (count:0 に偽装しない)", async () => {
    getDealWorkSummaryMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "db down" });

    const result = await getOpenBlockCountForDealAction(DEAL_ID);

    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "db down" });
  });
});
