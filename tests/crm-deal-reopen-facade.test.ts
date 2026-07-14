import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/crm-suite/01-crm.md §4.2 v1.2 / §6.2 (reopenDeal — Issue #102)。
 * crmFacade.reopenDeal の facade レベル検証 (canReopenDeal ガード + RPC 呼び出し + 監査 activity
 * 追記 + エラー握り潰し厳禁の回帰防止)。
 *
 * getSessionAndClient / crm/repository をモックし実 DB には接続しない
 * (tests/crm-timeline-facade-degrade.test.ts と同型パターン踏襲)。
 */

const getSessionAndClientMock = vi.fn();
vi.mock("@/lib/supabase/session", () => ({
  getSessionAndClient: (...args: unknown[]) => getSessionAndClientMock(...args),
}));

const getDealByIdMock = vi.fn();
const reopenDealMock = vi.fn();
const appendActivityRowMock = vi.fn();
const linkActivityRowMock = vi.fn();

vi.mock("@/modules/crm/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/crm/repository")>();
  return {
    ...actual,
    getDealById: (...args: unknown[]) => getDealByIdMock(...args),
    reopenDeal: (...args: unknown[]) => reopenDealMock(...args),
    appendActivityRow: (...args: unknown[]) => appendActivityRowMock(...args),
    linkActivityRow: (...args: unknown[]) => linkActivityRowMock(...args),
  };
});

import { crmFacade } from "@/modules/crm/facade";
import type { DealRow } from "@/modules/crm/repository";

const DEAL_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const ACTIVITY_ID = "44444444-4444-4444-8444-444444444444";

