import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * canonical: docs/design/crm-suite/04-telephony.md §7.2 (契約外拡張 5 メソッド:
 * listCalls/getCallDetail/linkCallToCustomer/getTelephonySetupStatus/getCallAlertCounts) /
 * §7.1 (createRecordingPlaybackUrl の実装 — #59 でスタブから置き換え) / §8.2-8 (saveCallMemo)。
 *
 * tests/telephony-facade-retry.test.ts (retryCallJob) と同じ方針: repository / session /
 * platformFacade.isAdmin / crmFacade / settingsFacade / createSupabaseServiceClient を
 * モックし、facade.ts のロジック (admin gating・customer_name 解決・CAS 結果の crm 波及・
 * エラー伝播) のみを検証する。実 DB には触れない (単体テスト)。
 *
 * 【最重要観点 — 地雷: エラー握り潰し厳禁】repository/crm からのエラーが ok:true や
 * 0 件/null へ握り潰されず、正確に Result.ok=false として伝播することを中心に検証する。
 */

const sessionMock = vi.fn();
vi.mock("@/lib/supabase/session", () => ({
  getSessionAndClient: (...args: unknown[]) => sessionMock(...args),
}));

const isAdminMock = vi.fn();
vi.mock("@/modules/platform/facade", () => ({
  platformFacade: {
    isAdmin: (...args: unknown[]) => isAdminMock(...args),
    requireAdmin: vi.fn(),
  },
}));

const getCustomerRefMock = vi.fn();
const relinkActivityMock = vi.fn();
const appendActivityMock = vi.fn();
vi.mock("@/modules/crm/facade", () => ({
  crmFacade: {
    getCustomerRef: (...args: unknown[]) => getCustomerRefMock(...args),
    relinkActivity: (...args: unknown[]) => relinkActivityMock(...args),
    appendActivity: (...args: unknown[]) => appendActivityMock(...args),
  },
}));

const settingsGetMock = vi.fn();
vi.mock("@/modules/settings/facade", () => ({
  settingsFacade: {
    get: (...args: unknown[]) => settingsGetMock(...args),
  },
}));

const createSupabaseServiceClientMock = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: (...args: unknown[]) => createSupabaseServiceClientMock(...args),
}));

const listCallsPageMock = vi.fn();
const getCallByIdMock = vi.fn();
const listCallRecordingsByCallIdMock = vi.fn();
const listCallJobsByCallIdMock = vi.fn();
const linkCallToCustomerRowMock = vi.fn();
const countStaleCallJobsMock = vi.fn();
const countFailedCallJobsMock = vi.fn();
const countAmbiguousCallsMock = vi.fn();
const getCallRecordingByIdMock = vi.fn();
const updateCallMemoMock = vi.fn();

vi.mock("@/modules/telephony/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/telephony/repository")>();
  return {
    ...actual,
    listCallsPage: (...args: unknown[]) => listCallsPageMock(...args),
    getCallById: (...args: unknown[]) => getCallByIdMock(...args),
    listCallRecordingsByCallId: (...args: unknown[]) => listCallRecordingsByCallIdMock(...args),
    listCallJobsByCallId: (...args: unknown[]) => listCallJobsByCallIdMock(...args),
    linkCallToCustomerRow: (...args: unknown[]) => linkCallToCustomerRowMock(...args),
    countStaleCallJobs: (...args: unknown[]) => countStaleCallJobsMock(...args),
    countFailedCallJobs: (...args: unknown[]) => countFailedCallJobsMock(...args),
    countAmbiguousCalls: (...args: unknown[]) => countAmbiguousCallsMock(...args),
    getCallRecordingById: (...args: unknown[]) => getCallRecordingByIdMock(...args),
    updateCallMemo: (...args: unknown[]) => updateCallMemoMock(...args),
  };
});

import { telephonyFacade } from "@/modules/telephony/facade";
import type { CallListRow, CallRow } from "@/modules/telephony/repository";

const fakeClient = {} as SupabaseClient;
const ADMIN_USER = { id: "admin-1" };
const CALL_ID = "66666666-6666-6666-6666-666666666666";
const EXPECTED_UPDATED_AT = "2026-07-10T00:00:00.000000+00:00";

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

