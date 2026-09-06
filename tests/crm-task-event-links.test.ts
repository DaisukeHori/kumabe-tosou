import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/crm-suite/01-crm.md §4.3 / §6.1 (completeTask / cancelTask —
 * task_event(completed|cancelled) 追記)。
 *
 * completeTask / cancelTask が追記する task_event activity を、createTask と同様に task の
 * customer_id / deal_id へ activity_links で紐づけることを検証する (紐づけが無いと顧客/案件
 * タイムラインに完了・取消が現れない regression の防止)。
 * getSessionAndClient / crm/repository をモックし実 DB には接続しない
 * (tests/crm-deal-reopen-facade.test.ts と同型パターン踏襲)。
 */

const getSessionAndClientMock = vi.fn();
vi.mock("@/lib/supabase/session", () => ({
  getSessionAndClient: (...args: unknown[]) => getSessionAndClientMock(...args),
}));

const getTaskByIdMock = vi.fn();
const updateTaskWithCasMock = vi.fn();
const appendActivityRowMock = vi.fn();
const linkActivityRowMock = vi.fn();

vi.mock("@/modules/crm/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/crm/repository")>();
  return {
    ...actual,
    getTaskById: (...args: unknown[]) => getTaskByIdMock(...args),
    updateTaskWithCas: (...args: unknown[]) => updateTaskWithCasMock(...args),
    appendActivityRow: (...args: unknown[]) => appendActivityRowMock(...args),
    linkActivityRow: (...args: unknown[]) => linkActivityRowMock(...args),
  };
});

import { crmFacade } from "@/modules/crm/facade";
import type { TaskRow } from "@/modules/crm/repository";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";
const DEAL_ID = "55555555-5555-4555-8555-555555555555";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const ACTIVITY_ID = "44444444-4444-4444-8444-444444444444";
const UPDATED_AT = "2026-07-01T00:00:00.000Z";

function taskRow(overrides: Partial<TaskRow>): TaskRow {
  return {
    id: TASK_ID,
    title: "折り返し電話",
    body: null,
    due_on: null,
    status: "open",
    origin: "manual",
    deal_id: null,
    customer_id: null,
    source_activity_id: null,
    completed_at: null,
    created_by: USER_ID,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: UPDATED_AT,
    ...overrides,
  };
}

describe.each([
  ["completeTask", "completed", (id: string, at: string) => crmFacade.completeTask(id, at)] as const,
  ["cancelTask", "cancelled", (id: string, at: string) => crmFacade.cancelTask(id, at)] as const,
])("crmFacade.%s の task_event リンク", (_name, event, call) => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionAndClientMock.mockResolvedValue({ supabase: {}, user: { id: USER_ID } });
    updateTaskWithCasMock.mockResolvedValue({ ok: true, value: undefined });
    appendActivityRowMock.mockResolvedValue({ ok: true, value: { row: { id: ACTIVITY_ID }, created: true } });
    linkActivityRowMock.mockResolvedValue({ ok: true, value: { row: {}, created: true } });
  });

  it(`customer_id と deal_id の両方を持つ task → task_event(${event}) を顧客と案件の両方へリンクする`, async () => {
    getTaskByIdMock.mockResolvedValue({ ok: true, value: taskRow({ customer_id: CUSTOMER_ID, deal_id: DEAL_ID }) });

    const result = await call(TASK_ID, UPDATED_AT);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(appendActivityRowMock).toHaveBeenCalledTimes(1);
    expect(appendActivityRowMock.mock.calls[0][1]).toMatchObject({
      activity_type: "task_event",
      payload: { task_id: TASK_ID, event, origin: "manual" },
    });
    expect(linkActivityRowMock).toHaveBeenCalledTimes(2);
    expect(linkActivityRowMock).toHaveBeenNthCalledWith(1, {}, ACTIVITY_ID, {
      customer_id: CUSTOMER_ID,
      company_id: null,
      deal_id: null,
    });
    expect(linkActivityRowMock).toHaveBeenNthCalledWith(2, {}, ACTIVITY_ID, {
      customer_id: null,
      company_id: null,
      deal_id: DEAL_ID,
    });
  });

  it("customer_id のみの task → 顧客リンクだけ", async () => {
    getTaskByIdMock.mockResolvedValue({ ok: true, value: taskRow({ customer_id: CUSTOMER_ID }) });

    const result = await call(TASK_ID, UPDATED_AT);

    expect(result.ok).toBe(true);
    expect(linkActivityRowMock).toHaveBeenCalledTimes(1);
    expect(linkActivityRowMock.mock.calls[0][2]).toEqual({ customer_id: CUSTOMER_ID, company_id: null, deal_id: null });
  });

  it("紐づけの無い task → リンクしない", async () => {
    getTaskByIdMock.mockResolvedValue({ ok: true, value: taskRow({}) });

    const result = await call(TASK_ID, UPDATED_AT);

    expect(result.ok).toBe(true);
    expect(linkActivityRowMock).not.toHaveBeenCalled();
  });

  it("リンク失敗はそのまま伝播する (エラー握り潰し厳禁)", async () => {
    getTaskByIdMock.mockResolvedValue({ ok: true, value: taskRow({ customer_id: CUSTOMER_ID }) });
    linkActivityRowMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "boom" });

    const result = await call(TASK_ID, UPDATED_AT);

    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "boom" });
  });

  it("遷移しないケース (done→done は no-op / cancelled は終端 E606) では activity 追記もリンクもしない", async () => {
    getTaskByIdMock.mockResolvedValue({
      ok: true,
      value: taskRow({ status: event === "completed" ? "done" : "cancelled", customer_id: CUSTOMER_ID }),
    });

    const result = await call(TASK_ID, UPDATED_AT);

    // §4.3: done→done は no-op ok、cancelled→cancelled は終端からの遷移なので KMB-E606
    expect(result).toEqual(event === "completed" ? { ok: true, value: undefined } : { ok: false, code: "KMB-E606" });
    expect(appendActivityRowMock).not.toHaveBeenCalled();
    expect(linkActivityRowMock).not.toHaveBeenCalled();
  });
});
