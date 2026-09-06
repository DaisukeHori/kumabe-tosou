import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * canonical: docs/design/crm-suite/04-telephony.md §5.2 (handling 遷移) / §6.1 (dial_result・recorded) /
 * §6.3 (status callback) / §6.4 (recording-status)。
 *
 * webhook 系 facade メソッド (handleDialResult / handleRecorded / handleCallStatus / registerRecording /
 * handleInboundCall の baseUrl) の単体テスト。repository / settings / env をモックし、実 DB には触れない。
 * 修正対象の 3 障害を固定する:
 *   1. 転送呼び出し中に発信者が切ると handling が 'voicemail' 固定になっていた
 *      (dial_result では voicemail を確定せず、CallStatus=completed → missed。voicemail は
 *      step=recorded / 1ch 録音の recording-status で確定)
 *   2. status callback の非終端イベントが duration/cost/ended_at を巻き戻していた
 *   3. NEXT_PUBLIC_SITE_URL の末尾スラッシュで TwiML の callback URL が // になっていた
 */

const getEnvMock = vi.fn();
vi.mock("@/lib/env", () => ({
  getEnv: () => getEnvMock(),
}));
vi.mock("@/lib/integration-credentials", () => ({
  isIntegrationConfigured: async () => true,
  resolveIntegrationCredentials: async () => ({ provider: "twilio", publicId: "AC123", secret: "secret", source: "env" }),
}));

vi.mock("@/lib/supabase/session", () => ({ getSessionAndClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: vi.fn() }));
vi.mock("@/modules/platform/facade", () => ({ platformFacade: { isAdmin: vi.fn(), requireAdmin: vi.fn() } }));
vi.mock("@/modules/crm/facade", () => ({ crmFacade: {} }));

const settingsGetMock = vi.fn();
vi.mock("@/modules/settings/facade", () => ({
  settingsFacade: { get: (...args: unknown[]) => settingsGetMock(...args) },
}));

const findCallByCallSidMock = vi.fn();
const updateCallHandlingMock = vi.fn();
const updateCallOnStatusCallbackMock = vi.fn();
const upsertCallOnConflictDoNothingMock = vi.fn();
const insertRecordingOnConflictDoNothingMock = vi.fn();
const insertCallJobIdempotentMock = vi.fn();

vi.mock("@/modules/telephony/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/telephony/repository")>();
  return {
    ...actual,
    findCallByCallSid: (...args: unknown[]) => findCallByCallSidMock(...args),
    updateCallHandling: (...args: unknown[]) => updateCallHandlingMock(...args),
    updateCallOnStatusCallback: (...args: unknown[]) => updateCallOnStatusCallbackMock(...args),
    upsertCallOnConflictDoNothing: (...args: unknown[]) => upsertCallOnConflictDoNothingMock(...args),
    insertRecordingOnConflictDoNothing: (...args: unknown[]) => insertRecordingOnConflictDoNothingMock(...args),
    insertCallJobIdempotent: (...args: unknown[]) => insertCallJobIdempotentMock(...args),
  };
});

import { telephonyFacade } from "@/modules/telephony/facade";
import { DEFAULT_TELEPHONY_SETTINGS } from "@/modules/telephony/internal/settings-defaults";
import type { CallRow } from "@/modules/telephony/repository";

const fakeClient = {} as SupabaseClient;
const SERVICE_CTX = { mode: "service", client: fakeClient } as const;
const CALL_SID = "CA00000000000000000000000000000001";
const SITE_URL = "https://x.example.com";

