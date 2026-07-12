import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Result } from "@/modules/platform/contracts";
import type { CallAnalysis, CallJobLinkResult, CallJobStatus, CallTranscript } from "@/modules/telephony/contracts";
import {
  CALL_JOB_HEARTBEAT_INTERVAL_MS,
  CALL_JOB_MAX_ATTEMPTS,
  TELEPHONY_WAKE_SOFT_BUDGET_MS,
  TELEPHONY_WORKER_MAX_JOBS_PER_WAKE,
  TRANSCRIBE_SEGMENT_WORST_MS,
} from "@/modules/telephony/internal/lease";
import { DEFAULT_TELEPHONY_SETTINGS } from "@/modules/telephony/internal/settings-defaults";
import type { CallJobRow, CallRecordingRow, CallRow } from "@/modules/telephony/repository";

/**
 * internal/worker.ts の単体テスト
 * (canonical: docs/design/crm-suite/04-telephony.md §6.5 共通則 / §7.1 D8 / §7.3)。
 * repository.ts / aiProvidersFacade / crmFacade / settingsFacade / internal/twilio-api /
 * internal/segmenter を全て vi.mock し、実 DB・実 API には一切触れない。
 *
 * #57 時代 (STAGE_HANDLERS が即 return するスタブだった頃) の it.each ブロックは #58 の実装で
 * 意味を失った (実処理が入ったため) ので削除し、4 ステージそれぞれの実処理を検証する describe に
 * 置き換えた (issue-58 計画書 テスト戦略節)。acquire 分岐の網羅 / heartbeat タイマー /
 * runTelephonyJobBatch の既存3ブロックは worker.ts 本体 (advanceCallJob/runTelephonyJobBatch) が
 * 変更されていないため、アサーションを一切変えずそのまま維持する。
 */

// ============================================================
// モック定義
// ============================================================

const acquireCallJobLeaseMock = vi.fn();
const heartbeatCallJobLeaseMock = vi.fn();
const listDueCallJobsMock = vi.fn();
const commitCallJobStageMock = vi.fn();
const getCallRecordingByIdMock = vi.fn();
const updateCallRecordingStorageMock = vi.fn();
const getCallJobByIdMock = vi.fn();
const updateCallJobTranscriptPartialMock = vi.fn();
const listCallRecordingsByCallIdMock = vi.fn();
const reflectLinkResultToCallsMock = vi.fn();
const getCallByIdMock = vi.fn();

vi.mock("@/modules/telephony/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/telephony/repository")>();
  return {
    ...actual,
    acquireCallJobLease: (...args: unknown[]) => acquireCallJobLeaseMock(...args),
    heartbeatCallJobLease: (...args: unknown[]) => heartbeatCallJobLeaseMock(...args),
    listDueCallJobs: (...args: unknown[]) => listDueCallJobsMock(...args),
    commitCallJobStage: (...args: unknown[]) => commitCallJobStageMock(...args),
    getCallRecordingById: (...args: unknown[]) => getCallRecordingByIdMock(...args),
    updateCallRecordingStorage: (...args: unknown[]) => updateCallRecordingStorageMock(...args),
    getCallJobById: (...args: unknown[]) => getCallJobByIdMock(...args),
    updateCallJobTranscriptPartial: (...args: unknown[]) => updateCallJobTranscriptPartialMock(...args),
    listCallRecordingsByCallId: (...args: unknown[]) => listCallRecordingsByCallIdMock(...args),
    reflectLinkResultToCalls: (...args: unknown[]) => reflectLinkResultToCallsMock(...args),
    getCallById: (...args: unknown[]) => getCallByIdMock(...args),
  };
});

const createSupabaseServiceClientMock = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: (...args: unknown[]) => createSupabaseServiceClientMock(...args),
}));

const transcribeMock = vi.fn();
const generateTextMock = vi.fn();
vi.mock("@/modules/ai-providers/facade", () => ({
  aiProvidersFacade: {
    transcribe: (...args: unknown[]) => transcribeMock(...args),
    generateText: (...args: unknown[]) => generateTextMock(...args),
  },
}));

const matchCustomerByPhoneMock = vi.fn();
const createCustomerMock = vi.fn();
const appendActivityMock = vi.fn();
const createTaskMock = vi.fn();
vi.mock("@/modules/crm/facade", () => ({
  crmFacade: {
    matchCustomerByPhone: (...args: unknown[]) => matchCustomerByPhoneMock(...args),
    createCustomer: (...args: unknown[]) => createCustomerMock(...args),
    appendActivity: (...args: unknown[]) => appendActivityMock(...args),
    createTask: (...args: unknown[]) => createTaskMock(...args),
  },
}));

const settingsGetMock = vi.fn();
vi.mock("@/modules/settings/facade", () => ({
  settingsFacade: { get: (...args: unknown[]) => settingsGetMock(...args) },
}));

const downloadRecordingMock = vi.fn();
const deleteRecordingMock = vi.fn();
vi.mock("@/modules/telephony/internal/twilio-api", () => ({
  downloadRecording: (...args: unknown[]) => downloadRecordingMock(...args),
  deleteRecording: (...args: unknown[]) => deleteRecordingMock(...args),
}));

const segmentCallRecordingMock = vi.fn();
vi.mock("@/modules/telephony/internal/segmenter", () => ({
  segmentCallRecording: (...args: unknown[]) => segmentCallRecordingMock(...args),
}));

import { STAGE_HANDLERS, advanceCallJob, runTelephonyJobBatch } from "@/modules/telephony/internal/worker";

// ============================================================
// テスト用フィクスチャ
// ============================================================

const storageUploadMock = vi.fn();
const storageDownloadMock = vi.fn();
const fakeClient = {
  storage: {
    from: () => ({
      upload: (...args: unknown[]) => storageUploadMock(...args),
      download: (...args: unknown[]) => storageDownloadMock(...args),
    }),
  },
} as unknown as SupabaseClient;

type RawRow = {
  id: string;
  status: CallJobStatus;
  lease_expires_at: string | null;
  stage_attempts: number;
  call_id: string;
  recording_id: string;
  transcript: unknown;
  analysis: unknown;
  result_kind: "acquired" | "held" | "exhausted" | "terminal" | "not_found";
};

function makeRow(overrides: Partial<RawRow> = {}): RawRow {
  return {
    id: "job-1",
    status: "downloading",
    lease_expires_at: new Date().toISOString(),
    stage_attempts: 1,
    call_id: "call-1",
    recording_id: "rec-1",
    transcript: null,
    analysis: null,
    result_kind: "acquired",
    ...overrides,
  };
}

function makeCallRow(overrides: Partial<CallRow> = {}): CallRow {
  return {
    id: "call-1",
    call_sid: "CA00000000000000000000000000000001",
    direction: "inbound",
    from_e164: "+819012345678",
    from_raw: "+819012345678",
    to_e164: "+815012345678",
    twilio_status: "completed",
    handling: "voicemail",
    match_status: "pending",
    customer_id: null,
    duration_seconds: 90,
    started_at: "2026-07-01T01:00:00.000Z",
    ended_at: "2026-07-01T01:01:30.000Z",
    twilio_cost_estimate_micro_usd: 12_500,
    ai_cost_micro_usd: 0,
    memo: null,
    created_at: "2026-07-01T01:00:00.000Z",
    updated_at: "2026-07-01T01:01:30.000Z",
    ...overrides,
  };
}

function makeRecordingRow(overrides: Partial<CallRecordingRow> = {}): CallRecordingRow {
  return {
    id: "rec-1",
    call_id: "call-1",
    recording_sid: "RE00000000000000000000000000000001",
    source: "voicemail",
    twilio_url: "https://api.twilio.com/2010-04-01/Accounts/ACxxx/Recordings/RExxx",
    duration_seconds: 90,
    channels: 1,
    storage_path: null,
    byte_size: null,
    twilio_deleted_at: null,
    created_at: "2026-07-01T01:00:00.000Z",
    updated_at: "2026-07-01T01:00:00.000Z",
    ...overrides,
  };
}

function makeJobRow(overrides: Partial<CallJobRow> = {}): CallJobRow {
  return {
    id: "job-1",
    call_id: "call-1",
    recording_id: "rec-1",
    status: "transcribing",
    transcript: null,
    analysis: null,
    link_result: null,
    transcript_partial: null,
    error_code: null,
    ai_cost_micro_usd: 0,
    stage_attempts: 1,
    lease_expires_at: new Date().toISOString(),
    created_at: "2026-07-01T01:00:00.000Z",
    updated_at: "2026-07-01T01:00:00.000Z",
    ...overrides,
  };
}

const SAMPLE_TRANSCRIPT: CallTranscript = {
  segments: [{ channel: 0, index: 0, text: "こんにちは、見積りをお願いしたいのですが" }],
  full_text: "こんにちは、見積りをお願いしたいのですが",
};

const VALID_ANALYSIS: CallAnalysis = {
  minutes: {
    summary: "見積り依頼の電話。ガンプラの塗装について相談があった。",
    caller_intent: "estimate_request",
    key_points: ["ガンプラの塗装依頼"],
    customer_name_guess: "山田太郎",
    callback_required: false,
    callback_note: null,
  },
  tasks: [{ title: "見積り作成", detail: "MGガンプラ1体の見積りを作成する", due_hint: null }],
};