function makeCallListRow(overrides: Partial<CallListRow> & Pick<CallListRow, "id" | "started_at">): CallListRow {
  return { ...makeCallRow(overrides), job_status: null, ...overrides };
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  sessionMock.mockResolvedValue({ supabase: fakeClient, user: ADMIN_USER });
  isAdminMock.mockResolvedValue(true);
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  vi.unstubAllEnvs();
});

describe("契約外拡張 5 メソッド共通の admin gating (requireAdminClient — listCalls/linkCallToCustomer を代表として検証)", () => {
  it("未ログイン (user null) は KMB-E201 を返し repository を呼ばない", async () => {
    sessionMock.mockResolvedValue({ supabase: fakeClient, user: null });
    const result = await telephonyFacade.listCalls({ cursor: null });
    expect(result).toEqual({ ok: false, code: "KMB-E201" });
    expect(listCallsPageMock).not.toHaveBeenCalled();
  });

  it("認証済みだが非 admin は KMB-E202 を返し repository を呼ばない", async () => {
    isAdminMock.mockResolvedValue(false);
    const result = await telephonyFacade.listCalls({ cursor: null });
    expect(result).toEqual({ ok: false, code: "KMB-E202" });
    expect(listCallsPageMock).not.toHaveBeenCalled();
  });

  it("getSessionAndClient が例外を投げた場合は KMB-E901 へ変換する (握り潰さない)", async () => {
    sessionMock.mockRejectedValue(new Error("network down"));
    const result = await telephonyFacade.listCalls({ cursor: null });
    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "network down" });
  });

  it("書き込み系 (linkCallToCustomer) でも非 admin は KMB-E202 を返し repository を呼ばない", async () => {
    isAdminMock.mockResolvedValue(false);
    const result = await telephonyFacade.linkCallToCustomer(CALL_ID, "cust-1", EXPECTED_UPDATED_AT);
    expect(result).toEqual({ ok: false, code: "KMB-E202" });
    expect(getCallByIdMock).not.toHaveBeenCalled();
  });
});