function makeCallRow(overrides: Partial<CallRow> = {}): CallRow {
  return {
    id: "call-1",
    call_sid: CALL_SID,
    direction: "inbound",
    from_e164: "+819012345678",
    from_raw: "+819012345678",
    to_e164: "+815012345678",
    twilio_status: "in-progress",
    handling: null,
    match_status: "pending",
    customer_id: null,
    duration_seconds: null,
    started_at: "2026-09-06T01:00:00.000Z",
    ended_at: null,
    twilio_cost_estimate_micro_usd: 0,
    ai_cost_micro_usd: 0,
    memo: null,
    created_at: "2026-09-06T01:00:00.000Z",
    updated_at: "2026-09-06T01:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getEnvMock.mockReturnValue({ NEXT_PUBLIC_SITE_URL: SITE_URL });
  settingsGetMock.mockResolvedValue({ ok: true, value: DEFAULT_TELEPHONY_SETTINGS });
  findCallByCallSidMock.mockResolvedValue({ ok: true, value: makeCallRow() });
  updateCallHandlingMock.mockImplementation(async (_c: unknown, _id: string, handling: CallRow["handling"]) => ({
    ok: true,
    value: makeCallRow({ handling }),
  }));
  updateCallOnStatusCallbackMock.mockResolvedValue({ ok: true, value: makeCallRow() });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ============================================================
// handleDialResult (?step=dial_result)
// ============================================================

describe("handleDialResult — 転送不成立時の handling (発信者切断 vs 留守電フォールバック)", () => {
  it("completed/answered (転送成立) → handling='forwarded' + <Hangup/>", async () => {
    const result = await telephonyFacade.handleDialResult(
      { CallSid: CALL_SID, DialCallStatus: "completed", DialCallDuration: 42, CallStatus: "in-progress" },
      SERVICE_CTX,
    );
    expect(updateCallHandlingMock).toHaveBeenCalledWith(fakeClient, "call-1", "forwarded");
    expect(result.ok && result.value.twiml).toContain("<Hangup/>");
  });

  it("【障害本体】転送中に発信者が切った (DialCallStatus=canceled かつ CallStatus=completed) → 'voicemail' ではなく 'missed' を確定し、留守電 TwiML を返さない", async () => {
    const result = await telephonyFacade.handleDialResult(
      { CallSid: CALL_SID, DialCallStatus: "canceled", DialCallDuration: null, CallStatus: "completed" },
      SERVICE_CTX,
    );
    expect(updateCallHandlingMock).toHaveBeenCalledTimes(1);
    expect(updateCallHandlingMock).toHaveBeenCalledWith(fakeClient, "call-1", "missed");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.twiml).toContain("<Hangup/>");
      expect(result.value.twiml).not.toContain("<Record");
    }
  });

  it("no-answer かつ発信者は通話中 (CallStatus=in-progress) → 留守電 TwiML (§6.2-c) を返すが handling はまだ確定しない (recorded / 1ch 録音で確定)", async () => {
    const result = await telephonyFacade.handleDialResult(
      { CallSid: CALL_SID, DialCallStatus: "no-answer", DialCallDuration: null, CallStatus: "in-progress" },
      SERVICE_CTX,
    );
    expect(updateCallHandlingMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.twiml).toContain('<Record maxLength="');
      expect(result.value.twiml).toContain(`action="${SITE_URL}/api/telephony/voice?step=recorded"`);
    }
  });

  it("busy かつ CallStatus 欠落 (null 補完) → completed ではないので留守電フォールバックへ進む (欠落で missed に倒さない)", async () => {
    const result = await telephonyFacade.handleDialResult(
      { CallSid: CALL_SID, DialCallStatus: "busy", DialCallDuration: null, CallStatus: null },
      SERVICE_CTX,
    );
    expect(updateCallHandlingMock).not.toHaveBeenCalled();
    expect(result.ok && result.value.twiml).toContain("<Record");
  });

  it("通話が見つからない場合は KMB-E804", async () => {
    findCallByCallSidMock.mockResolvedValue({ ok: true, value: null });
    const result = await telephonyFacade.handleDialResult(
      { CallSid: CALL_SID, DialCallStatus: "no-answer", DialCallDuration: null, CallStatus: "in-progress" },
      SERVICE_CTX,
    );
    expect(result).toEqual({ ok: false, code: "KMB-E804", detail: expect.stringContaining(CALL_SID) });
  });
});

// ============================================================
// handleRecorded (?step=recorded) — voicemail の確定点
// ============================================================

describe("handleRecorded — <Record action> 到達で voicemail を確定する", () => {
  it("handling=null (dial_result フォールバック経由) → 'voicemail' を確定し、お礼 + Hangup TwiML を返す", async () => {
    const result = await telephonyFacade.handleRecorded({ CallSid: CALL_SID }, SERVICE_CTX);
    expect(updateCallHandlingMock).toHaveBeenCalledWith(fakeClient, "call-1", "voicemail");
    expect(result.ok && result.value.twiml).toContain("<Hangup/>");
  });

  it("status callback が先着して 'missed' になっていた場合も 'voicemail' へ是正する (録音が存在する = 留守電成立)", async () => {
    findCallByCallSidMock.mockResolvedValue({ ok: true, value: makeCallRow({ handling: "missed" }) });
    await telephonyFacade.handleRecorded({ CallSid: CALL_SID }, SERVICE_CTX);
    expect(updateCallHandlingMock).toHaveBeenCalledWith(fakeClient, "call-1", "voicemail");
  });

  it.each(["voicemail", "after_hours_voicemail", "forwarded"] as const)(
    "handling='%s' (確定済み) は上書きしない",
    async (handling) => {
      findCallByCallSidMock.mockResolvedValue({ ok: true, value: makeCallRow({ handling }) });
      const result = await telephonyFacade.handleRecorded({ CallSid: CALL_SID }, SERVICE_CTX);
      expect(updateCallHandlingMock).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
    },
  );

  it("通話が見つからなくても TwiML 応答は成立させる (E804 は console.error のみ — 発信者への終話案内を優先)", async () => {
    findCallByCallSidMock.mockResolvedValue({ ok: true, value: null });
    const result = await telephonyFacade.handleRecorded({ CallSid: CALL_SID }, SERVICE_CTX);
    expect(result.ok && result.value.twiml).toContain("<Hangup/>");
    expect(updateCallHandlingMock).not.toHaveBeenCalled();
  });

  it("updateCallHandling の失敗は握り潰さず伝播する", async () => {
    updateCallHandlingMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "conn reset" });
    const result = await telephonyFacade.handleRecorded({ CallSid: CALL_SID }, SERVICE_CTX);
    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "conn reset" });
  });
});