const USAGE_ZERO = { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheWriteInputTokens: 0, webSearchRequests: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  createSupabaseServiceClientMock.mockReturnValue(fakeClient);
  settingsGetMock.mockResolvedValue({
    ok: true,
    value: { ...DEFAULT_TELEPHONY_SETTINGS, delete_twilio_recording_after_download: false },
  });
  getCallRecordingByIdMock.mockResolvedValue({ ok: true, value: null });
  getCallJobByIdMock.mockResolvedValue({ ok: true, value: null });
  getCallByIdMock.mockResolvedValue({ ok: true, value: null });
  listCallRecordingsByCallIdMock.mockResolvedValue({ ok: true, value: [] });
  updateCallRecordingStorageMock.mockResolvedValue({ ok: true, value: makeRecordingRow() });
  updateCallJobTranscriptPartialMock.mockResolvedValue({ ok: true, value: undefined });
  reflectLinkResultToCallsMock.mockResolvedValue({ ok: true, value: { skipped: false } });
  downloadRecordingMock.mockResolvedValue({ ok: true, value: { notFound: true } });
  deleteRecordingMock.mockResolvedValue({ ok: true, value: undefined });
  segmentCallRecordingMock.mockReturnValue({ ok: true, value: [] });
  transcribeMock.mockResolvedValue({ ok: true, value: { text: "", costMicroUsd: 0 } });
  generateTextMock.mockResolvedValue({
    ok: true,
    value: { text: "{}", provider: "anthropic", model: "test-model", usage: USAGE_ZERO, costMicroUsd: 0, stopReason: "end_turn" },
  });
  matchCustomerByPhoneMock.mockResolvedValue({ ok: true, value: null });
  createCustomerMock.mockResolvedValue({ ok: true, value: { customer_id: "cust-default" } });
  appendActivityMock.mockResolvedValue({ ok: true, value: { activity_id: "act-default", created: true } });
  createTaskMock.mockResolvedValue({ ok: true, value: { task_id: "task-default" } });
  storageUploadMock.mockResolvedValue({ data: {}, error: null });
  storageDownloadMock.mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  vi.useRealTimers();
});

// ============================================================
// 既存ブロック (#57): worker.ts 本体 (advanceCallJob/runTelephonyJobBatch) は #58 で
// 変更していないため、アサーションを一切変えずそのまま維持する。
// ============================================================

describe("advanceCallJob: acquire 分岐の網羅 (acquired/held/exhausted/terminal/not_found、§7.1 D8)", () => {
  it("not_found (raw=null): KMB-E804 を返す", async () => {
    acquireCallJobLeaseMock.mockResolvedValue({ ok: true, value: null });

    const result = await advanceCallJob(fakeClient, "job-x");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("KMB-E804");
      expect(result.detail).toContain("job-x");
    }
  });

  it("not_found (result_kind='not_found' のプレースホルダ行あり): KMB-E804 を返す", async () => {
    acquireCallJobLeaseMock.mockResolvedValue({ ok: true, value: makeRow({ result_kind: "not_found" }) });

    const result = await advanceCallJob(fakeClient, "job-1");

    expect(result).toEqual({ ok: false, code: "KMB-E804", detail: expect.stringContaining("job-1") });
  });

  it("held: エラーにせず現在の status を ok:true で返す (他プロセスが lease 保持中)。heartbeat も起動しない", async () => {
    acquireCallJobLeaseMock.mockResolvedValue({
      ok: true,
      value: makeRow({ status: "transcribing", result_kind: "held" }),
    });

    const result = await advanceCallJob(fakeClient, "job-1");

    expect(result).toEqual({ ok: true, value: { status: "transcribing" } });
    expect(heartbeatCallJobLeaseMock).not.toHaveBeenCalled();
    expect(commitCallJobStageMock).not.toHaveBeenCalled();
  });

  it("exhausted: KMB-E806 を返す (acquire 自身が stage_attempts>=3 を検知して failed 化した直後の応答)", async () => {
    acquireCallJobLeaseMock.mockResolvedValue({
      ok: true,
      value: makeRow({ status: "failed", stage_attempts: 3, result_kind: "exhausted" }),
    });

    const result = await advanceCallJob(fakeClient, "job-1");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("KMB-E806");
      expect(result.detail).toContain("job-1");
    }
  });

  it("terminal: エラーにせず現在の status (done等) を ok:true で返す", async () => {
    acquireCallJobLeaseMock.mockResolvedValue({
      ok: true,
      value: makeRow({ status: "done", result_kind: "terminal" }),
    });

    const result = await advanceCallJob(fakeClient, "job-1");

    expect(result).toEqual({ ok: true, value: { status: "done" } });
  });

  it("acquireCallJobLease 自体が ok:false を返した場合、そのまま透過する (エラー握り潰し厳禁)", async () => {
    acquireCallJobLeaseMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "db down" });

    const result = await advanceCallJob(fakeClient, "job-1");

    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "db down" });
  });

  it("acquireCallJobLease が reject (例外) した場合、catch されて KMB-E901 になる (例外を漏らさない)", async () => {
    acquireCallJobLeaseMock.mockRejectedValue(new Error("boom"));

    const result = await advanceCallJob(fakeClient, "job-1");

    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "boom" });
  });
});

describe("advanceCallJob: acquired → ステージ dispatch (#58 で実処理化。実処理の検証は各ステージ別の describe が担う)", () => {
  it("STAGE_HANDLERS のキーは downloading/transcribing/analyzing/linking の 4 つちょうど", () => {
    expect(Object.keys(STAGE_HANDLERS).sort()).toEqual(["analyzing", "downloading", "linking", "transcribing"]);
  });
});

describe("advanceCallJob: heartbeat タイマーの開始/停止", () => {
  it("acquired 時のみ heartbeat が CALL_JOB_HEARTBEAT_INTERVAL_MS (20秒) 間隔で開始し、ステージ処理完了で必ず停止する (finally)", async () => {
    vi.useFakeTimers();
    heartbeatCallJobLeaseMock.mockResolvedValue({ ok: true, value: undefined });
    acquireCallJobLeaseMock.mockResolvedValue({
      ok: true,
      value: makeRow({ status: "downloading", result_kind: "acquired" }),
    });

    let resolveStage!: (v: Result<{ status: CallJobStatus }>) => void;
    const stagePromise = new Promise<Result<{ status: CallJobStatus }>>((resolve) => {
      resolveStage = resolve;
    });
    const originalHandler = STAGE_HANDLERS.downloading;
    STAGE_HANDLERS.downloading = vi.fn(() => stagePromise);

    try {
      const advancePromise = advanceCallJob(fakeClient, "job-1");

      await vi.advanceTimersByTimeAsync(0);
      expect(heartbeatCallJobLeaseMock).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(CALL_JOB_HEARTBEAT_INTERVAL_MS);
      expect(heartbeatCallJobLeaseMock).toHaveBeenCalledTimes(1);
      expect(heartbeatCallJobLeaseMock).toHaveBeenCalledWith(fakeClient, "job-1");

      await vi.advanceTimersByTimeAsync(CALL_JOB_HEARTBEAT_INTERVAL_MS);
      expect(heartbeatCallJobLeaseMock).toHaveBeenCalledTimes(2);

      resolveStage({ ok: true, value: { status: "downloading" } });
      const result = await advancePromise;
      expect(result).toEqual({ ok: true, value: { status: "downloading" } });

      // 停止確認: ステージ完了後にさらに時間を進めても呼び出し回数が増えない (clearInterval 済み)
      await vi.advanceTimersByTimeAsync(CALL_JOB_HEARTBEAT_INTERVAL_MS * 3);
      expect(heartbeatCallJobLeaseMock).toHaveBeenCalledTimes(2);
    } finally {
      STAGE_HANDLERS.downloading = originalHandler;
    }
  });

  it("held/exhausted/terminal/not_found では heartbeat タイマーが一切起動しない (setInterval 自体が呼ばれない)", async () => {
    vi.useFakeTimers();
    acquireCallJobLeaseMock.mockResolvedValue({
      ok: true,
      value: makeRow({ status: "linking", result_kind: "held" }),
    });

    await advanceCallJob(fakeClient, "job-1");
    await vi.advanceTimersByTimeAsync(CALL_JOB_HEARTBEAT_INTERVAL_MS * 5);

    expect(heartbeatCallJobLeaseMock).not.toHaveBeenCalled();
  });

  it("ステージ処理が例外を投げても heartbeat タイマーは finally で必ず停止する (取り残さない)", async () => {
    vi.useFakeTimers();
    heartbeatCallJobLeaseMock.mockResolvedValue({ ok: true, value: undefined });
    acquireCallJobLeaseMock.mockResolvedValue({
      ok: true,
      value: makeRow({ status: "downloading", result_kind: "acquired" }),
    });
    const originalHandler = STAGE_HANDLERS.downloading;
    STAGE_HANDLERS.downloading = vi.fn(async () => {
      throw new Error("stage boom");
    });

    try {
      const result = await advanceCallJob(fakeClient, "job-1");
      expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "stage boom" });

      await vi.advanceTimersByTimeAsync(CALL_JOB_HEARTBEAT_INTERVAL_MS * 3);
      expect(heartbeatCallJobLeaseMock).not.toHaveBeenCalled();
    } finally {
      STAGE_HANDLERS.downloading = originalHandler;
    }
  });

  it("heartbeat 呼び出し自体が失敗しても advanceCallJob は失敗しない (ベストエフォート catch)", async () => {
    vi.useFakeTimers();
    heartbeatCallJobLeaseMock.mockRejectedValue(new Error("heartbeat down"));
    acquireCallJobLeaseMock.mockResolvedValue({
      ok: true,
      value: makeRow({ status: "downloading", result_kind: "acquired" }),
    });

    let resolveStage!: (v: Result<{ status: CallJobStatus }>) => void;
    const stagePromise = new Promise<Result<{ status: CallJobStatus }>>((resolve) => {
      resolveStage = resolve;
    });
    const originalHandler = STAGE_HANDLERS.downloading;
    STAGE_HANDLERS.downloading = vi.fn(() => stagePromise);

    try {
      const advancePromise = advanceCallJob(fakeClient, "job-1");
      await vi.advanceTimersByTimeAsync(CALL_JOB_HEARTBEAT_INTERVAL_MS);
      expect(heartbeatCallJobLeaseMock).toHaveBeenCalledTimes(1);

      resolveStage({ ok: true, value: { status: "downloading" } });
      const result = await advancePromise;
      expect(result).toEqual({ ok: true, value: { status: "downloading" } });
    } finally {
      STAGE_HANDLERS.downloading = originalHandler;
    }
  });
});