describe("listCalls — customer_name 解決 (calls.customer_id 直 join 禁止・CrmFacade.getCustomerRef 経由)", () => {
  it("customer_id を持つ行は getCustomerRef の name を customer_name へ合成する", async () => {
    listCallsPageMock.mockResolvedValue({
      ok: true,
      value: { items: [makeCallListRow({ id: "call-1", started_at: "2026-07-10T00:00:00Z", customer_id: "cust-1" })], next_cursor: null },
    });
    getCustomerRefMock.mockResolvedValue({
      ok: true,
      value: { customer_id: "cust-1", name: "熊部太郎", kind: "person", company_id: null, tel_e164: null, email: null, address: null },
    });

    const result = await telephonyFacade.listCalls({ cursor: null });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.items[0]?.customer_name).toBe("熊部太郎");
    expect(getCustomerRefMock).toHaveBeenCalledWith("cust-1", { mode: "service" });
  });

  it("getCustomerRef が失敗した行は customer_name を null に degrade し、一覧全体は失敗させない (可用性優先)", async () => {
    listCallsPageMock.mockResolvedValue({
      ok: true,
      value: { items: [makeCallListRow({ id: "call-1", started_at: "2026-07-10T00:00:00Z", customer_id: "cust-x" })], next_cursor: null },
    });
    getCustomerRefMock.mockResolvedValue({ ok: false, code: "KMB-E603", detail: "not found" });

    const result = await telephonyFacade.listCalls({ cursor: null });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.items[0]?.customer_name).toBeNull();
      expect(result.value.items[0]?.customer_id).toBe("cust-x"); // customer_id 自体は保持 (顧客ページへのリンクは維持)
    }
    expect(consoleErrorSpy).toHaveBeenCalled(); // 失敗は握り潰さず可視化する
  });

  it("customer_id が null の行は getCustomerRef を呼ばず customer_name も null", async () => {
    listCallsPageMock.mockResolvedValue({
      ok: true,
      value: { items: [makeCallListRow({ id: "call-1", started_at: "2026-07-10T00:00:00Z", customer_id: null })], next_cursor: null },
    });

    const result = await telephonyFacade.listCalls({ cursor: null });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.items[0]?.customer_name).toBeNull();
    expect(getCustomerRefMock).not.toHaveBeenCalled();
  });

  it("重複する customer_id は getCustomerRef へ1回だけ解決する (Promise.all の重複除去)", async () => {
    listCallsPageMock.mockResolvedValue({
      ok: true,
      value: {
        items: [
          makeCallListRow({ id: "c1", started_at: "2026-07-10T00:00:00Z", customer_id: "cust-dup" }),
          makeCallListRow({ id: "c2", started_at: "2026-07-09T00:00:00Z", customer_id: "cust-dup" }),
        ],
        next_cursor: null,
      },
    });
    getCustomerRefMock.mockResolvedValue({
      ok: true,
      value: { customer_id: "cust-dup", name: "X", kind: "person", company_id: null, tel_e164: null, email: null, address: null },
    });

    await telephonyFacade.listCalls({ cursor: null });

    expect(getCustomerRefMock).toHaveBeenCalledTimes(1);
  });

  it("repository (listCallsPage) のエラーはそのまま伝播する (握り潰さない)", async () => {
    listCallsPageMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "db down" });

    const result = await telephonyFacade.listCalls({ cursor: null });

    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "db down" });
  });

  it("filter をそのまま repository へ渡す", async () => {
    listCallsPageMock.mockResolvedValue({ ok: true, value: { items: [], next_cursor: null } });

    await telephonyFacade.listCalls({ cursor: "abc", filter: { handling: "voicemail", needsReview: true, jobFailed: false } });

    expect(listCallsPageMock).toHaveBeenCalledWith(
      fakeClient,
      { handling: "voicemail", needsReview: true, jobFailed: false },
      { cursor: "abc", limit: 50 },
    );
  });

  it("CallListItemView (レビュー指摘是正 — §8.1): match_status/job_error_code/summary_preview を row から合成する", async () => {
    listCallsPageMock.mockResolvedValue({
      ok: true,
      value: {
        items: [
          makeCallListRow({
            id: "call-1",
            started_at: "2026-07-10T00:00:00Z",
            match_status: "ambiguous",
            job_status: "failed",
            job_error_code: "KMB-E823",
            job_analysis: {
              minutes: {
                summary: "これは40字を超える長い要約テキストのサンプルです。テストのためにわざと長くしています。",
                caller_intent: "inquiry",
                key_points: [],
                customer_name_guess: null,
                callback_required: false,
                callback_note: null,
              },
              tasks: [],
            },
          }),
        ],
        next_cursor: null,
      },
    });

    const result = await telephonyFacade.listCalls({ cursor: null });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const item = result.value.items[0];
    expect(item?.match_status).toBe("ambiguous");
    expect(item?.job_error_code).toBe("KMB-E823");
    expect(item?.summary_preview).toBe("これは40字を超える長い要約テキストのサンプルです。テストのためにわざと長くしています。".slice(0, 40) + "…");
  });

  it("CallListItemView: job_error_code/job_analysis 省略行 (job 無し) は null/null になる", async () => {
    listCallsPageMock.mockResolvedValue({
      ok: true,
      value: { items: [makeCallListRow({ id: "call-1", started_at: "2026-07-10T00:00:00Z" })], next_cursor: null },
    });

    const result = await telephonyFacade.listCalls({ cursor: null });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const item = result.value.items[0];
    expect(item?.job_error_code).toBeNull();
    expect(item?.summary_preview).toBeNull();
    expect(item?.match_status).toBe("pending"); // makeCallRow の既定値
  });
});

