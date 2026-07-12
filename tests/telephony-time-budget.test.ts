import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CallJobRow, CallRecordingRow } from "@/modules/telephony/repository";
import { TELEPHONY_WAKE_SOFT_BUDGET_MS, TRANSCRIBE_SEGMENT_WORST_MS } from "@/modules/telephony/internal/lease";

/**
 * 00-overview.md §3.1.4-8 (残余時間ガード) の統合的な検証: 30分の dual (2ch) 録音相当
 * (10分窓 × 3 + 端数 → 各chで4セグメント、2ch分で12セグメント) が 1 起床
 * (TELEPHONY_WAKE_SOFT_BUDGET_MS=240秒のソフト予算) には収まらず、チェックポイント
 * (call_jobs.transcript_partial) を介して複数起床にまたがって完走することを検証する
 * (issue-58 計画書「テスト戦略」節: tests/telephony-time-budget.test.ts)。
 *
 * vi.useFakeTimers() を使い、transcribeMock の呼び出しごとに TRANSCRIBE_SEGMENT_WORST_MS
 * (60秒) 相当だけ経過させることで「1セグメント転写に最悪ケースの時間がかかる」状況を
 * 決定的に再現する。handleTranscribing の残余時間ガード (§6.5.2-4(c)) は
 * `Date.now()` (= フェイクタイマー配下のシステム時刻) を参照するため、この手法で
 * 「1起床では終わらない」を確定的にトリガーできる。
 */

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

vi.mock("@/modules/crm/facade", () => ({
  crmFacade: {
    matchCustomerByPhone: vi.fn(),
    createCustomer: vi.fn(),
    appendActivity: vi.fn(),
    createTask: vi.fn(),
  },
}));

const settingsGetMock = vi.fn();
vi.mock("@/modules/settings/facade", () => ({
  settingsFacade: { get: (...args: unknown[]) => settingsGetMock(...args) },
}));

vi.mock("@/modules/telephony/internal/twilio-api", () => ({
  downloadRecording: vi.fn(),
  deleteRecording: vi.fn(),
}));

const segmentCallRecordingMock = vi.fn();
vi.mock("@/modules/telephony/internal/segmenter", () => ({
  segmentCallRecording: (...args: unknown[]) => segmentCallRecordingMock(...args),
}));

import { STAGE_HANDLERS } from "@/modules/telephony/internal/worker";
import { DEFAULT_TELEPHONY_SETTINGS } from "@/modules/telephony/internal/settings-defaults";

const storageDownloadMock = vi.fn();
const fakeClient = {
  storage: {
    from: () => ({
      upload: vi.fn(),
      download: (...args: unknown[]) => storageDownloadMock(...args),
    }),
  },
} as unknown as SupabaseClient;