// ============================================================
// registerRecording — 1ch 録音で voicemail を確定
// ============================================================

describe("registerRecording — 1ch 録音 (留守電) の到達で voicemail を確定する", () => {
  const RECORDING_INPUT = {
    CallSid: CALL_SID,
    RecordingSid: "RE00000000000000000000000000000001",
    RecordingUrl: "https://api.twilio.com/2010-04-01/Accounts/AC/Recordings/RE1",
    RecordingDuration: 12,
  };

  beforeEach(() => {
    insertRecordingOnConflictDoNothingMock.mockResolvedValue({ ok: true, value: { row: { id: "rec-1" }, created: true } });
    insertCallJobIdempotentMock.mockResolvedValue({ ok: true, value: { row: { id: "job-1" }, created: true } });
  });

  it("1ch かつ handling=null → 'voicemail' を確定してから録音/ジョブを登録する", async () => {
    const result = await telephonyFacade.registerRecording({ ...RECORDING_INPUT, RecordingChannels: 1 }, SERVICE_CTX);
    expect(updateCallHandlingMock).toHaveBeenCalledWith(fakeClient, "call-1", "voicemail");
    expect(insertRecordingOnConflictDoNothingMock).toHaveBeenCalledWith(fakeClient, expect.objectContaining({ source: "voicemail", channels: 1 }));
    expect(result).toEqual({ ok: true, value: { call_job_id: "job-1" } });
  });

  it("1ch かつ handling='missed' (status callback 先着) → 'voicemail' へ是正する", async () => {
    findCallByCallSidMock.mockResolvedValue({ ok: true, value: makeCallRow({ handling: "missed" }) });
    await telephonyFacade.registerRecording({ ...RECORDING_INPUT, RecordingChannels: 1 }, SERVICE_CTX);
    expect(updateCallHandlingMock).toHaveBeenCalledWith(fakeClient, "call-1", "voicemail");
  });

  it("1ch でも handling='after_hours_voicemail' (確定済み) は上書きしない", async () => {
    findCallByCallSidMock.mockResolvedValue({ ok: true, value: makeCallRow({ handling: "after_hours_voicemail" }) });
    await telephonyFacade.registerRecording({ ...RECORDING_INPUT, RecordingChannels: 1 }, SERVICE_CTX);
    expect(updateCallHandlingMock).not.toHaveBeenCalled();
  });

  it("2ch (転送録音 source='dial') は handling に触れない", async () => {
    await telephonyFacade.registerRecording({ ...RECORDING_INPUT, RecordingChannels: 2 }, SERVICE_CTX);
    expect(updateCallHandlingMock).not.toHaveBeenCalled();
    expect(insertRecordingOnConflictDoNothingMock).toHaveBeenCalledWith(fakeClient, expect.objectContaining({ source: "dial" }));
  });
});

// ============================================================
// handleCallStatus — 非終端イベントの巻き戻し防止
// ============================================================