describe("getCallDetail", () => {
  it("通話が存在しない場合は KMB-E804 を返す", async () => {
    getCallByIdMock.mockResolvedValue({ ok: true, value: null });
    listCallRecordingsByCallIdMock.mockResolvedValue({ ok: true, value: [] });
    listCallJobsByCallIdMock.mockResolvedValue({ ok: true, value: [] });

    const result = await telephonyFacade.getCallDetail(CALL_ID);

    expect(result).toEqual({ ok: false, code: "KMB-E804", detail: expect.stringContaining(CALL_ID) });
  });

  it("最新 job (created_at 最大) の status を call.job_status の代表値として採用する", async () => {
    getCallByIdMock.mockResolvedValue({ ok: true, value: makeCallRow({ id: CALL_ID, started_at: "2026-07-10T00:00:00Z" }) });
    listCallRecordingsByCallIdMock.mockResolvedValue({ ok: true, value: [] });
    listCallJobsByCallIdMock.mockResolvedValue({
      ok: true,
      value: [
        { id: "j1", call_id: CALL_ID, recording_id: "r1", status: "done", transcript: null, analysis: null, link_result: null, transcript_partial: null, error_code: null, ai_cost_micro_usd: 0, stage_attempts: 0, lease_expires_at: null, created_at: "2026-07-10T00:00:01Z", updated_at: "2026-07-10T00:00:01Z" },
        { id: "j2", call_id: CALL_ID, recording_id: "r2", status: "failed", transcript: null, analysis: null, link_result: null, transcript_partial: null, error_code: "KMB-E821", ai_cost_micro_usd: 0, stage_attempts: 1, lease_expires_at: null, created_at: "2026-07-10T00:00:05Z", updated_at: "2026-07-10T00:00:05Z" },
      ],
    });

    const result = await telephonyFacade.getCallDetail(CALL_ID);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.call.job_status).toBe("failed"); // j2 (created_at 最大)
  });

  it("recordings 取得の失敗は握り潰さずそのまま伝播する", async () => {
    getCallByIdMock.mockResolvedValue({ ok: true, value: makeCallRow({ id: CALL_ID, started_at: "2026-07-10T00:00:00Z" }) });
    listCallRecordingsByCallIdMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "conn reset" });
    listCallJobsByCallIdMock.mockResolvedValue({ ok: true, value: [] });

    const result = await telephonyFacade.getCallDetail(CALL_ID);

    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "conn reset" });
  });

  it("customer_id を持つ通話は customer_name を getCustomerRef 経由で解決する", async () => {
    getCallByIdMock.mockResolvedValue({
      ok: true,
      value: makeCallRow({ id: CALL_ID, started_at: "2026-07-10T00:00:00Z", customer_id: "cust-1" }),
    });
    listCallRecordingsByCallIdMock.mockResolvedValue({ ok: true, value: [] });
    listCallJobsByCallIdMock.mockResolvedValue({ ok: true, value: [] });
    getCustomerRefMock.mockResolvedValue({
      ok: true,
      value: { customer_id: "cust-1", name: "熊部花子", kind: "person", company_id: null, tel_e164: null, email: null, address: null },
    });

    const result = await telephonyFacade.getCallDetail(CALL_ID);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.call.customer_name).toBe("熊部花子");
  });
});