describe("runTelephonyJobBatch (§7.3): due job を created_at 昇順で直列に advance し、残余予算を超えたら打ち切る", () => {
  it("listDueCallJobs は limit=TELEPHONY_WORKER_MAX_JOBS_PER_WAKE(2) で呼ばれ、返却された due job を順に advance する", async () => {
    listDueCallJobsMock.mockResolvedValue({ ok: true, value: [{ id: "job-1" }, { id: "job-2" }] });
    acquireCallJobLeaseMock.mockImplementation(async (_client: unknown, jobId: string) => ({
      ok: true,
      value: makeRow({ id: jobId, status: "downloading", result_kind: "acquired" }),
    }));

    const result = await runTelephonyJobBatch();

    expect(result).toEqual({ processed: 2 });
    expect(listDueCallJobsMock).toHaveBeenCalledTimes(1);
    expect(listDueCallJobsMock).toHaveBeenCalledWith(fakeClient, TELEPHONY_WORKER_MAX_JOBS_PER_WAKE);
    expect(acquireCallJobLeaseMock).toHaveBeenCalledTimes(2);
    expect(acquireCallJobLeaseMock).toHaveBeenNthCalledWith(1, fakeClient, "job-1");
    expect(acquireCallJobLeaseMock).toHaveBeenNthCalledWith(2, fakeClient, "job-2");
  });

  it("listDueCallJobs が失敗しても例外を投げず processed:0 を返す (advanceCallJob は一切呼ばれない、エラーは握り潰さず記録)", async () => {
    listDueCallJobsMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "db down" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runTelephonyJobBatch();

    expect(result).toEqual({ processed: 0 });
    expect(acquireCallJobLeaseMock).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("残余予算ガード: 経過時間 + TRANSCRIBE_SEGMENT_WORST_MS が TELEPHONY_WAKE_SOFT_BUDGET_MS を超える場合、その回の着手前 (lease取得前) に打ち切る", async () => {
    listDueCallJobsMock.mockResolvedValue({ ok: true, value: [{ id: "job-1" }, { id: "job-2" }] });
    acquireCallJobLeaseMock.mockImplementation(async (_client: unknown, jobId: string) => ({
      ok: true,
      value: makeRow({ id: jobId, status: "downloading", result_kind: "acquired" }),
    }));

    const startedAt = 1_000_000;
    const overBudget = startedAt + (TELEPHONY_WAKE_SOFT_BUDGET_MS - TRANSCRIBE_SEGMENT_WORST_MS) + 1;
    const dateNowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(startedAt) // runTelephonyJobBatch 冒頭の startedAt
      .mockReturnValueOnce(startedAt) // job-1 の残余予算チェック (経過0 → 着手)
      .mockReturnValueOnce(overBudget); // job-2 の残余予算チェック (超過 → 打ち切り、attempts 不計上)

    const result = await runTelephonyJobBatch();

    expect(result).toEqual({ processed: 1 });
    expect(acquireCallJobLeaseMock).toHaveBeenCalledTimes(1);
    expect(acquireCallJobLeaseMock).toHaveBeenCalledWith(fakeClient, "job-1");

    dateNowSpy.mockRestore();
  });

  it("advanceCallJob (acquire) が個別ジョブでエラーを返しても、バッチ全体は継続しエラーを握り潰さず記録する", async () => {
    listDueCallJobsMock.mockResolvedValue({ ok: true, value: [{ id: "job-1" }, { id: "job-2" }] });
    acquireCallJobLeaseMock
      .mockResolvedValueOnce({ ok: false, code: "KMB-E901", detail: "job-1 db error" })
      .mockResolvedValueOnce({ ok: true, value: makeRow({ id: "job-2", status: "downloading", result_kind: "acquired" }) });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await runTelephonyJobBatch();

    expect(result).toEqual({ processed: 2 }); // 両方「試行」はしている (エラーでも次のジョブへ進む)
    expect(acquireCallJobLeaseMock).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("job-1"),
      "KMB-E901",
      "job-1 db error",
    );

    errorSpy.mockRestore();
  });
});

// ============================================================
// #58 新規: 4ステージの実処理 (STAGE_HANDLERS を直接呼び出して検証する)
// ============================================================

describe("handleDownloading (§6.5.1)", () => {
  it("再入ガード: storage_path が既に設定済みなら DL をスキップし transcribing へ前進するのみ", async () => {
    getCallRecordingByIdMock.mockResolvedValue({ ok: true, value: makeRecordingRow({ storage_path: "call-1/rec-1.wav" }) });
    commitCallJobStageMock.mockResolvedValue({ ok: true, value: "transcribing" });

    const result = await STAGE_HANDLERS.downloading({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "downloading" }) });

    expect(downloadRecordingMock).not.toHaveBeenCalled();
    expect(commitCallJobStageMock).toHaveBeenCalledWith(fakeClient, {
      jobId: "job-1",
      expectedStatus: "downloading",
      nextStatus: "transcribing",
    });
    expect(result).toEqual({ ok: true, value: { status: "transcribing" } });
  });

  it("録音が見つからない場合は KMB-E804 (commit しない)", async () => {
    getCallRecordingByIdMock.mockResolvedValue({ ok: true, value: null });

    const result = await STAGE_HANDLERS.downloading({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "downloading" }) });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E804");
    expect(commitCallJobStageMock).not.toHaveBeenCalled();
  });

  it("404 (notFound) かつ最終試行未満 (stage_attempts < 3): 不確定 return (commit しない)", async () => {
    getCallRecordingByIdMock.mockResolvedValue({ ok: true, value: makeRecordingRow() });
    downloadRecordingMock.mockResolvedValue({ ok: true, value: { notFound: true } });

    const result = await STAGE_HANDLERS.downloading({
      client: fakeClient,
      jobId: "job-1",
      row: makeRow({ status: "downloading", stage_attempts: 1 }),
    });

    expect(commitCallJobStageMock).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, value: { status: "downloading" } });
  });

  it("404 (notFound) かつ最終試行 (stage_attempts===CALL_JOB_MAX_ATTEMPTS): KMB-E805 で確定 failed する", async () => {
    getCallRecordingByIdMock.mockResolvedValue({ ok: true, value: makeRecordingRow() });
    downloadRecordingMock.mockResolvedValue({ ok: true, value: { notFound: true } });
    commitCallJobStageMock.mockResolvedValue({ ok: true, value: "failed" });

    const result = await STAGE_HANDLERS.downloading({
      client: fakeClient,
      jobId: "job-1",
      row: makeRow({ status: "downloading", stage_attempts: CALL_JOB_MAX_ATTEMPTS }),
    });

    expect(commitCallJobStageMock).toHaveBeenCalledWith(fakeClient, {
      jobId: "job-1",
      expectedStatus: "downloading",
      nextStatus: "failed",
      errorCode: "KMB-E805",
    });
    expect(result).toEqual({ ok: true, value: { status: "failed" } });
  });

  it("サイズガード超過 (>200MB): commit で failed/KMB-E805 に確定する (Storage upload は行わない)", async () => {
    getCallRecordingByIdMock.mockResolvedValue({ ok: true, value: makeRecordingRow() });
    downloadRecordingMock.mockResolvedValue({
      ok: true,
      value: { bytes: { length: 200_000_001 } as unknown as Uint8Array, contentType: "audio/wav" },
    });
    commitCallJobStageMock.mockResolvedValue({ ok: true, value: "failed" });

    const result = await STAGE_HANDLERS.downloading({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "downloading" }) });

    expect(storageUploadMock).not.toHaveBeenCalled();
    expect(commitCallJobStageMock).toHaveBeenCalledWith(fakeClient, {
      jobId: "job-1",
      expectedStatus: "downloading",
      nextStatus: "failed",
      errorCode: "KMB-E805",
    });
    expect(result).toEqual({ ok: true, value: { status: "failed" } });
  });

  it("正常DL: Storage に保存し updateCallRecordingStorage を経て transcribing へ commit する (削除設定OFF時は deleteRecording を呼ばない)", async () => {
    const recording = makeRecordingRow();
    getCallRecordingByIdMock.mockResolvedValue({ ok: true, value: recording });
    downloadRecordingMock.mockResolvedValue({ ok: true, value: { bytes: new Uint8Array([1, 2, 3]), contentType: "audio/wav" } });
    commitCallJobStageMock.mockResolvedValue({ ok: true, value: "transcribing" });

    const result = await STAGE_HANDLERS.downloading({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "downloading" }) });

    expect(storageUploadMock).toHaveBeenCalledWith(
      `${recording.call_id}/${recording.recording_sid}.wav`,
      expect.anything(),
      { contentType: "audio/wav", upsert: true },
    );
    expect(updateCallRecordingStorageMock).toHaveBeenCalledWith(fakeClient, recording.id, {
      storage_path: `${recording.call_id}/${recording.recording_sid}.wav`,
      byte_size: 3,
    });
    expect(deleteRecordingMock).not.toHaveBeenCalled();
    expect(commitCallJobStageMock).toHaveBeenCalledWith(fakeClient, {
      jobId: "job-1",
      expectedStatus: "downloading",
      nextStatus: "transcribing",
    });
    expect(result).toEqual({ ok: true, value: { status: "transcribing" } });
  });

  it("削除設定ON: DL成功後 deleteRecording を呼び、成功時は twilio_deleted_at を反映してから前進する (ベストエフォート)", async () => {
    const recording = makeRecordingRow();
    getCallRecordingByIdMock.mockResolvedValue({ ok: true, value: recording });
    downloadRecordingMock.mockResolvedValue({ ok: true, value: { bytes: new Uint8Array([1, 2]), contentType: "audio/wav" } });
    settingsGetMock.mockResolvedValue({ ok: true, value: { ...DEFAULT_TELEPHONY_SETTINGS, delete_twilio_recording_after_download: true } });
    deleteRecordingMock.mockResolvedValue({ ok: true, value: undefined });
    commitCallJobStageMock.mockResolvedValue({ ok: true, value: "transcribing" });

    const result = await STAGE_HANDLERS.downloading({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "downloading" }) });

    expect(deleteRecordingMock).toHaveBeenCalledWith(recording.twilio_url);
    expect(updateCallRecordingStorageMock).toHaveBeenCalledTimes(2);
    const secondCallPatch = updateCallRecordingStorageMock.mock.calls[1][2] as { twilio_deleted_at: string | null };
    expect(secondCallPatch.twilio_deleted_at).not.toBeNull();
    expect(commitCallJobStageMock).toHaveBeenCalledWith(fakeClient, {
      jobId: "job-1",
      expectedStatus: "downloading",
      nextStatus: "transcribing",
    });
    expect(result).toEqual({ ok: true, value: { status: "transcribing" } });
  });

  it("削除失敗はベストエフォート: deleteRecording が失敗しても前進する (twilio_deleted_at は反映しない)", async () => {
    const recording = makeRecordingRow();
    getCallRecordingByIdMock.mockResolvedValue({ ok: true, value: recording });
    downloadRecordingMock.mockResolvedValue({ ok: true, value: { bytes: new Uint8Array([1]), contentType: "audio/wav" } });
    settingsGetMock.mockResolvedValue({ ok: true, value: { ...DEFAULT_TELEPHONY_SETTINGS, delete_twilio_recording_after_download: true } });
    deleteRecordingMock.mockResolvedValue({ ok: false, code: "KMB-E805", detail: "delete failed" });
    commitCallJobStageMock.mockResolvedValue({ ok: true, value: "transcribing" });

    const result = await STAGE_HANDLERS.downloading({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "downloading" }) });

    expect(updateCallRecordingStorageMock).toHaveBeenCalledTimes(1); // twilio_deleted_at 反映は行われない
    expect(result).toEqual({ ok: true, value: { status: "transcribing" } });
  });

  it("Storage への upload 自体が失敗した場合は KMB-E805 を commit せずそのまま返す", async () => {
    getCallRecordingByIdMock.mockResolvedValue({ ok: true, value: makeRecordingRow() });
    downloadRecordingMock.mockResolvedValue({ ok: true, value: { bytes: new Uint8Array([1]), contentType: "audio/wav" } });
    storageUploadMock.mockResolvedValue({ data: null, error: { message: "storage down" } });

    const result = await STAGE_HANDLERS.downloading({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "downloading" }) });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E805");
    expect(commitCallJobStageMock).not.toHaveBeenCalled();
  });
});

