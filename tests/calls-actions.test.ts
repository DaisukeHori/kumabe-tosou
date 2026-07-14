import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/crm-suite/04-telephony.md §7.4 (Server Actions 契約表)。
 * 計画書 issue-59.md テスト戦略: 「normalizeJpPhoneToE164 を通した action の正規化ロジックは
 * 新規 tests/calls-actions.test.ts (or 既存 telephony-contracts.test.ts に統合) で境界値確認」。
 *
 * tests/visual-actions.test.ts の確立パターン (next/cache・platformFacade.requireAdmin・
 * facade 群を最小フェイクに差し替え、actions.ts のロジックのみ検証) を踏襲する。
 * src/app/admin/calls/actions.ts はどれも Server Action だが "use server" は vitest 実行時には
 * 単なるモジュールとして扱われるため、直接 import してテストできる。実 DB には触れない。
 */

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));

const requireAdminMock = vi.fn();
vi.mock("@/modules/platform/facade", () => ({
  platformFacade: { requireAdmin: (...args: unknown[]) => requireAdminMock(...args) },
}));

const retryCallJobMock = vi.fn();
const createRecordingPlaybackUrlMock = vi.fn();
const linkCallToCustomerMock = vi.fn();
const getCallDetailMock = vi.fn();
const saveCallMemoMock = vi.fn();
vi.mock("@/modules/telephony/facade", () => ({
  telephonyFacade: {
    retryCallJob: (...args: unknown[]) => retryCallJobMock(...args),
    createRecordingPlaybackUrl: (...args: unknown[]) => createRecordingPlaybackUrlMock(...args),
    linkCallToCustomer: (...args: unknown[]) => linkCallToCustomerMock(...args),
    getCallDetail: (...args: unknown[]) => getCallDetailMock(...args),
    saveCallMemo: (...args: unknown[]) => saveCallMemoMock(...args),
  },
}));

const listCustomersMock = vi.fn();
const createCustomerMock = vi.fn();
vi.mock("@/modules/crm/facade", () => ({
  crmFacade: {
    listCustomers: (...args: unknown[]) => listCustomersMock(...args),
    createCustomer: (...args: unknown[]) => createCustomerMock(...args),
  },
}));

const submitSettingsFormMock = vi.fn();
vi.mock("@/app/admin/settings/actions", () => ({
  submitSettingsForm: (...args: unknown[]) => submitSettingsFormMock(...args),
}));

import {
  createCustomerForCallAction,
  createPlaybackUrlAction,
  linkCallToCustomerAction,
  retryCallJobAction,
  retryLatestFailedCallJobAction,
  saveBusinessHoursAction,
  saveCallMemoAction,
  saveTelephonySettingsAction,
  searchCustomersForLinkAction,
} from "@/app/admin/calls/actions";
import { SETTINGS_FORM_INITIAL_STATE } from "@/app/admin/settings/form-state";

const ADMIN_OK = { ok: true as const, value: { userId: "admin-1" } };
// zod z.string().uuid() は third group が [1-8]、fourth group が [89abAB] 始まりを要求する
// (RFC 4122 version/variant 相当) — 単純な全同一文字の羅列は弾かれるため version=4/variant=8 の
// 実在しうる形に揃える。
const CALL_ID = "11111111-1111-4111-8111-111111111111";
const CALL_JOB_ID = "22222222-2222-4222-8222-222222222222";
const RECORDING_ID = "33333333-3333-4333-8333-333333333333";
const CUSTOMER_ID = "44444444-4444-4444-8444-444444444444";
const EXPECTED_UPDATED_AT = "2026-07-10T00:00:00.000000+00:00";