describe("linkCallToCustomer (§7.2 — CAS 更新 + crm への波及)", () => {
  it("対象通話が存在しない場合は KMB-E804 を返し linkCallToCustomerRow は呼ばない", async () => {
    getCallByIdMock.mockResolvedValue({ ok: true, value: null });

    const result = await telephonyFacade.linkCallToCustomer(CALL_ID, "cust-1", EXPECTED_UPDATED_AT);

    expect(result).toEqual({ ok: false, code: "KMB-E804", detail: expect.stringContaining(CALL_ID) });
    expect(linkCallToCustomerRowMock).not.toHaveBeenCalled();
  });

  it("新旧 customerId が共に null の場合は crm に一切触れず ok:true を返す (解除操作の最適化)", async () => {
    getCallByIdMock.mockResolvedValue({ ok: true, value: makeCallRow({ id: CALL_ID, started_at: "2026-07-10T00:00:00Z", customer_id: null }) });
    linkCallToCustomerRowMock.mockResolvedValue({ ok: true, value: makeCallRow({ id: CALL_ID, started_at: "2026-07-10T00:00:00Z", customer_id: null }) });

    const result = await telephonyFacade.linkCallToCustomer(CALL_ID, null, EXPECTED_UPDATED_AT);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(listCallRecordingsByCallIdMock).not.toHaveBeenCalled();
    expect(appendActivityMock).not.toHaveBeenCalled();
  });

  it("新規紐づけ成功時 (appendActivity が created:true)、appendActivity の links には probe (新 customerId) を渡し、relinkActivity は呼ばない (レビュー指摘是正 — 無意味な『リンク付け替え』監査行を残さない)", async () => {
    getCallByIdMock.mockResolvedValue({ ok: true, value: makeCallRow({ id: CALL_ID, started_at: "2026-07-10T00:00:00Z", customer_id: null }) });
    linkCallToCustomerRowMock.mockResolvedValue({
      ok: true,
      value: makeCallRow({ id: CALL_ID, started_at: "2026-07-10T00:00:00Z", customer_id: "cust-new", duration_seconds: 45 }),
    });
    listCallRecordingsByCallIdMock.mockResolvedValue({ ok: true, value: [] });
    listCallJobsByCallIdMock.mockResolvedValue({ ok: true, value: [] });
    appendActivityMock.mockResolvedValue({ ok: true, value: { activity_id: "act-1", created: true } });

    const result = await telephonyFacade.linkCallToCustomer(CALL_ID, "cust-new", EXPECTED_UPDATED_AT);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(appendActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        activity_type: "call",
        ref_table: "calls",
        ref_id: CALL_ID,
        links: [{ customer_id: "cust-new", company_id: null, deal_id: null }],
      }),
      { mode: "service" },
    );
    expect(relinkActivityMock).not.toHaveBeenCalled();
  });

  it("付け替え成功時 (appendActivity が created:false — 既存 activity への冪等ヒット) は relinkActivity へ desiredLinks (同一顧客) を渡し全置換する", async () => {
    getCallByIdMock.mockResolvedValue({ ok: true, value: makeCallRow({ id: CALL_ID, started_at: "2026-07-10T00:00:00Z", customer_id: "cust-old" }) });
    linkCallToCustomerRowMock.mockResolvedValue({
      ok: true,
      value: makeCallRow({ id: CALL_ID, started_at: "2026-07-10T00:00:00Z", customer_id: "cust-new", duration_seconds: 45 }),
    });
    listCallRecordingsByCallIdMock.mockResolvedValue({ ok: true, value: [] });
    listCallJobsByCallIdMock.mockResolvedValue({ ok: true, value: [] });
    appendActivityMock.mockResolvedValue({ ok: true, value: { activity_id: "act-1", created: false } });
    relinkActivityMock.mockResolvedValue({ ok: true, value: undefined });

    const result = await telephonyFacade.linkCallToCustomer(CALL_ID, "cust-new", EXPECTED_UPDATED_AT);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(relinkActivityMock).toHaveBeenCalledWith(
      "act-1",
      [{ customer_id: "cust-new", company_id: null, deal_id: null }],
      { mode: "service" },
    );
  });

  it("解除操作 (customerId=null、旧 customer_id 非null) では probe に旧顧客を使い desiredLinks は空配列 (旧顧客のタイムラインから外れる)", async () => {
    getCallByIdMock.mockResolvedValue({ ok: true, value: makeCallRow({ id: CALL_ID, started_at: "2026-07-10T00:00:00Z", customer_id: "cust-old" }) });
    linkCallToCustomerRowMock.mockResolvedValue({
      ok: true,
      value: makeCallRow({ id: CALL_ID, started_at: "2026-07-10T00:00:00Z", customer_id: null }),
    });
    listCallRecordingsByCallIdMock.mockResolvedValue({ ok: true, value: [] });
    listCallJobsByCallIdMock.mockResolvedValue({ ok: true, value: [] });
    appendActivityMock.mockResolvedValue({ ok: true, value: { activity_id: "act-2", created: false } });
    relinkActivityMock.mockResolvedValue({ ok: true, value: undefined });

    const result = await telephonyFacade.linkCallToCustomer(CALL_ID, null, EXPECTED_UPDATED_AT);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(appendActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({ links: [{ customer_id: "cust-old", company_id: null, deal_id: null }] }),
      { mode: "service" },
    );
    expect(relinkActivityMock).toHaveBeenCalledWith("act-2", [], { mode: "service" });
  });

  it("appendActivity が失敗した場合は relinkActivity を呼ばずエラーを伝播する (握り潰さない)", async () => {
    getCallByIdMock.mockResolvedValue({ ok: true, value: makeCallRow({ id: CALL_ID, started_at: "2026-07-10T00:00:00Z", customer_id: null }) });
    linkCallToCustomerRowMock.mockResolvedValue({
      ok: true,
      value: makeCallRow({ id: CALL_ID, started_at: "2026-07-10T00:00:00Z", customer_id: "cust-new" }),
    });
    listCallRecordingsByCallIdMock.mockResolvedValue({ ok: true, value: [] });
    listCallJobsByCallIdMock.mockResolvedValue({ ok: true, value: [] });
    appendActivityMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "insert failed" });

    const result = await telephonyFacade.linkCallToCustomer(CALL_ID, "cust-new", EXPECTED_UPDATED_AT);

    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "insert failed" });
    expect(relinkActivityMock).not.toHaveBeenCalled();
  });

  it("relinkActivity が失敗した場合はエラーを伝播する (付け替え = appendActivity created:false のときのみ relinkActivity に到達する)", async () => {
    getCallByIdMock.mockResolvedValue({ ok: true, value: makeCallRow({ id: CALL_ID, started_at: "2026-07-10T00:00:00Z", customer_id: "cust-old" }) });
    linkCallToCustomerRowMock.mockResolvedValue({
      ok: true,
      value: makeCallRow({ id: CALL_ID, started_at: "2026-07-10T00:00:00Z", customer_id: "cust-new" }),
    });
    listCallRecordingsByCallIdMock.mockResolvedValue({ ok: true, value: [] });
    listCallJobsByCallIdMock.mockResolvedValue({ ok: true, value: [] });
    appendActivityMock.mockResolvedValue({ ok: true, value: { activity_id: "act-3", created: false } });
    relinkActivityMock.mockResolvedValue({ ok: false, code: "KMB-E603", detail: "customer not found" });

    const result = await telephonyFacade.linkCallToCustomer(CALL_ID, "cust-new", EXPECTED_UPDATED_AT);

    expect(result).toEqual({ ok: false, code: "KMB-E603", detail: "customer not found" });
  });

  it("linkCallToCustomerRow の CAS 不一致 (E103) はそのまま伝播し crm には一切触れない", async () => {
    getCallByIdMock.mockResolvedValue({ ok: true, value: makeCallRow({ id: CALL_ID, started_at: "2026-07-10T00:00:00Z", customer_id: null }) });
    linkCallToCustomerRowMock.mockResolvedValue({ ok: false, code: "KMB-E103", detail: "conflict" });

    const result = await telephonyFacade.linkCallToCustomer(CALL_ID, "cust-new", EXPECTED_UPDATED_AT);

    expect(result).toEqual({ ok: false, code: "KMB-E103", detail: "conflict" });
    expect(appendActivityMock).not.toHaveBeenCalled();
  });
});