describe("handleCallStatus — 非終端イベントは twilio_status のみ / 終端のみ duration・cost・ended_at", () => {
  it("終端 (completed) かつ handling=null → duration/cost/ended_at/handling='missed' を一括更新する", async () => {
    await telephonyFacade.handleCallStatus({ CallSid: CALL_SID, CallStatus: "completed", CallDuration: 61 }, SERVICE_CTX);

    expect(updateCallOnStatusCallbackMock).toHaveBeenCalledTimes(1);
    const patch = updateCallOnStatusCallbackMock.mock.calls[0][2] as Record<string, unknown>;
    expect(patch.twilio_status).toBe("completed");
    expect(patch.duration_seconds).toBe(61);
    expect(patch.handling).toBe("missed");
    expect(typeof patch.ended_at).toBe("string");
    expect(patch.twilio_cost_estimate_micro_usd).toEqual(expect.any(Number));
  });

  it("終端かつ handling 確定済み ('voicemail') → handling は patch に含めない (missed へ倒さない — §6.3 手順 3)", async () => {
    findCallByCallSidMock.mockResolvedValue({ ok: true, value: makeCallRow({ handling: "voicemail" }) });
    await telephonyFacade.handleCallStatus({ CallSid: CALL_SID, CallStatus: "completed", CallDuration: 30 }, SERVICE_CTX);
    const patch = updateCallOnStatusCallbackMock.mock.calls[0][2] as Record<string, unknown>;
    expect(patch).not.toHaveProperty("handling");
    expect(patch.duration_seconds).toBe(30);
  });

  it("【障害本体】非終端 (in-progress) → twilio_status のみ更新し duration/cost/ended_at/handling は一切書かない", async () => {
    await telephonyFacade.handleCallStatus({ CallSid: CALL_SID, CallStatus: "in-progress", CallDuration: null }, SERVICE_CTX);

    expect(updateCallOnStatusCallbackMock).toHaveBeenCalledTimes(1);
    expect(updateCallOnStatusCallbackMock).toHaveBeenCalledWith(fakeClient, "call-1", { twilio_status: "in-progress" });
  });

  it("非終端 (ringing) が終了確定後 (ended_at 設定済み) に遅延到達した場合は何も書かず ok を返す (順序逆転の無視)", async () => {
    findCallByCallSidMock.mockResolvedValue({
      ok: true,
      value: makeCallRow({ handling: "voicemail", ended_at: "2026-09-06T01:02:00.000Z", duration_seconds: 120, twilio_status: "completed" }),
    });

    const result = await telephonyFacade.handleCallStatus({ CallSid: CALL_SID, CallStatus: "ringing", CallDuration: null }, SERVICE_CTX);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(updateCallOnStatusCallbackMock).not.toHaveBeenCalled();
  });

  it("終端イベントの再配信 (ended_at 設定済み) は既存の ended_at を保持する (now() で上書きしない)", async () => {
    findCallByCallSidMock.mockResolvedValue({
      ok: true,
      value: makeCallRow({ handling: "voicemail", ended_at: "2026-09-06T01:02:00.000Z", duration_seconds: 120 }),
    });
    await telephonyFacade.handleCallStatus({ CallSid: CALL_SID, CallStatus: "completed", CallDuration: 120 }, SERVICE_CTX);
    const patch = updateCallOnStatusCallbackMock.mock.calls[0][2] as Record<string, unknown>;
    expect(patch.ended_at).toBe("2026-09-06T01:02:00.000Z");
  });

  it("通話が見つからない場合は KMB-E804 (route が 200 で吸収する)", async () => {
    findCallByCallSidMock.mockResolvedValue({ ok: true, value: null });
    const result = await telephonyFacade.handleCallStatus({ CallSid: CALL_SID, CallStatus: "completed", CallDuration: 1 }, SERVICE_CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E804");
  });
});

// ============================================================
// baseUrl — NEXT_PUBLIC_SITE_URL の末尾スラッシュ
// ============================================================

describe("TwiML の callback URL — NEXT_PUBLIC_SITE_URL の末尾スラッシュを除去する", () => {
  it("handleInboundCall (転送あり): env が 'https://x.example.com/' でも action / recordingStatusCallback は単一スラッシュ", async () => {
    getEnvMock.mockReturnValue({ NEXT_PUBLIC_SITE_URL: `${SITE_URL}/` });
    settingsGetMock.mockImplementation(async (key: string) =>
      key === "telephony"
        ? { ok: true, value: { ...DEFAULT_TELEPHONY_SETTINGS, forward_to_e164: "+819087654321" } }
        : { ok: false, code: "KMB-E901" },
    );
    upsertCallOnConflictDoNothingMock.mockResolvedValue({ ok: true, value: { row: makeCallRow(), created: true } });

    const result = await telephonyFacade.handleInboundCall(
      { CallSid: CALL_SID, From: "+819012345678", To: "+815012345678", CallStatus: "ringing" },
      SERVICE_CTX,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.twiml).toContain(`action="${SITE_URL}/api/telephony/voice?step=dial_result"`);
      expect(result.value.twiml).toContain(`recordingStatusCallback="${SITE_URL}/api/telephony/recording-status"`);
      expect(result.value.twiml).not.toContain("//api/");
    }
  });

  it("handleDialResult (留守電フォールバック): 末尾スラッシュ付き env でも ?step=recorded の action が // にならない", async () => {
    getEnvMock.mockReturnValue({ NEXT_PUBLIC_SITE_URL: `${SITE_URL}//` });
    const result = await telephonyFacade.handleDialResult(
      { CallSid: CALL_SID, DialCallStatus: "no-answer", DialCallDuration: null, CallStatus: "in-progress" },
      SERVICE_CTX,
    );
    expect(result.ok && result.value.twiml).toContain(`action="${SITE_URL}/api/telephony/voice?step=recorded"`);
    expect(result.ok && result.value.twiml).not.toContain("//api/");
  });
});
