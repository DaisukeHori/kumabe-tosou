import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: 実装計画書 issue-61.md 成果物4 (00-overview §6.2 行2、03-scheduling §5.4 行2)。
 *
 * proposeInProductionAction (src/app/admin/calendar/actions.ts) は「ブロック初回配置成功後、
 * 対象案件が stage='ordered' のときだけ『製作中に進めますか?』を提案する」薄い読み取り専用 Action。
 * 実際の stage 書き換えは既存 `updateDealStageAction` (deals/actions.ts) を呼び出し元 UI がそのまま
 * 使う設計のため、本 Action は「提案するかどうか」の判定のみを検証すれば足りる
 * (E602/E103 は updateDealStageAction 側の既存責務であり本ファイルでは再検証しない — 計画書どおり)。
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

// calendar/actions.ts はモジュール先頭で `const schedulingFacade = createSchedulingFacade();` を
// 実行する (他の多数の Action が使う) ため、実モジュール (server-only 依存) を読み込ませないよう
// 最小モックに差し替える。proposeInProductionAction 自体は schedulingFacade を一切呼ばない。
vi.mock("@/modules/scheduling/facade", () => ({
  createSchedulingFacade: () => ({}),
}));

import { proposeInProductionAction } from "@/app/admin/calendar/actions";

const ADMIN_OK = { ok: true as const, value: { userId: "admin-1" } };
const DEAL_ID = "77777777-7777-4777-8777-777777777777";

function makeDealRef(overrides: Partial<{ stage: string; updated_at: string }> = {}) {
  return {
    ok: true as const,
    value: {
      deal_id: DEAL_ID,
      title: "案件A",
      stage: "ordered",
      updated_at: "2026-07-10T00:00:00.000000+00:00",
      customer: { customer_id: "cust-1", name: "顧客A", kind: "person" as const, address: null },
      company: null,
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue(ADMIN_OK);
});

describe("proposeInProductionAction — admin gating", () => {
  it("requireAdmin が失敗した場合はそのまま返し getDealRef を呼ばない", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, code: "KMB-E201" });

    const result = await proposeInProductionAction(DEAL_ID);

    expect(result).toEqual({ ok: false, code: "KMB-E201" });
    expect(getDealRefMock).not.toHaveBeenCalled();
  });
});

describe("proposeInProductionAction — stage 分岐", () => {
  it("stage='ordered' のときのみ propose:true と現在の updated_at を返す", async () => {
    getDealRefMock.mockResolvedValue(makeDealRef({ stage: "ordered", updated_at: "2026-07-11T00:00:00.000000+00:00" }));

    const result = await proposeInProductionAction(DEAL_ID);

    expect(result).toEqual({
      ok: true,
      value: { propose: true, dealUpdatedAt: "2026-07-11T00:00:00.000000+00:00" },
    });
  });

  it.each(["in_production", "delivered", "invoiced", "paid", "lost", "inquiry", "estimating", "quote_sent"])(
    "stage='%s' (ordered 以外) は propose:false / dealUpdatedAt:null を返す (エラーではなく正常系の分岐)",
    async (stage) => {
      getDealRefMock.mockResolvedValue(makeDealRef({ stage }));

      const result = await proposeInProductionAction(DEAL_ID);

      expect(result).toEqual({ ok: true, value: { propose: false, dealUpdatedAt: null } });
    },
  );
});

describe("proposeInProductionAction — getDealRef 失敗時の Result 透過 (握り潰さない)", () => {
  it("getDealRef が失敗 (deal 参照不可等) したらそのまま Result を返す", async () => {
    getDealRefMock.mockResolvedValue({ ok: false, code: "KMB-E602", detail: "deal not found" });

    const result = await proposeInProductionAction(DEAL_ID);

    expect(result).toEqual({ ok: false, code: "KMB-E602", detail: "deal not found" });
  });
});