describe("getTelephonySetupStatus (§8.3 — env/番号/転送/staleJobs)", () => {
  it("TWILIO env 未設定時は envConfigured:false を返す", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    settingsGetMock.mockResolvedValue({ ok: false, code: "KMB-E901" });
    countStaleCallJobsMock.mockResolvedValue({ ok: true, value: 0 });

    const result = await telephonyFacade.getTelephonySetupStatus();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.envConfigured).toBe(false);
  });

  it("TWILIO env 両方設定済みの場合は envConfigured:true を返す", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "secret");
    settingsGetMock.mockResolvedValue({ ok: false, code: "KMB-E901" });
    countStaleCallJobsMock.mockResolvedValue({ ok: true, value: 0 });

    const result = await telephonyFacade.getTelephonySetupStatus();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.envConfigured).toBe(true);
  });

  it("settings 未設定 (E901) は既定値へ degrade しエラーにしない (numberConfigured/forwardConfigured:false)", async () => {
    settingsGetMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "unset" });
    countStaleCallJobsMock.mockResolvedValue({ ok: true, value: 2 });

    const result = await telephonyFacade.getTelephonySetupStatus();

    expect(result).toEqual({
      ok: true,
      value: { envConfigured: expect.any(Boolean), numberConfigured: false, forwardConfigured: false, staleJobs: 2 },
    });
  });

  it("settings 取得成功時は電話番号/転送先の設定有無を反映する", async () => {
    settingsGetMock.mockResolvedValue({
      ok: true,
      value: {
        phone_number_e164: "+819012345678",
        twilio_number_sid: null,
        forward_to_e164: "+819087654321",
        consent_announcement_enabled: true,
        consent_announcement_text: null,
        in_hours_greeting_text: null,
        after_hours_greeting_text: null,
        voicemail_max_seconds: 120,
        delete_twilio_recording_after_download: true,
        max_processing_minutes: 30,
      },
    });
    countStaleCallJobsMock.mockResolvedValue({ ok: true, value: 0 });

    const result = await telephonyFacade.getTelephonySetupStatus();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.numberConfigured).toBe(true);
      expect(result.value.forwardConfigured).toBe(true);
    }
  });

  it("staleJobs クエリの失敗は握り潰さずそのまま伝播する", async () => {
    countStaleCallJobsMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "conn reset" });

    const result = await telephonyFacade.getTelephonySetupStatus();

    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "conn reset" });
  });
});