/** 電話タブフォームの必須フィールドを埋めた FormData を作る (phone_number_e164/forward_to_e164 は上書き用に空)。 */
function makeTelephonyFormData(overrides: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set("phone_number_e164", "");
  fd.set("forward_to_e164", "");
  fd.set("twilio_number_sid", "");
  fd.set("consent_announcement_text", "");
  fd.set("in_hours_greeting_text", "");
  fd.set("after_hours_greeting_text", "");
  fd.set("voicemail_max_seconds", "120");
  fd.set("max_processing_minutes", "30");
  fd.set("expected_updated_at", EXPECTED_UPDATED_AT);
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue(ADMIN_OK);
});

describe("admin gating と Zod validation (代表ケースで全アクション共通の枠組みを確認)", () => {
  it("requireAdmin が失敗した場合はそのまま返し facade を一切呼ばない (linkCallToCustomerAction で代表確認)", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, code: "KMB-E201" });

    const result = await linkCallToCustomerAction({ callId: CALL_ID, customerId: CUSTOMER_ID, expectedUpdatedAt: EXPECTED_UPDATED_AT });

    expect(result).toEqual({ ok: false, code: "KMB-E201" });
    expect(linkCallToCustomerMock).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("非 admin (E202) も同様に facade を呼ばない", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, code: "KMB-E202" });

    const result = await retryCallJobAction({ callJobId: CALL_JOB_ID });

    expect(result).toEqual({ ok: false, code: "KMB-E202" });
    expect(retryCallJobMock).not.toHaveBeenCalled();
  });

  it("不正な入力 (uuid でない callJobId) は KMB-E101 を返す (retryCallJobAction で代表確認)", async () => {
    const result = await retryCallJobAction({ callJobId: "not-a-uuid" });

    expect(result).toEqual({ ok: false, code: "KMB-E101", detail: expect.any(String) });
    expect(retryCallJobMock).not.toHaveBeenCalled();
  });
});