describe("handleTranscribing (§6.5.2、最難関)", () => {
  beforeEach(() => {
    getCallJobByIdMock.mockResolvedValue({ ok: true, value: makeJobRow({ transcript_partial: null }) });
  });

  it("再入ガード: row.transcript が既に確定済みなら analyzing へ前進するのみ (Storage/segmenter/transcribe は一切呼ばれない)", async () => {
    commitCallJobStageMock.mockResolvedValue({ ok: true, value: "analyzing" });

    const result = await STAGE_HANDLERS.transcribing({
      client: fakeClient,
      jobId: "job-1",
      row: makeRow({ status: "transcribing", transcript: SAMPLE_TRANSCRIPT }),
    });

    expect(storageDownloadMock).not.toHaveBeenCalled();
    expect(segmentCallRecordingMock).not.toHaveBeenCalled();
    expect(transcribeMock).not.toHaveBeenCalled();
    expect(commitCallJobStageMock).toHaveBeenCalledWith(fakeClient, {
      jobId: "job-1",
      expectedStatus: "transcribing",
      nextStatus: "analyzing",
      transcript: SAMPLE_TRANSCRIPT,
    });
    expect(result).toEqual({ ok: true, value: { status: "analyzing" } });
  });

  it("処理上限超過 (duration_seconds > max_processing_minutes*60): KMB-E822 で確定 failed する", async () => {
    getCallRecordingByIdMock.mockResolvedValue({ ok: true, value: makeRecordingRow({ duration_seconds: 3600 }) });
    settingsGetMock.mockResolvedValue({ ok: true, value: { ...DEFAULT_TELEPHONY_SETTINGS, max_processing_minutes: 30 } });
    commitCallJobStageMock.mockResolvedValue({ ok: true, value: "failed" });

    const result = await STAGE_HANDLERS.transcribing({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "transcribing" }) });

    expect(segmentCallRecordingMock).not.toHaveBeenCalled();
    expect(commitCallJobStageMock).toHaveBeenCalledWith(fakeClient, {
      jobId: "job-1",
      expectedStatus: "transcribing",
      nextStatus: "failed",
      errorCode: "KMB-E822",
    });
    expect(result).toEqual({ ok: true, value: { status: "failed" } });
  });

  it("storage_path が未設定 (理論上到達しない防御): KMB-E901 を返す", async () => {
    getCallRecordingByIdMock.mockResolvedValue({ ok: true, value: makeRecordingRow({ storage_path: null }) });

    const result = await STAGE_HANDLERS.transcribing({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "transcribing" }) });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E901");
  });

  it("Storage からの録音取得に失敗した場合は KMB-E805 (commit しない)", async () => {
    getCallRecordingByIdMock.mockResolvedValue({ ok: true, value: makeRecordingRow({ storage_path: "call-1/rec-1.wav" }) });
    storageDownloadMock.mockResolvedValue({ data: null, error: { message: "not found" } });

    const result = await STAGE_HANDLERS.transcribing({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "transcribing" }) });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E805");
    expect(commitCallJobStageMock).not.toHaveBeenCalled();
  });

  it("segmenter が失敗した場合は KMB-E822 で確定 failed する", async () => {
    getCallRecordingByIdMock.mockResolvedValue({ ok: true, value: makeRecordingRow({ storage_path: "call-1/rec-1.wav" }) });
    storageDownloadMock.mockResolvedValue({ data: { arrayBuffer: async () => new ArrayBuffer(4) }, error: null });
    segmentCallRecordingMock.mockReturnValue({ ok: false, code: "KMB-E822", detail: "bad wav" });
    commitCallJobStageMock.mockResolvedValue({ ok: true, value: "failed" });

    const result = await STAGE_HANDLERS.transcribing({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "transcribing" }) });

    expect(commitCallJobStageMock).toHaveBeenCalledWith(fakeClient, {
      jobId: "job-1",
      expectedStatus: "transcribing",
      nextStatus: "failed",
      errorCode: "KMB-E822",
    });
    expect(result).toEqual({ ok: true, value: { status: "failed" } });
  });

  it("チェックポイント再開: 既完了セグメントは再送しない (transcribe は未完了分のみ呼ばれる)", async () => {
    getCallRecordingByIdMock.mockResolvedValue({ ok: true, value: makeRecordingRow({ storage_path: "call-1/rec-1.wav" }) });
    storageDownloadMock.mockResolvedValue({ data: { arrayBuffer: async () => new ArrayBuffer(4) }, error: null });
    segmentCallRecordingMock.mockReturnValue({
      ok: true,
      value: [
        { channel: 0, index: 0, wavBytes: new Uint8Array([1]) },
        { channel: 0, index: 1, wavBytes: new Uint8Array([2]) },
      ],
    });
    getCallJobByIdMock.mockResolvedValue({
      ok: true,
      value: makeJobRow({ transcript_partial: { segments: [{ channel: 0, index: 0, text: "既存分" }] } }),
    });
    transcribeMock.mockResolvedValue({ ok: true, value: { text: "新規分", costMicroUsd: 5 } });
    commitCallJobStageMock.mockResolvedValue({ ok: true, value: "analyzing" });

    const result = await STAGE_HANDLERS.transcribing({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "transcribing" }) });

    expect(transcribeMock).toHaveBeenCalledTimes(1);
    const transcribeCallArgs = transcribeMock.mock.calls[0][0] as { filename: string };
    expect(transcribeCallArgs.filename).toContain("c0-s1"); // index1 のみ (index0 はcheckpoint済み)
    expect(commitCallJobStageMock).toHaveBeenCalledWith(fakeClient, {
      jobId: "job-1",
      expectedStatus: "transcribing",
      nextStatus: "analyzing",
      transcript: {
        segments: [
          { channel: 0, index: 0, text: "既存分" },
          { channel: 0, index: 1, text: "新規分" },
        ],
        full_text: "既存分\n新規分",
      },
      aiCostDeltaMicroUsd: 5,
    });
    expect(result).toEqual({ ok: true, value: { status: "analyzing" } });
  });

  it("KMB-E407 (予算上限): その場で確定 failed する (蓄積コストも一緒にcommitされる)", async () => {
    getCallRecordingByIdMock.mockResolvedValue({ ok: true, value: makeRecordingRow({ storage_path: "call-1/rec-1.wav" }) });
    storageDownloadMock.mockResolvedValue({ data: { arrayBuffer: async () => new ArrayBuffer(4) }, error: null });
    segmentCallRecordingMock.mockReturnValue({ ok: true, value: [{ channel: 0, index: 0, wavBytes: new Uint8Array([1]) }] });
    transcribeMock.mockResolvedValue({ ok: false, code: "KMB-E407", detail: "budget" });
    commitCallJobStageMock.mockResolvedValue({ ok: true, value: "failed" });

    const result = await STAGE_HANDLERS.transcribing({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "transcribing" }) });

    expect(commitCallJobStageMock).toHaveBeenCalledWith(fakeClient, {
      jobId: "job-1",
      expectedStatus: "transcribing",
      nextStatus: "failed",
      errorCode: "KMB-E407",
      aiCostDeltaMicroUsd: 0,
    });
    expect(result).toEqual({ ok: true, value: { status: "failed" } });
  });

  it("KMB-E408 (全キー失敗) かつ0件完了: 不確定 return (commit しない、transcribe の失敗結果をそのまま返す)", async () => {
    getCallRecordingByIdMock.mockResolvedValue({ ok: true, value: makeRecordingRow({ storage_path: "call-1/rec-1.wav" }) });
    storageDownloadMock.mockResolvedValue({ data: { arrayBuffer: async () => new ArrayBuffer(4) }, error: null });
    segmentCallRecordingMock.mockReturnValue({ ok: true, value: [{ channel: 0, index: 0, wavBytes: new Uint8Array([1]) }] });
    const failure = { ok: false, code: "KMB-E408", detail: "all keys failed" };
    transcribeMock.mockResolvedValue(failure);

    const result = await STAGE_HANDLERS.transcribing({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "transcribing" }) });

    expect(commitCallJobStageMock).not.toHaveBeenCalled();
    expect(result).toEqual(failure);
  });

  it("KMB-E408 かつ1件以上完了済み: 進捗 commit (status維持) して終了する", async () => {
    getCallRecordingByIdMock.mockResolvedValue({ ok: true, value: makeRecordingRow({ storage_path: "call-1/rec-1.wav" }) });
    storageDownloadMock.mockResolvedValue({ data: { arrayBuffer: async () => new ArrayBuffer(4) }, error: null });
    segmentCallRecordingMock.mockReturnValue({
      ok: true,
      value: [
        { channel: 0, index: 0, wavBytes: new Uint8Array([1]) },
        { channel: 0, index: 1, wavBytes: new Uint8Array([2]) },
      ],
    });
    transcribeMock
      .mockResolvedValueOnce({ ok: true, value: { text: "seg0", costMicroUsd: 3 } })
      .mockResolvedValueOnce({ ok: false, code: "KMB-E408", detail: "all keys failed" });
    commitCallJobStageMock.mockResolvedValue({ ok: true, value: "transcribing" });

    const result = await STAGE_HANDLERS.transcribing({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "transcribing" }) });

    expect(commitCallJobStageMock).toHaveBeenCalledWith(fakeClient, {
      jobId: "job-1",
      expectedStatus: "transcribing",
      nextStatus: "transcribing",
      aiCostDeltaMicroUsd: 3,
    });
    expect(result).toEqual({ ok: true, value: { status: "transcribing" } });
  });

  it("その他の転写失敗: セグメント単位で1回だけ再試行し、成功すれば継続する", async () => {
    getCallRecordingByIdMock.mockResolvedValue({ ok: true, value: makeRecordingRow({ storage_path: "call-1/rec-1.wav" }) });
    storageDownloadMock.mockResolvedValue({ data: { arrayBuffer: async () => new ArrayBuffer(4) }, error: null });
    segmentCallRecordingMock.mockReturnValue({ ok: true, value: [{ channel: 0, index: 0, wavBytes: new Uint8Array([1]) }] });
    transcribeMock
      .mockResolvedValueOnce({ ok: false, code: "KMB-E901", detail: "transient" })
      .mockResolvedValueOnce({ ok: true, value: { text: "リトライ成功", costMicroUsd: 7 } });
    commitCallJobStageMock.mockResolvedValue({ ok: true, value: "analyzing" });

    const result = await STAGE_HANDLERS.transcribing({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "transcribing" }) });

    expect(transcribeMock).toHaveBeenCalledTimes(2);
    expect(commitCallJobStageMock).toHaveBeenCalledWith(fakeClient, {
      jobId: "job-1",
      expectedStatus: "transcribing",
      nextStatus: "analyzing",
      transcript: { segments: [{ channel: 0, index: 0, text: "リトライ成功" }], full_text: "リトライ成功" },
      aiCostDeltaMicroUsd: 7,
    });
    expect(result).toEqual({ ok: true, value: { status: "analyzing" } });
  });

  it("その他の転写失敗が再試行後も失敗する場合: KMB-E820 で確定 failed する", async () => {
    getCallRecordingByIdMock.mockResolvedValue({ ok: true, value: makeRecordingRow({ storage_path: "call-1/rec-1.wav" }) });
    storageDownloadMock.mockResolvedValue({ data: { arrayBuffer: async () => new ArrayBuffer(4) }, error: null });
    segmentCallRecordingMock.mockReturnValue({ ok: true, value: [{ channel: 0, index: 0, wavBytes: new Uint8Array([1]) }] });
    transcribeMock
      .mockResolvedValueOnce({ ok: false, code: "KMB-E901", detail: "transient" })
      .mockResolvedValueOnce({ ok: false, code: "KMB-E901", detail: "still failing" });
    commitCallJobStageMock.mockResolvedValue({ ok: true, value: "failed" });

    const result = await STAGE_HANDLERS.transcribing({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "transcribing" }) });

    expect(transcribeMock).toHaveBeenCalledTimes(2);
    expect(commitCallJobStageMock).toHaveBeenCalledWith(fakeClient, {
      jobId: "job-1",
      expectedStatus: "transcribing",
      nextStatus: "failed",
      errorCode: "KMB-E820",
      aiCostDeltaMicroUsd: 0,
    });
    expect(result).toEqual({ ok: true, value: { status: "failed" } });
  });

  it("残余時間ガード: 次セグメント開始前に予算超過を検知したら完了済み分のみ進捗commitし、以降のセグメントには着手しない", async () => {
    getCallRecordingByIdMock.mockResolvedValue({ ok: true, value: makeRecordingRow({ storage_path: "call-1/rec-1.wav" }) });
    storageDownloadMock.mockResolvedValue({ data: { arrayBuffer: async () => new ArrayBuffer(4) }, error: null });
    segmentCallRecordingMock.mockReturnValue({
      ok: true,
      value: [
        { channel: 0, index: 0, wavBytes: new Uint8Array([1]) },
        { channel: 0, index: 1, wavBytes: new Uint8Array([2]) },
      ],
    });
    transcribeMock.mockResolvedValue({ ok: true, value: { text: "seg", costMicroUsd: 9 } });
    commitCallJobStageMock.mockResolvedValue({ ok: true, value: "transcribing" });

    const startedAt = 2_000_000;
    const overBudgetForSegment2 = startedAt + (TELEPHONY_WAKE_SOFT_BUDGET_MS - TRANSCRIBE_SEGMENT_WORST_MS) + 1;
    const dateSpy = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(startedAt) // wakeStartedAt
      .mockReturnValueOnce(startedAt) // segment0 の残余チェック (経過0 → 着手)
      .mockReturnValueOnce(overBudgetForSegment2); // segment1 の残余チェック (超過 → 打ち切り)

    const result = await STAGE_HANDLERS.transcribing({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "transcribing" }) });

    expect(transcribeMock).toHaveBeenCalledTimes(1); // segment1 には着手しない
    expect(commitCallJobStageMock).toHaveBeenCalledWith(fakeClient, {
      jobId: "job-1",
      expectedStatus: "transcribing",
      nextStatus: "transcribing",
      aiCostDeltaMicroUsd: 9,
    });
    expect(result).toEqual({ ok: true, value: { status: "transcribing" } });

    dateSpy.mockRestore();
  });

  it("全セグメント完了: channel昇順・index昇順で連結した transcript を analyzing へ commit する", async () => {
    getCallRecordingByIdMock.mockResolvedValue({ ok: true, value: makeRecordingRow({ storage_path: "call-1/rec-1.wav" }) });
    storageDownloadMock.mockResolvedValue({ data: { arrayBuffer: async () => new ArrayBuffer(4) }, error: null });
    segmentCallRecordingMock.mockReturnValue({
      ok: true,
      value: [
        { channel: 1, index: 0, wavBytes: new Uint8Array([1]) },
        { channel: 0, index: 1, wavBytes: new Uint8Array([2]) },
        { channel: 0, index: 0, wavBytes: new Uint8Array([3]) },
      ],
    });
    transcribeMock.mockImplementation(async (req: { filename: string }) => ({
      ok: true,
      value: { text: req.filename, costMicroUsd: 1 },
    }));
    commitCallJobStageMock.mockResolvedValue({ ok: true, value: "analyzing" });

    const result = await STAGE_HANDLERS.transcribing({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "transcribing" }) });

    expect(commitCallJobStageMock).toHaveBeenCalledTimes(1);
    const commitArgs = commitCallJobStageMock.mock.calls[0][1] as {
      transcript: { segments: { channel: number; index: number }[] };
      aiCostDeltaMicroUsd: number;
    };
    expect(commitArgs.transcript.segments.map((s) => `${s.channel}:${s.index}`)).toEqual(["0:0", "0:1", "1:0"]);
    expect(commitArgs.aiCostDeltaMicroUsd).toBe(3);
    expect(result).toEqual({ ok: true, value: { status: "analyzing" } });
  });
});