describe("getCallAlertCounts (§8.4 — failed/needsReview/stalled)", () => {
  it("3件数を正しく組み立てて返す", async () => {
    countFailedCallJobsMock.mockResolvedValue({ ok: true, value: 4 });
    countAmbiguousCallsMock.mockResolvedValue({ ok: true, value: 2 });
    countStaleCallJobsMock.mockResolvedValue({ ok: true, value: 1 });

    const result = await telephonyFacade.getCallAlertCounts();

    expect(result).toEqual({ ok: true, value: { failed: 4, needsReview: 2, stalled: 1 } });
  });

  it("failed 件数の取得が失敗した場合、0 へ丸めず握り潰さずそのまま伝播する", async () => {
    countFailedCallJobsMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "conn reset" });
    countAmbiguousCallsMock.mockResolvedValue({ ok: true, value: 0 });
    countStaleCallJobsMock.mockResolvedValue({ ok: true, value: 0 });

    const result = await telephonyFacade.getCallAlertCounts();

    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "conn reset" });
  });

  it("needsReview 件数の取得が失敗した場合も握り潰さずそのまま伝播する", async () => {
    countFailedCallJobsMock.mockResolvedValue({ ok: true, value: 0 });
    countAmbiguousCallsMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "conn reset" });
    countStaleCallJobsMock.mockResolvedValue({ ok: true, value: 0 });

    const result = await telephonyFacade.getCallAlertCounts();

    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "conn reset" });
  });

  it("stalled (staleJobs) は getTelephonySetupStatus と同一の countStaleCallJobs 結果を共有する (同一 query 規約)", async () => {
    countStaleCallJobsMock.mockResolvedValue({ ok: true, value: 7 });
    countFailedCallJobsMock.mockResolvedValue({ ok: true, value: 0 });
    countAmbiguousCallsMock.mockResolvedValue({ ok: true, value: 0 });
    settingsGetMock.mockResolvedValue({ ok: false, code: "KMB-E901" });

    const alertCounts = await telephonyFacade.getCallAlertCounts();
    const setupStatus = await telephonyFacade.getTelephonySetupStatus();

    expect(alertCounts.ok && alertCounts.value.stalled).toBe(7);
    expect(setupStatus.ok && setupStatus.value.staleJobs).toBe(7);
  });
});