function dealRow(overrides: Partial<DealRow>): DealRow {
  return {
    id: DEAL_ID,
    title: "テスト案件",
    customer_id: CUSTOMER_ID,
    company_id: null,
    pipeline: "default",
    stage: "paid",
    amount_jpy: 100_000,
    expected_close_on: null,
    won_at: "2026-01-01T00:00:00.000Z",
    lost_reason: null,
    source: "manual",
    source_inquiry_id: null,
    notes: null,
    created_by: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("crmFacade.reopenDeal", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    getSessionAndClientMock.mockResolvedValue({ supabase: {}, user: { id: USER_ID } });
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("paid の案件を非終端ステージへ再開できる (RPC 呼び出し + 監査 activity 追記 + updated_at 返却)", async () => {
    getDealByIdMock.mockResolvedValue({ ok: true, value: dealRow({ stage: "paid" }) });
    reopenDealMock.mockResolvedValue({ ok: true, value: { new_updated_at: "2026-07-14T00:00:00.000Z" } });
    appendActivityRowMock.mockResolvedValue({ ok: true, value: { row: { id: ACTIVITY_ID }, created: true } });
    linkActivityRowMock.mockResolvedValue({ ok: true, value: { row: {}, created: true } });

    const result = await crmFacade.reopenDeal(
      DEAL_ID,
      { to_stage: "invoiced", reason: "誤って入金済みにしてしまった" },
      "2026-07-01T00:00:00.000Z",
    );

    expect(result).toEqual({ ok: true, value: { updated_at: "2026-07-14T00:00:00.000Z" } });

    expect(reopenDealMock).toHaveBeenCalledWith(
      {},
      DEAL_ID,
      "invoiced",
      "誤って入金済みにしてしまった",
      "2026-07-01T00:00:00.000Z",
    );

    // 監査 activity: ref_table/ref_id は null (冪等キーによる誤 dedup を避けるため — links のみで紐づける)
    expect(appendActivityRowMock).toHaveBeenCalledTimes(1);
    const [, activityInput, createdBy] = appendActivityRowMock.mock.calls[0];
    expect(activityInput).toMatchObject({
      activity_type: "system",
      ref_table: null,
      ref_id: null,
      payload: { code: "deal.reopened" },
    });
    expect(activityInput.payload.detail).toContain("誤って入金済みにしてしまった");
    expect(createdBy).toBe(USER_ID);

    expect(linkActivityRowMock).toHaveBeenCalledWith({}, ACTIVITY_ID, {
      customer_id: null,
      company_id: null,
      deal_id: DEAL_ID,
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("lost の案件も非終端ステージへ再開できる (lost_reason クリアは RPC 側の責務 — facade は関知しない)", async () => {
    getDealByIdMock.mockResolvedValue({ ok: true, value: dealRow({ stage: "lost", lost_reason: "価格が合わなかった" }) });
    reopenDealMock.mockResolvedValue({ ok: true, value: { new_updated_at: "2026-07-14T00:00:00.000Z" } });
    appendActivityRowMock.mockResolvedValue({ ok: true, value: { row: { id: ACTIVITY_ID }, created: true } });
    linkActivityRowMock.mockResolvedValue({ ok: true, value: { row: {}, created: true } });

    const result = await crmFacade.reopenDeal(
      DEAL_ID,
      { to_stage: "estimating", reason: "作り直し" },
      "2026-07-01T00:00:00.000Z",
    );

    expect(result.ok).toBe(true);
    expect(reopenDealMock).toHaveBeenCalledWith({}, DEAL_ID, "estimating", "作り直し", "2026-07-01T00:00:00.000Z");
  });

  it("非終端ステージからの再開は KMB-E609 (canReopenDeal ガードが RPC 呼び出し前に弾く)", async () => {
    getDealByIdMock.mockResolvedValue({ ok: true, value: dealRow({ stage: "estimating" }) });

    const result = await crmFacade.reopenDeal(
      DEAL_ID,
      { to_stage: "invoiced", reason: "理由" },
      "2026-07-01T00:00:00.000Z",
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("KMB-E609");
    expect(reopenDealMock).not.toHaveBeenCalled();
    expect(appendActivityRowMock).not.toHaveBeenCalled();
  });

  it("不正な入力 (to_stage が終端値/未知の値) は KMB-E101 を返し RPC を呼ばない", async () => {
    const result = await crmFacade.reopenDeal(
      DEAL_ID,
      // @ts-expect-error -- 'paid' は zReopenDealInput.to_stage の許容値 (非終端7) 外を検証する意図的な不正入力
      { to_stage: "paid", reason: "理由" },
      "2026-07-01T00:00:00.000Z",
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("KMB-E101");
    expect(getDealByIdMock).not.toHaveBeenCalled();
    expect(reopenDealMock).not.toHaveBeenCalled();
  });

  it("理由が空文字は KMB-E101 (zShortText の min(1) — UI 側の trim 前提と二重防御)", async () => {
    const result = await crmFacade.reopenDeal(
      DEAL_ID,
      { to_stage: "invoiced", reason: "" },
      "2026-07-01T00:00:00.000Z",
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("KMB-E101");
  });

  it("対象の案件が存在しない (null) 場合は KMB-E603 を返す", async () => {
    getDealByIdMock.mockResolvedValue({ ok: true, value: null });
    const result = await crmFacade.reopenDeal(
      DEAL_ID,
      { to_stage: "invoiced", reason: "理由" },
      "2026-07-01T00:00:00.000Z",
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("KMB-E603");
    expect(reopenDealMock).not.toHaveBeenCalled();
  });

  it("getDealById の DB エラーはそのまま Result として伝播する (空配列/ok:true への握り潰し禁止)", async () => {
    getDealByIdMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "db down" });
    const result = await crmFacade.reopenDeal(
      DEAL_ID,
      { to_stage: "invoiced", reason: "理由" },
      "2026-07-01T00:00:00.000Z",
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("KMB-E901");
    expect(reopenDealMock).not.toHaveBeenCalled();
  });

  it("RPC の失敗 (CAS 不一致など) はそのまま Result として伝播し、監査 activity は追記しない", async () => {
    getDealByIdMock.mockResolvedValue({ ok: true, value: dealRow({ stage: "paid" }) });
    reopenDealMock.mockResolvedValue({ ok: false, code: "KMB-E103", detail: "案件情報が他の操作で更新されています" });

    const result = await crmFacade.reopenDeal(
      DEAL_ID,
      { to_stage: "invoiced", reason: "理由" },
      "2026-07-01T00:00:00.000Z",
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("KMB-E103");
    expect(appendActivityRowMock).not.toHaveBeenCalled();
  });

  it("監査 activity 追記の失敗は console.warn のみで主操作 (再開) は成功のまま返す (握り潰さず明示ログ)", async () => {
    getDealByIdMock.mockResolvedValue({ ok: true, value: dealRow({ stage: "paid" }) });
    reopenDealMock.mockResolvedValue({ ok: true, value: { new_updated_at: "2026-07-14T00:00:00.000Z" } });
    appendActivityRowMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "insert failed" });

    const result = await crmFacade.reopenDeal(
      DEAL_ID,
      { to_stage: "invoiced", reason: "理由" },
      "2026-07-01T00:00:00.000Z",
    );

    expect(result).toEqual({ ok: true, value: { updated_at: "2026-07-14T00:00:00.000Z" } });
    expect(linkActivityRowMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("未ログインは KMB-E201 を返す", async () => {
    getSessionAndClientMock.mockResolvedValue({ supabase: {}, user: null });
    const result = await crmFacade.reopenDeal(
      DEAL_ID,
      { to_stage: "invoiced", reason: "理由" },
      "2026-07-01T00:00:00.000Z",
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("KMB-E201");
  });
});