describe("retryCallJobAction / createPlaybackUrlAction", () => {
  it("retryCallJobAction: 成功時は一覧を revalidatePath する", async () => {
    retryCallJobMock.mockResolvedValue({ ok: true, value: undefined });

    const result = await retryCallJobAction({ callJobId: CALL_JOB_ID });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(revalidatePath).toHaveBeenCalledWith("/admin/calls");
  });

  it("retryCallJobAction: E807 (failed 以外) は revalidatePath せずそのまま返す", async () => {
    retryCallJobMock.mockResolvedValue({ ok: false, code: "KMB-E807", detail: "failed 以外" });

    const result = await retryCallJobAction({ callJobId: CALL_JOB_ID });

    expect(result).toEqual({ ok: false, code: "KMB-E807", detail: "failed 以外" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("createPlaybackUrlAction: facade の戻り値 (url/expires_at) をそのまま返す (revalidatePath 不要)", async () => {
    createRecordingPlaybackUrlMock.mockResolvedValue({ ok: true, value: { url: "https://x", expires_at: "2026-07-10T00:10:00Z" } });

    const result = await createPlaybackUrlAction({ recordingId: RECORDING_ID });

    expect(result).toEqual({ ok: true, value: { url: "https://x", expires_at: "2026-07-10T00:10:00Z" } });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("createPlaybackUrlAction: E805 (未ダウンロード) はそのまま伝播する", async () => {
    createRecordingPlaybackUrlMock.mockResolvedValue({ ok: false, code: "KMB-E805", detail: "not downloaded" });

    const result = await createPlaybackUrlAction({ recordingId: RECORDING_ID });

    expect(result).toEqual({ ok: false, code: "KMB-E805", detail: "not downloaded" });
  });
});

describe("retryLatestFailedCallJobAction (§8.1 一覧 r キー再実行 — getCallDetail + retryCallJob の合成)", () => {
  it("failed ジョブが1件も無い場合は KMB-E807 を返し retryCallJob を呼ばない", async () => {
    getCallDetailMock.mockResolvedValue({
      ok: true,
      value: { call: {}, recordings: [], jobs: [{ id: "j1", status: "done", created_at: "2026-07-10T00:00:00Z" }] },
    });

    const result = await retryLatestFailedCallJobAction({ callId: CALL_ID });

    expect(result).toEqual({ ok: false, code: "KMB-E807", detail: expect.any(String) });
    expect(retryCallJobMock).not.toHaveBeenCalled();
  });

  it("複数 failed ジョブのうち created_at が最新のものを対象に retryCallJob を呼ぶ", async () => {
    getCallDetailMock.mockResolvedValue({
      ok: true,
      value: {
        call: {},
        recordings: [],
        jobs: [
          { id: "old-failed", status: "failed", created_at: "2026-07-10T00:00:01Z" },
          { id: "new-failed", status: "failed", created_at: "2026-07-10T00:00:05Z" },
          { id: "done-job", status: "done", created_at: "2026-07-10T00:00:09Z" },
        ],
      },
    });
    retryCallJobMock.mockResolvedValue({ ok: true, value: undefined });

    const result = await retryLatestFailedCallJobAction({ callId: CALL_ID });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(retryCallJobMock).toHaveBeenCalledWith("new-failed");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/calls");
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/calls/${CALL_ID}`);
  });

  it("getCallDetail の失敗はそのまま伝播する (握り潰さない)", async () => {
    getCallDetailMock.mockResolvedValue({ ok: false, code: "KMB-E804", detail: "not found" });

    const result = await retryLatestFailedCallJobAction({ callId: CALL_ID });

    expect(result).toEqual({ ok: false, code: "KMB-E804", detail: "not found" });
    expect(retryCallJobMock).not.toHaveBeenCalled();
  });
});

describe("linkCallToCustomerAction / saveCallMemoAction", () => {
  it("linkCallToCustomerAction: 成功時は詳細ページを revalidatePath する", async () => {
    linkCallToCustomerMock.mockResolvedValue({ ok: true, value: undefined });

    const result = await linkCallToCustomerAction({ callId: CALL_ID, customerId: CUSTOMER_ID, expectedUpdatedAt: EXPECTED_UPDATED_AT });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/calls/${CALL_ID}`);
  });

  it("linkCallToCustomerAction: customerId=null (解除) も許容し facade へそのまま渡す", async () => {
    linkCallToCustomerMock.mockResolvedValue({ ok: true, value: undefined });

    await linkCallToCustomerAction({ callId: CALL_ID, customerId: null, expectedUpdatedAt: EXPECTED_UPDATED_AT });

    expect(linkCallToCustomerMock).toHaveBeenCalledWith(CALL_ID, null, EXPECTED_UPDATED_AT);
  });

  it("linkCallToCustomerAction: E103 (楽観排他) は revalidatePath せずそのまま返す", async () => {
    linkCallToCustomerMock.mockResolvedValue({ ok: false, code: "KMB-E103", detail: "conflict" });

    const result = await linkCallToCustomerAction({ callId: CALL_ID, customerId: CUSTOMER_ID, expectedUpdatedAt: EXPECTED_UPDATED_AT });

    expect(result).toEqual({ ok: false, code: "KMB-E103", detail: "conflict" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("saveCallMemoAction: 成功時は詳細ページを revalidatePath する", async () => {
    saveCallMemoMock.mockResolvedValue({ ok: true, value: undefined });

    const result = await saveCallMemoAction({ callId: CALL_ID, memo: "折返し希望", expectedUpdatedAt: EXPECTED_UPDATED_AT });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/calls/${CALL_ID}`);
  });

  it("saveCallMemoAction: E103 はそのまま伝播し revalidatePath しない", async () => {
    saveCallMemoMock.mockResolvedValue({ ok: false, code: "KMB-E103", detail: "conflict" });

    const result = await saveCallMemoAction({ callId: CALL_ID, memo: "memo", expectedUpdatedAt: EXPECTED_UPDATED_AT });

    expect(result).toEqual({ ok: false, code: "KMB-E103", detail: "conflict" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("searchCustomersForLinkAction / createCustomerForCallAction", () => {
  it("空文字クエリは q:null として listCustomers へ渡す (lifecycle='active'/include_merged:false 固定)", async () => {
    listCustomersMock.mockResolvedValue({ ok: true, value: { items: [], next_cursor: null } });

    await searchCustomersForLinkAction({ query: "" });

    expect(listCustomersMock).toHaveBeenCalledWith(
      { q: null, lifecycle: "active", include_merged: false },
      { cursor: null, limit: 20 },
    );
  });

  it("非空クエリはそのまま q として渡す (ambiguous 候補一覧の from_e164 検索も同一 action)", async () => {
    listCustomersMock.mockResolvedValue({ ok: true, value: { items: [], next_cursor: null } });

    await searchCustomersForLinkAction({ query: "+819012345678" });

    expect(listCustomersMock).toHaveBeenCalledWith(
      { q: "+819012345678", lifecycle: "active", include_merged: false },
      { cursor: null, limit: 20 },
    );
  });

  it("createCustomerForCallAction: lifecycle='customer'/source='phone' 固定で crmFacade.createCustomer を呼ぶ", async () => {
    createCustomerMock.mockResolvedValue({ ok: true, value: { customer_id: CUSTOMER_ID } });

    const result = await createCustomerForCallAction({ name: "熊部太郎", telE164: "+819012345678" });

    expect(result).toEqual({ ok: true, value: { customer_id: CUSTOMER_ID } });
    expect(createCustomerMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "熊部太郎", tel_e164: "+819012345678", lifecycle: "customer", source: "phone" }),
    );
  });

  it("createCustomerForCallAction: telE164=null (no_number 通話) は source='manual' で呼ぶ (レビュー指摘是正 — email/tel いずれも無いと crm zCustomerInput の refine に落ちて毎回 KMB-E101 になっていた不具合)", async () => {
    createCustomerMock.mockResolvedValue({ ok: true, value: { customer_id: CUSTOMER_ID } });

    const result = await createCustomerForCallAction({ name: "熊部太郎", telE164: null });

    expect(result).toEqual({ ok: true, value: { customer_id: CUSTOMER_ID } });
    expect(createCustomerMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "熊部太郎", tel_e164: null, email: null, lifecycle: "customer", source: "manual" }),
    );
  });
});

describe("saveTelephonySettingsAction (#59 — 電話番号2欄の正規化境界。§7.4)", () => {
  it("国内表記 (0X0-XXXX-XXXX) は E.164 へ正規化してから submitSettingsForm へ渡す", async () => {
    submitSettingsFormMock.mockResolvedValue(SETTINGS_FORM_INITIAL_STATE);
    const fd = makeTelephonyFormData({ phone_number_e164: "090-1234-5678", forward_to_e164: "096-123-4567" });

    await saveTelephonySettingsAction(SETTINGS_FORM_INITIAL_STATE, fd);

    expect(submitSettingsFormMock).toHaveBeenCalledWith(
      "telephony",
      expect.anything(),
      expect.objectContaining({ phone_number_e164: "+819012345678", forward_to_e164: "+81961234567" }),
      EXPECTED_UPDATED_AT,
    );
  });

  it("正規化不能な電話番号はフィールドエラーを返し submitSettingsForm を呼ばない", async () => {
    const fd = makeTelephonyFormData({ phone_number_e164: "abc-not-a-number" });

    const result = await saveTelephonySettingsAction(SETTINGS_FORM_INITIAL_STATE, fd);

    expect(result).toEqual({ error: expect.stringContaining("0X0-XXXX-XXXX"), conflict: false, success: false });
    expect(submitSettingsFormMock).not.toHaveBeenCalled();
  });

  it("転送先電話番号が正規化不能な場合は専用のエラーメッセージを返す", async () => {
    const fd = makeTelephonyFormData({ forward_to_e164: "invalid" });

    const result = await saveTelephonySettingsAction(SETTINGS_FORM_INITIAL_STATE, fd);

    expect(result.success).toBe(false);
    expect(result.error).toContain("転送先電話番号");
    expect(submitSettingsFormMock).not.toHaveBeenCalled();
  });

  it("空文字 (未入力) は正規化エラーにせず null として素通しする", async () => {
    submitSettingsFormMock.mockResolvedValue(SETTINGS_FORM_INITIAL_STATE);
    const fd = makeTelephonyFormData({ phone_number_e164: "", forward_to_e164: "" });

    const result = await saveTelephonySettingsAction(SETTINGS_FORM_INITIAL_STATE, fd);

    expect(result).toEqual(SETTINGS_FORM_INITIAL_STATE);
    expect(submitSettingsFormMock).toHaveBeenCalledWith(
      "telephony",
      expect.anything(),
      expect.objectContaining({ phone_number_e164: null, forward_to_e164: null }),
      EXPECTED_UPDATED_AT,
    );
  });

  it("既に E.164 形式 (+81...) の入力はそのまま素通しする (normalizeJpPhoneToE164 の '+' 始まり分岐)", async () => {
    submitSettingsFormMock.mockResolvedValue(SETTINGS_FORM_INITIAL_STATE);
    const fd = makeTelephonyFormData({ phone_number_e164: "+819012345678" });

    await saveTelephonySettingsAction(SETTINGS_FORM_INITIAL_STATE, fd);

    expect(submitSettingsFormMock).toHaveBeenCalledWith(
      "telephony",
      expect.anything(),
      expect.objectContaining({ phone_number_e164: "+819012345678" }),
      expect.any(String),
    );
  });
});

describe("saveBusinessHoursAction (#59 — 曜日/休日フォーム組み立て。§7.4/§8.3)", () => {
  it("enabled=off の曜日は null (休業) として渡す", async () => {
    submitSettingsFormMock.mockResolvedValue(SETTINGS_FORM_INITIAL_STATE);
    const fd = new FormData();
    fd.set("expected_updated_at", EXPECTED_UPDATED_AT);
    // mon のみ enabled、他は未指定 (=off)

    fd.set("mon_enabled", "on");
    fd.set("mon_open", "09:00");
    fd.set("mon_close", "18:00");

    await saveBusinessHoursAction(SETTINGS_FORM_INITIAL_STATE, fd);

    expect(submitSettingsFormMock).toHaveBeenCalledWith(
      "business_hours",
      expect.anything(),
      expect.objectContaining({
        mon: { open: "09:00", close: "18:00" },
        tue: null,
        wed: null,
        thu: null,
        fri: null,
        sat: null,
        sun: null,
      }),
      EXPECTED_UPDATED_AT,
    );
  });

  it("holidays[] の複数値を配列として渡す", async () => {
    submitSettingsFormMock.mockResolvedValue(SETTINGS_FORM_INITIAL_STATE);
    const fd = new FormData();
    fd.set("expected_updated_at", EXPECTED_UPDATED_AT);
    fd.append("holidays", "2026-08-13");
    fd.append("holidays", "2026-08-14");

    await saveBusinessHoursAction(SETTINGS_FORM_INITIAL_STATE, fd);

    expect(submitSettingsFormMock).toHaveBeenCalledWith(
      "business_hours",
      expect.anything(),
      expect.objectContaining({ holidays: ["2026-08-13", "2026-08-14"] }),
      EXPECTED_UPDATED_AT,
    );
  });

  it("holidays 未指定の場合は空配列を渡す", async () => {
    submitSettingsFormMock.mockResolvedValue(SETTINGS_FORM_INITIAL_STATE);
    const fd = new FormData();
    fd.set("expected_updated_at", EXPECTED_UPDATED_AT);

    await saveBusinessHoursAction(SETTINGS_FORM_INITIAL_STATE, fd);

    expect(submitSettingsFormMock).toHaveBeenCalledWith(
      "business_hours",
      expect.anything(),
      expect.objectContaining({ holidays: [] }),
      EXPECTED_UPDATED_AT,
    );
  });
});