describe("handleAnalyzing (§6.5.3)", () => {
  beforeEach(() => {
    getCallJobByIdMock.mockResolvedValue({
      ok: true,
      value: makeJobRow({ status: "analyzing", transcript: SAMPLE_TRANSCRIPT, analysis: null }),
    });
    getCallByIdMock.mockResolvedValue({ ok: true, value: makeCallRow() });
  });

  it("再入ガード: analysis が既に確定済みなら linking へ前進するのみ (generateText は呼ばれない)", async () => {
    getCallJobByIdMock.mockResolvedValue({
      ok: true,
      value: makeJobRow({ status: "analyzing", transcript: SAMPLE_TRANSCRIPT, analysis: VALID_ANALYSIS }),
    });
    commitCallJobStageMock.mockResolvedValue({ ok: true, value: "linking" });

    const result = await STAGE_HANDLERS.analyzing({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "analyzing" }) });

    expect(generateTextMock).not.toHaveBeenCalled();
    expect(commitCallJobStageMock).toHaveBeenCalledWith(fakeClient, {
      jobId: "job-1",
      expectedStatus: "analyzing",
      nextStatus: "linking",
      analysis: VALID_ANALYSIS,
    });
    expect(result).toEqual({ ok: true, value: { status: "linking" } });
  });

  it("transcript が未設定 (理論上到達しない防御): KMB-E901 を返す", async () => {
    getCallJobByIdMock.mockResolvedValue({ ok: true, value: makeJobRow({ status: "analyzing", transcript: null, analysis: null }) });

    const result = await STAGE_HANDLERS.analyzing({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "analyzing" }) });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E901");
  });

  it("通話が見つからない場合は KMB-E804", async () => {
    getCallByIdMock.mockResolvedValue({ ok: true, value: null });

    const result = await STAGE_HANDLERS.analyzing({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "analyzing" }) });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E804");
  });

  it("KMB-E407 (予算上限): その場で確定 failed する (再試行しない)", async () => {
    generateTextMock.mockResolvedValue({ ok: false, code: "KMB-E407", detail: "budget" });
    commitCallJobStageMock.mockResolvedValue({ ok: true, value: "failed" });

    const result = await STAGE_HANDLERS.analyzing({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "analyzing" }) });

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(commitCallJobStageMock).toHaveBeenCalledWith(fakeClient, {
      jobId: "job-1",
      expectedStatus: "analyzing",
      nextStatus: "failed",
      errorCode: "KMB-E407",
    });
    expect(result).toEqual({ ok: true, value: { status: "failed" } });
  });

  it("KMB-E408 (全キー失敗): 不確定 return (commit しない)", async () => {
    const failure = { ok: false, code: "KMB-E408", detail: "all keys failed" };
    generateTextMock.mockResolvedValue(failure);

    const result = await STAGE_HANDLERS.analyzing({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "analyzing" }) });

    expect(commitCallJobStageMock).not.toHaveBeenCalled();
    expect(result).toEqual(failure);
  });

  it("refusal: 再生成せず即 KMB-E821 で確定 failed する (generateText は1回のみ)", async () => {
    generateTextMock.mockResolvedValue({
      ok: true,
      value: { text: "", provider: "anthropic", model: "test", usage: USAGE_ZERO, costMicroUsd: 100, stopReason: "refusal" },
    });
    commitCallJobStageMock.mockResolvedValue({ ok: true, value: "failed" });

    const result = await STAGE_HANDLERS.analyzing({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "analyzing" }) });

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(commitCallJobStageMock).toHaveBeenCalledWith(fakeClient, {
      jobId: "job-1",
      expectedStatus: "analyzing",
      nextStatus: "failed",
      errorCode: "KMB-E821",
      aiCostDeltaMicroUsd: 100,
    });
    expect(result).toEqual({ ok: true, value: { status: "failed" } });
  });

  it("max_tokens (JSON/Zodは通る): 1回だけ再生成し、成功すればその結果を採用する", async () => {
    generateTextMock
      .mockResolvedValueOnce({
        ok: true,
        value: {
          text: JSON.stringify(VALID_ANALYSIS),
          provider: "anthropic",
          model: "test",
          usage: USAGE_ZERO,
          costMicroUsd: 10,
          stopReason: "max_tokens",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          text: JSON.stringify(VALID_ANALYSIS),
          provider: "anthropic",
          model: "test",
          usage: USAGE_ZERO,
          costMicroUsd: 20,
          stopReason: "end_turn",
        },
      });
    commitCallJobStageMock.mockResolvedValue({ ok: true, value: "linking" });

    const result = await STAGE_HANDLERS.analyzing({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "analyzing" }) });

    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(commitCallJobStageMock).toHaveBeenCalledWith(fakeClient, {
      jobId: "job-1",
      expectedStatus: "analyzing",
      nextStatus: "linking",
      analysis: VALID_ANALYSIS,
      aiCostDeltaMicroUsd: 30,
    });
    expect(result).toEqual({ ok: true, value: { status: "linking" } });
  });

  it("AI出力がJSONとして解析できない: 1回だけ再生成し、再生成も失敗すれば KMB-E821 で確定 failed する", async () => {
    generateTextMock
      .mockResolvedValueOnce({
        ok: true,
        value: { text: "not-json", provider: "anthropic", model: "test", usage: USAGE_ZERO, costMicroUsd: 5, stopReason: "end_turn" },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          text: "still-not-json",
          provider: "anthropic",
          model: "test",
          usage: USAGE_ZERO,
          costMicroUsd: 8,
          stopReason: "end_turn",
        },
      });
    commitCallJobStageMock.mockResolvedValue({ ok: true, value: "failed" });

    const result = await STAGE_HANDLERS.analyzing({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "analyzing" }) });

    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(commitCallJobStageMock).toHaveBeenCalledWith(fakeClient, {
      jobId: "job-1",
      expectedStatus: "analyzing",
      nextStatus: "failed",
      errorCode: "KMB-E821",
      aiCostDeltaMicroUsd: 13,
    });
    expect(result).toEqual({ ok: true, value: { status: "failed" } });
  });

  it("スキーマ不一致 (zCallAnalysis.safeParse失敗): 再生成が成功すれば採用する", async () => {
    const invalidJson = JSON.stringify({ minutes: { summary: "x" } }); // tasks 欠落等でスキーマ不一致
    generateTextMock
      .mockResolvedValueOnce({
        ok: true,
        value: { text: invalidJson, provider: "anthropic", model: "test", usage: USAGE_ZERO, costMicroUsd: 1, stopReason: "end_turn" },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          text: JSON.stringify(VALID_ANALYSIS),
          provider: "anthropic",
          model: "test",
          usage: USAGE_ZERO,
          costMicroUsd: 2,
          stopReason: "end_turn",
        },
      });
    commitCallJobStageMock.mockResolvedValue({ ok: true, value: "linking" });

    const result = await STAGE_HANDLERS.analyzing({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "analyzing" }) });

    expect(commitCallJobStageMock).toHaveBeenCalledWith(fakeClient, {
      jobId: "job-1",
      expectedStatus: "analyzing",
      nextStatus: "linking",
      analysis: VALID_ANALYSIS,
      aiCostDeltaMicroUsd: 3,
    });
    expect(result).toEqual({ ok: true, value: { status: "linking" } });
  });

  it("1回目が invalid、再生成 (2回目) が KMB-E407: 蓄積コストとともに確定 failed する", async () => {
    generateTextMock
      .mockResolvedValueOnce({
        ok: true,
        value: { text: "not-json", provider: "anthropic", model: "test", usage: USAGE_ZERO, costMicroUsd: 5, stopReason: "end_turn" },
      })
      .mockResolvedValueOnce({ ok: false, code: "KMB-E407", detail: "budget" });
    commitCallJobStageMock.mockResolvedValue({ ok: true, value: "failed" });

    const result = await STAGE_HANDLERS.analyzing({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "analyzing" }) });

    expect(commitCallJobStageMock).toHaveBeenCalledWith(fakeClient, {
      jobId: "job-1",
      expectedStatus: "analyzing",
      nextStatus: "failed",
      errorCode: "KMB-E407",
      aiCostDeltaMicroUsd: 5,
    });
    expect(result).toEqual({ ok: true, value: { status: "failed" } });
  });

  it("1回目が invalid、再生成 (2回目) が KMB-E408: 不確定 return", async () => {
    const secondFailure = { ok: false, code: "KMB-E408", detail: "all keys failed" };
    generateTextMock
      .mockResolvedValueOnce({
        ok: true,
        value: { text: "not-json", provider: "anthropic", model: "test", usage: USAGE_ZERO, costMicroUsd: 5, stopReason: "end_turn" },
      })
      .mockResolvedValueOnce(secondFailure);

    const result = await STAGE_HANDLERS.analyzing({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "analyzing" }) });

    expect(commitCallJobStageMock).not.toHaveBeenCalled();
    expect(result).toEqual(secondFailure);
  });

  it("成功 (1回目): commit next=linking, analysis/aiCostDeltaMicroUsd を渡す。generateText には feature/refTable/refId/ctx が正しく渡る", async () => {
    generateTextMock.mockResolvedValue({
      ok: true,
      value: {
        text: JSON.stringify(VALID_ANALYSIS),
        provider: "anthropic",
        model: "test",
        usage: USAGE_ZERO,
        costMicroUsd: 42,
        stopReason: "end_turn",
      },
    });
    commitCallJobStageMock.mockResolvedValue({ ok: true, value: "linking" });

    const result = await STAGE_HANDLERS.analyzing({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "analyzing" }) });

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const callArgs = generateTextMock.mock.calls[0][0] as { feature: string; refTable: string; refId: string };
    expect(callArgs.feature).toBe("call-analysis");
    expect(callArgs.refTable).toBe("call_jobs");
    expect(callArgs.refId).toBe("job-1");
    expect(generateTextMock.mock.calls[0][1]).toEqual({ mode: "service" });
    expect(commitCallJobStageMock).toHaveBeenCalledWith(fakeClient, {
      jobId: "job-1",
      expectedStatus: "analyzing",
      nextStatus: "linking",
      analysis: VALID_ANALYSIS,
      aiCostDeltaMicroUsd: 42,
    });
    expect(result).toEqual({ ok: true, value: { status: "linking" } });
  });
});