describe("createRecordingPlaybackUrl (#59 — スタブから実装への置き換え)", () => {
  const RECORDING_ID = "77777777-7777-7777-7777-777777777777";

  function makeServiceClient(signedUrlResult: { data: { signedUrl: string } | null; error: { message: string } | null }) {
    const createSignedUrlMock = vi.fn().mockResolvedValue(signedUrlResult);
    const fromMock = vi.fn(() => ({ createSignedUrl: createSignedUrlMock }));
    return { client: { storage: { from: fromMock } } as unknown as SupabaseClient, fromMock, createSignedUrlMock };
  }

  it("録音が存在しない場合は KMB-E804 を返し service client を生成しない", async () => {
    getCallRecordingByIdMock.mockResolvedValue({ ok: true, value: null });

    const result = await telephonyFacade.createRecordingPlaybackUrl(RECORDING_ID);

    expect(result).toEqual({ ok: false, code: "KMB-E804", detail: expect.stringContaining(RECORDING_ID) });
    expect(createSupabaseServiceClientMock).not.toHaveBeenCalled();
  });

  it("storage_path が null (未ダウンロード) の場合は KMB-E805 を返す", async () => {
    getCallRecordingByIdMock.mockResolvedValue({
      ok: true,
      value: { id: RECORDING_ID, call_id: CALL_ID, recording_sid: "RE1", source: "dial", twilio_url: "https://x", duration_seconds: 10, channels: 2, storage_path: null, byte_size: null, twilio_deleted_at: null, created_at: "2026-07-10T00:00:00Z", updated_at: "2026-07-10T00:00:00Z" },
    });

    const result = await telephonyFacade.createRecordingPlaybackUrl(RECORDING_ID);

    expect(result).toEqual({ ok: false, code: "KMB-E805", detail: expect.any(String) });
    expect(createSupabaseServiceClientMock).not.toHaveBeenCalled();
  });

  it("service client 生成が例外を投げた場合は KMB-E901 へ変換する (握り潰さない)", async () => {
    getCallRecordingByIdMock.mockResolvedValue({
      ok: true,
      value: { id: RECORDING_ID, call_id: CALL_ID, recording_sid: "RE1", source: "dial", twilio_url: "https://x", duration_seconds: 10, channels: 2, storage_path: "calls/x.wav", byte_size: 100, twilio_deleted_at: null, created_at: "2026-07-10T00:00:00Z", updated_at: "2026-07-10T00:00:00Z" },
    });
    createSupabaseServiceClientMock.mockImplementation(() => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY 未設定");
    });

    const result = await telephonyFacade.createRecordingPlaybackUrl(RECORDING_ID);

    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "SUPABASE_SERVICE_ROLE_KEY 未設定" });
  });

  it("createSignedUrl がエラーを返した場合は KMB-E805 を返す", async () => {
    getCallRecordingByIdMock.mockResolvedValue({
      ok: true,
      value: { id: RECORDING_ID, call_id: CALL_ID, recording_sid: "RE1", source: "dial", twilio_url: "https://x", duration_seconds: 10, channels: 2, storage_path: "calls/x.wav", byte_size: 100, twilio_deleted_at: null, created_at: "2026-07-10T00:00:00Z", updated_at: "2026-07-10T00:00:00Z" },
    });
    const { client } = makeServiceClient({ data: null, error: { message: "object not found" } });
    createSupabaseServiceClientMock.mockReturnValue(client);

    const result = await telephonyFacade.createRecordingPlaybackUrl(RECORDING_ID);

    expect(result).toEqual({ ok: false, code: "KMB-E805", detail: "object not found" });
  });

  it("成功時は url と約600秒後の expires_at を返し、call-audio バケットへ 600 秒 TTL で問い合わせる", async () => {
    getCallRecordingByIdMock.mockResolvedValue({
      ok: true,
      value: { id: RECORDING_ID, call_id: CALL_ID, recording_sid: "RE1", source: "dial", twilio_url: "https://x", duration_seconds: 10, channels: 2, storage_path: "calls/x.wav", byte_size: 100, twilio_deleted_at: null, created_at: "2026-07-10T00:00:00Z", updated_at: "2026-07-10T00:00:00Z" },
    });
    const { client, fromMock, createSignedUrlMock } = makeServiceClient({
      data: { signedUrl: "https://signed.example/x.wav?token=abc" },
      error: null,
    });
    createSupabaseServiceClientMock.mockReturnValue(client);

    const before = Date.now();
    const result = await telephonyFacade.createRecordingPlaybackUrl(RECORDING_ID);
    const after = Date.now();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.url).toBe("https://signed.example/x.wav?token=abc");
    const expiresAtMs = new Date(result.value.expires_at).getTime();
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + 600_000);
    expect(expiresAtMs).toBeLessThanOrEqual(after + 600_000);
    expect(fromMock).toHaveBeenCalledWith("call-audio");
    expect(createSignedUrlMock).toHaveBeenCalledWith("calls/x.wav", 600);
  });
});

describe("saveCallMemo (§8.2-8 — 計画書未解決点#2 の追加実装分)", () => {
  it("成功時は ok:true / value:undefined を返す", async () => {
    updateCallMemoMock.mockResolvedValue({ ok: true, value: makeCallRow({ id: CALL_ID, started_at: "2026-07-10T00:00:00Z", memo: "折返し希望" }) });

    const result = await telephonyFacade.saveCallMemo(CALL_ID, "折返し希望", EXPECTED_UPDATED_AT);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(updateCallMemoMock).toHaveBeenCalledWith(fakeClient, CALL_ID, "折返し希望", EXPECTED_UPDATED_AT);
  });

  it("repository の KMB-E103 (楽観排他) をそのまま伝播する", async () => {
    updateCallMemoMock.mockResolvedValue({ ok: false, code: "KMB-E103", detail: "conflict" });

    const result = await telephonyFacade.saveCallMemo(CALL_ID, "memo", EXPECTED_UPDATED_AT);

    expect(result).toEqual({ ok: false, code: "KMB-E103", detail: "conflict" });
  });

  it("repository の KMB-E804 (通話不存在) をそのまま伝播する", async () => {
    updateCallMemoMock.mockResolvedValue({ ok: false, code: "KMB-E804", detail: "not found" });

    const result = await telephonyFacade.saveCallMemo(CALL_ID, null, EXPECTED_UPDATED_AT);

    expect(result).toEqual({ ok: false, code: "KMB-E804", detail: "not found" });
  });
});