function makeRecordingRow(overrides: Partial<CallRecordingRow> = {}): CallRecordingRow {
  return {
    id: "rec-1",
    call_id: "call-1",
    recording_sid: "RE00000000000000000000000000000001",
    source: "dial",
    twilio_url: "https://api.twilio.com/2010-04-01/Accounts/ACxxx/Recordings/RExxx",
    duration_seconds: 1795, // 30分弱の dual 録音
    channels: 2,
    storage_path: "call-1/rec-1.wav",
    byte_size: 1_000_000,
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

/** 30分dual録音相当: ch0/ch1 それぞれ 6 セグメント (10分窓×3+端数相当) = 計12セグメント。 */
const TWELVE_SEGMENTS = [
  ...Array.from({ length: 6 }, (_, i) => ({ channel: 0 as const, index: i, wavBytes: new Uint8Array([i]) })),
  ...Array.from({ length: 6 }, (_, i) => ({ channel: 1 as const, index: i, wavBytes: new Uint8Array([100 + i]) })),
];

describe("handleTranscribing: 30分dual録音相当 (12セグメント) が1起床に収まらず複数起床にまたがって完走する (§6.5.2-4(c) / 00-overview §3.1.4-8)", () => {
  // 進捗チェックポイント (call_jobs.transcript_partial 相当) を起床をまたいで保持する簡易ストア。
  // 実際の DB 書込は updateCallJobTranscriptPartial が行う想定だが、ここではその呼び出しを
  // フックしてテスト内のメモリ上に反映する (repository は vi.mock 済みで実 DB には触れない)。
  let checkpointSegments: { channel: number; index: number; text: string }[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));

    checkpointSegments = [];
    createSupabaseServiceClientMock.mockReturnValue(fakeClient);
    settingsGetMock.mockResolvedValue({ ok: true, value: { ...DEFAULT_TELEPHONY_SETTINGS, max_processing_minutes: 60 } });
    getCallRecordingByIdMock.mockResolvedValue({ ok: true, value: makeRecordingRow() });
    storageDownloadMock.mockResolvedValue({ data: { arrayBuffer: async () => new ArrayBuffer(4) }, error: null });
    segmentCallRecordingMock.mockReturnValue({ ok: true, value: TWELVE_SEGMENTS });

    updateCallJobTranscriptPartialMock.mockImplementation(
      async (_client: unknown, _jobId: string, checkpoint: { segments: { channel: number; index: number; text: string }[] }) => {
        checkpointSegments = checkpoint.segments;
        return { ok: true, value: undefined };
      },
    );
    getCallJobByIdMock.mockImplementation(async () => ({
      ok: true,
      value: makeJobRow({ transcript_partial: { segments: checkpointSegments } }),
    }));

    // 1セグメントの転写は TRANSCRIBE_SEGMENT_WORST_MS (60秒) 相当かかる、という最悪ケースを
    // フェイクタイマーの時刻前進で再現する (handleTranscribing の残余時間ガードは Date.now() を見る)。
    transcribeMock.mockImplementation(async (req: { filename: string }) => {
      vi.advanceTimersByTime(TRANSCRIBE_SEGMENT_WORST_MS);
      return { ok: true, value: { text: req.filename, costMicroUsd: 10 } };
    });

    commitCallJobStageMock.mockImplementation(async (_client: unknown, input: { nextStatus: string }) => ({
      ok: true,
      value: input.nextStatus,
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("1起床目: ソフト予算 (240秒) 内に収まる分だけ完了し、進捗commit (status維持) で終了する。全12セグメントの一部のみ完了する", async () => {
    const result = await STAGE_HANDLERS.transcribing({
      client: fakeClient,
      jobId: "job-1",
      row: {
        id: "job-1",
        status: "transcribing",
        lease_expires_at: new Date().toISOString(),
        stage_attempts: 1,
        call_id: "call-1",
        recording_id: "rec-1",
        transcript: null,
        analysis: null,
        result_kind: "acquired",
      },
    });

    // 1セグメント=TRANSCRIBE_SEGMENT_WORST_MS (60秒) の想定で、経過 + 60秒 >
    // TELEPHONY_WAKE_SOFT_BUDGET_MS (240秒、ソフト予算) になる前に着手できる件数を
    // 定数から導出する (0, 60000, 120000, 180000 の時点で着手 → 4件目終了時点で経過240000。
    // 5件目着手前の経過は240000 → 240000+60000=300000>240000 で打ち切り)。
    const segmentsPerWake = Math.floor(TELEPHONY_WAKE_SOFT_BUDGET_MS / TRANSCRIBE_SEGMENT_WORST_MS);
    expect(segmentsPerWake).toBeLessThan(TWELVE_SEGMENTS.length); // 前提: 1起床では終わらないこと
    expect(checkpointSegments.length).toBe(segmentsPerWake);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.status).toBe("transcribing"); // 進捗commit — まだ完了していない
  });

  it("複数起床にまたがって最終的に全12セグメントが完了し、analyzing へ commit される (チェックポイント再開の統合検証)", async () => {
    const rowArgs = {
      client: fakeClient,
      jobId: "job-1",
      row: {
        id: "job-1",
        status: "transcribing" as const,
        lease_expires_at: new Date().toISOString(),
        stage_attempts: 1,
        call_id: "call-1",
        recording_id: "rec-1",
        transcript: null,
        analysis: null,
        result_kind: "acquired" as const,
      },
    };

    let wakeCount = 0;
    let lastResult: Awaited<ReturnType<typeof STAGE_HANDLERS.transcribing>> | undefined;

    // 1起床では終わらないはずなので、analyzing へ前進するまで最大5回「起床」を繰り返す
    // (安全弁: 実装が壊れて無限ループになった場合にテスト自体が無限に回らないようにする)。
    while (wakeCount < 5) {
      wakeCount += 1;
      lastResult = await STAGE_HANDLERS.transcribing(rowArgs);
      if (lastResult.ok && lastResult.value.status === "analyzing") break;
    }

    expect(wakeCount).toBeGreaterThan(1); // 複数起床にまたがったことの証明 (1起床では終わらない)
    expect(wakeCount).toBeLessThanOrEqual(5);
    expect(lastResult).toEqual({ ok: true, value: { status: "analyzing" } });

    // 最終的に全セグメントがチェックポイントに反映されている。
    expect(checkpointSegments).toHaveLength(TWELVE_SEGMENTS.length);

    // analyzing への最終 commit に渡された transcript が channel昇順・index昇順であること。
    const finalCommitCall = commitCallJobStageMock.mock.calls.find(
      (call) => (call[1] as { nextStatus: string }).nextStatus === "analyzing",
    );
    expect(finalCommitCall).toBeDefined();
    const transcript = (finalCommitCall?.[1] as { transcript: { segments: { channel: number; index: number }[] } }).transcript;
    const orderedKeys = transcript.segments.map((s) => `${s.channel}:${s.index}`);
    const expectedKeys = [0, 1, 2, 3, 4, 5].map((i) => `0:${i}`).concat([0, 1, 2, 3, 4, 5].map((i) => `1:${i}`));
    expect(orderedKeys).toEqual(expectedKeys);
  });
});