describe("handleLinking (§6.5.4)", () => {
  beforeEach(() => {
    getCallJobByIdMock.mockResolvedValue({
      ok: true,
      value: makeJobRow({ status: "linking", analysis: VALID_ANALYSIS, link_result: null }),
    });
    getCallByIdMock.mockResolvedValue({ ok: true, value: makeCallRow() });
    commitCallJobStageMock.mockResolvedValue({ ok: true, value: "done" });
    reflectLinkResultToCallsMock.mockResolvedValue({ ok: true, value: { skipped: false } });
  });

  it("再入ガード: link_result が既に確定済みなら done へ前進するのみ (顧客マッチ/appendActivity/createTaskは呼ばれない)", async () => {
    const existingLinkResult: CallJobLinkResult = {
      outcome: "matched",
      customer_id: "cust-1",
      activity_id: "act-1",
      activity_created: true,
      task_ids: [],
      warning: null,
    };
    getCallJobByIdMock.mockResolvedValue({
      ok: true,
      value: makeJobRow({ status: "linking", analysis: VALID_ANALYSIS, link_result: existingLinkResult }),
    });

    const result = await STAGE_HANDLERS.linking({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "linking" }) });

    expect(matchCustomerByPhoneMock).not.toHaveBeenCalled();
    expect(appendActivityMock).not.toHaveBeenCalled();
    expect(createTaskMock).not.toHaveBeenCalled();
    expect(commitCallJobStageMock).toHaveBeenCalledWith(fakeClient, {
      jobId: "job-1",
      expectedStatus: "linking",
      nextStatus: "done",
      linkResult: existingLinkResult,
    });
    expect(result).toEqual({ ok: true, value: { status: "done" } });
  });

  it("analysis が未設定 (理論上到達しない防御): KMB-E901 を返す", async () => {
    getCallJobByIdMock.mockResolvedValue({ ok: true, value: makeJobRow({ status: "linking", analysis: null, link_result: null }) });

    const result = await STAGE_HANDLERS.linking({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "linking" }) });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E901");
  });

  it("通話が見つからない場合は KMB-E804", async () => {
    getCallByIdMock.mockResolvedValue({ ok: true, value: null });

    const result = await STAGE_HANDLERS.linking({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "linking" }) });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E804");
  });

  it("from_e164 が null: outcome='no_number' になり顧客マッチ/appendActivityは試みない。タスクは常時再実行される", async () => {
    getCallByIdMock.mockResolvedValue({ ok: true, value: makeCallRow({ from_e164: null }) });

    const result = await STAGE_HANDLERS.linking({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "linking" }) });

    expect(matchCustomerByPhoneMock).not.toHaveBeenCalled();
    expect(appendActivityMock).not.toHaveBeenCalled(); // no_number は timeline 対象外
    expect(createTaskMock).toHaveBeenCalledTimes(VALID_ANALYSIS.tasks.length);
    expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({ customer_id: null, source_activity_id: null }), {
      mode: "service",
    });
    expect(reflectLinkResultToCallsMock).toHaveBeenCalledWith(fakeClient, "call-1", {
      customerId: null,
      matchStatus: "no_number",
      aiCostDeltaMicroUsd: 0,
    });
    const commitArgs = commitCallJobStageMock.mock.calls[0][1] as { linkResult: CallJobLinkResult };
    expect(commitArgs.linkResult.outcome).toBe("no_number");
    expect(result).toEqual({ ok: true, value: { status: "done" } });
  });

  it("matched: 既存顧客が見つかれば createCustomer は呼ばず、appendActivity/createTask に customer_id を渡す", async () => {
    matchCustomerByPhoneMock.mockResolvedValue({ ok: true, value: { customer_id: "cust-existing" } });
    appendActivityMock.mockResolvedValue({ ok: true, value: { activity_id: "act-1", created: true } });

    const result = await STAGE_HANDLERS.linking({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "linking" }) });

    expect(createCustomerMock).not.toHaveBeenCalled();
    expect(appendActivityMock).toHaveBeenCalledTimes(1);
    const appendArgs = appendActivityMock.mock.calls[0][0] as { links: { customer_id: string | null }[] };
    expect(appendArgs.links).toEqual([{ customer_id: "cust-existing", company_id: null, deal_id: null }]);
    expect(createTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({ customer_id: "cust-existing", source_activity_id: "act-1" }),
      { mode: "service" },
    );
    expect(reflectLinkResultToCallsMock).toHaveBeenCalledWith(fakeClient, "call-1", {
      customerId: "cust-existing",
      matchStatus: "matched",
      aiCostDeltaMicroUsd: 0,
    });
    expect(result).toEqual({ ok: true, value: { status: "done" } });
  });

  it("created: 既存顧客が見つからなければ createCustomer(force:true) を呼び、その customer_id を使う", async () => {
    matchCustomerByPhoneMock.mockResolvedValue({ ok: true, value: null });
    createCustomerMock.mockResolvedValue({ ok: true, value: { customer_id: "cust-new" } });
    appendActivityMock.mockResolvedValue({ ok: true, value: { activity_id: "act-2", created: true } });
    const call = makeCallRow();
    getCallByIdMock.mockResolvedValue({ ok: true, value: call });

    const result = await STAGE_HANDLERS.linking({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "linking" }) });

    expect(createCustomerMock).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "person", tel_e164: call.from_e164, lifecycle: "lead", source: "phone" }),
      { force: true },
      { mode: "service" },
    );
    expect(appendActivityMock).toHaveBeenCalledTimes(1);
    const appendArgs = appendActivityMock.mock.calls[0][0] as { links: { customer_id: string | null }[] };
    expect(appendArgs.links).toEqual([{ customer_id: "cust-new", company_id: null, deal_id: null }]);
    expect(result).toEqual({ ok: true, value: { status: "done" } });
  });

  it("【最重要地雷】KMB-E601 (同番号複数顧客): outcome='ambiguous' に変換し KMB-E823 警告を記録する — 不確定returnにせず必ずcommitまで進む", async () => {
    matchCustomerByPhoneMock.mockResolvedValue({ ok: false, code: "KMB-E601", detail: "候補2件" });

    const result = await STAGE_HANDLERS.linking({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "linking" }) });

    expect(createCustomerMock).not.toHaveBeenCalled();
    expect(appendActivityMock).not.toHaveBeenCalled(); // ambiguous は timeline 対象外
    // タスクは常時再実行 (ambiguous でも起票する)
    expect(createTaskMock).toHaveBeenCalledTimes(VALID_ANALYSIS.tasks.length);
    expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({ customer_id: null, source_activity_id: null }), {
      mode: "service",
    });
    // 不確定 return ではなく commit まで到達していること (地雷回避の核心アサーション)
    expect(commitCallJobStageMock).toHaveBeenCalledTimes(1);
    const commitArgs = commitCallJobStageMock.mock.calls[0][1] as { linkResult: CallJobLinkResult };
    expect(commitArgs.linkResult.outcome).toBe("ambiguous");
    expect(commitArgs.linkResult.warning).toContain("KMB-E823");
    expect(reflectLinkResultToCallsMock).toHaveBeenCalledWith(fakeClient, "call-1", {
      customerId: null,
      matchStatus: "ambiguous",
      aiCostDeltaMicroUsd: 0,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("done");
  });

  it("matchCustomerByPhone のその他失敗 (例: KMB-E603) は不確定 return にする (E601とは区別する)", async () => {
    const failure = { ok: false, code: "KMB-E603", detail: "unexpected" };
    matchCustomerByPhoneMock.mockResolvedValue(failure);

    const result = await STAGE_HANDLERS.linking({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "linking" }) });

    expect(commitCallJobStageMock).not.toHaveBeenCalled();
    expect(createTaskMock).not.toHaveBeenCalled();
    expect(result).toEqual(failure);
  });

  it("createCustomer が失敗した場合は不確定 return にする", async () => {
    matchCustomerByPhoneMock.mockResolvedValue({ ok: true, value: null });
    const failure = { ok: false, code: "KMB-E901", detail: "db down" };
    createCustomerMock.mockResolvedValue(failure);

    const result = await STAGE_HANDLERS.linking({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "linking" }) });

    expect(commitCallJobStageMock).not.toHaveBeenCalled();
    expect(result).toEqual(failure);
  });

  it("appendActivity が失敗した場合は不確定 return にする (createTask には進まない)", async () => {
    matchCustomerByPhoneMock.mockResolvedValue({ ok: true, value: { customer_id: "cust-1" } });
    const failure = { ok: false, code: "KMB-E901", detail: "db down" };
    appendActivityMock.mockResolvedValue(failure);

    const result = await STAGE_HANDLERS.linking({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "linking" }) });

    expect(createTaskMock).not.toHaveBeenCalled();
    expect(commitCallJobStageMock).not.toHaveBeenCalled();
    expect(result).toEqual(failure);
  });

  it("createTask が失敗した場合は不確定 return にする (以降のタスクは起票しない)", async () => {
    const twoTaskAnalysis: CallAnalysis = {
      ...VALID_ANALYSIS,
      tasks: [
        { title: "タスク1", detail: null, due_hint: null },
        { title: "タスク2", detail: null, due_hint: null },
      ],
    };
    getCallJobByIdMock.mockResolvedValue({
      ok: true,
      value: makeJobRow({ status: "linking", analysis: twoTaskAnalysis, link_result: null }),
    });
    matchCustomerByPhoneMock.mockResolvedValue({ ok: true, value: { customer_id: "cust-1" } });
    appendActivityMock.mockResolvedValue({ ok: true, value: { activity_id: "act-1", created: true } });
    const failure = { ok: false, code: "KMB-E901", detail: "db down" };
    createTaskMock.mockResolvedValueOnce({ ok: true, value: { task_id: "task-1" } }).mockResolvedValueOnce(failure);

    const result = await STAGE_HANDLERS.linking({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "linking" }) });

    expect(createTaskMock).toHaveBeenCalledTimes(2);
    expect(commitCallJobStageMock).not.toHaveBeenCalled();
    expect(result).toEqual(failure);
  });

  it("タスク常時再実行: appendActivity が created:false (2回目実行の冪等ヒット) でも createTask は全タスク分呼ばれる", async () => {
    matchCustomerByPhoneMock.mockResolvedValue({ ok: true, value: { customer_id: "cust-1" } });
    appendActivityMock.mockResolvedValue({ ok: true, value: { activity_id: "act-1", created: false } });

    const result = await STAGE_HANDLERS.linking({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "linking" }) });

    expect(createTaskMock).toHaveBeenCalledTimes(VALID_ANALYSIS.tasks.length);
    const commitArgs = commitCallJobStageMock.mock.calls[0][1] as { linkResult: CallJobLinkResult };
    expect(commitArgs.linkResult.activity_created).toBe(false);
    expect(result).toEqual({ ok: true, value: { status: "done" } });
  });

  it("reflectLinkResultToCalls が失敗した場合は不確定 return にする", async () => {
    matchCustomerByPhoneMock.mockResolvedValue({ ok: true, value: { customer_id: "cust-1" } });
    appendActivityMock.mockResolvedValue({ ok: true, value: { activity_id: "act-1", created: true } });
    const failure = { ok: false, code: "KMB-E901", detail: "db down" };
    reflectLinkResultToCallsMock.mockResolvedValue(failure);

    const result = await STAGE_HANDLERS.linking({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "linking" }) });

    expect(commitCallJobStageMock).not.toHaveBeenCalled();
    expect(result).toEqual(failure);
  });

  it("【手動確定保護】reflectLinkResultToCalls が skipped:true を返した場合、linkResult.warning に手動確定済みの注記が付く", async () => {
    matchCustomerByPhoneMock.mockResolvedValue({ ok: true, value: { customer_id: "cust-1" } });
    appendActivityMock.mockResolvedValue({ ok: true, value: { activity_id: "act-1", created: true } });
    reflectLinkResultToCallsMock.mockResolvedValue({ ok: true, value: { skipped: true } });

    const result = await STAGE_HANDLERS.linking({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "linking" }) });

    const commitArgs = commitCallJobStageMock.mock.calls[0][1] as { linkResult: CallJobLinkResult };
    expect(commitArgs.linkResult.warning).toContain("手動確定済み");
    expect(result).toEqual({ ok: true, value: { status: "done" } });
  });

  it("【duration_seconds nullフォールバック】calls.duration_seconds が null の場合、call_id 単位の録音duration合計を使う", async () => {
    getCallByIdMock.mockResolvedValue({ ok: true, value: makeCallRow({ duration_seconds: null }) });
    listCallRecordingsByCallIdMock.mockResolvedValue({
      ok: true,
      value: [makeRecordingRow({ duration_seconds: 30 }), makeRecordingRow({ id: "rec-2", duration_seconds: 45 })],
    });
    matchCustomerByPhoneMock.mockResolvedValue({ ok: true, value: { customer_id: "cust-1" } });
    appendActivityMock.mockResolvedValue({ ok: true, value: { activity_id: "act-1", created: true } });

    const result = await STAGE_HANDLERS.linking({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "linking" }) });

    const appendArgs = appendActivityMock.mock.calls[0][0] as { payload: { duration_seconds: number } };
    expect(appendArgs.payload.duration_seconds).toBe(75);
    expect(result).toEqual({ ok: true, value: { status: "done" } });
  });

  it("linkResult / commit: task_ids が createTask の返り値から組み立てられ、expectedStatus=linking/nextStatus=doneでcommitする", async () => {
    matchCustomerByPhoneMock.mockResolvedValue({ ok: true, value: { customer_id: "cust-1" } });
    appendActivityMock.mockResolvedValue({ ok: true, value: { activity_id: "act-1", created: true } });
    createTaskMock.mockResolvedValue({ ok: true, value: { task_id: "task-xyz" } });

    const result = await STAGE_HANDLERS.linking({ client: fakeClient, jobId: "job-1", row: makeRow({ status: "linking" }) });

    expect(commitCallJobStageMock).toHaveBeenCalledWith(fakeClient, {
      jobId: "job-1",
      expectedStatus: "linking",
      nextStatus: "done",
      linkResult: {
        outcome: "matched",
        customer_id: "cust-1",
        activity_id: "act-1",
        activity_created: true,
        task_ids: ["task-xyz"],
        warning: null,
      },
    });
    expect(result).toEqual({ ok: true, value: { status: "done" } });
  });
});
