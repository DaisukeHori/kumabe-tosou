import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Result } from "@/modules/platform/contracts";
import type { CallJobStatus } from "@/modules/telephony/contracts";
import {
  CALL_JOB_HEARTBEAT_INTERVAL_MS,
  TELEPHONY_WAKE_SOFT_BUDGET_MS,
  TELEPHONY_WORKER_MAX_JOBS_PER_WAKE,
  TRANSCRIBE_SEGMENT_WORST_MS,
} from "@/modules/telephony/internal/lease";

/**
 * internal/worker.ts の advanceCallJob (lease/commit 制御フロー) + runTelephonyJobBatch
 * (due job 選定・直列処理・残余予算ガード) の単体テスト
 * (canonical: docs/design/crm-suite/04-telephony.md §6.5 共通則 / §7.1 D8 / §7.3)。
 * repository.ts (RPC ラッパー) と @/lib/supabase/service を vi.mock し、実 DB には触れない
 * (#57 のスコープは lease/commit/retry の制御フローのみ — 4 ステージの実処理は #58 が
 * STAGE_HANDLERS の中身を差し替える。本ファイルは「#57 単独でも未実装スタブのまま
 * commit を呼ばず安全に動く」ことを検証する)。
 */

const acquireCallJobLeaseMock = vi.fn();
const heartbeatCallJobLeaseMock = vi.fn();
const listDueCallJobsMock = vi.fn();
const commitCallJobStageMock = vi.fn();

vi.mock("@/modules/telephony/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/telephony/repository")>();
  return {
    ...actual,
    acquireCallJobLease: (...args: unknown[]) => acquireCallJobLeaseMock(...args),
    heartbeatCallJobLease: (...args: unknown[]) => heartbeatCallJobLeaseMock(...args),
    listDueCallJobs: (...args: unknown[]) => listDueCallJobsMock(...args),
    commitCallJobStage: (...args: unknown[]) => commitCallJobStageMock(...args),
  };
});

const createSupabaseServiceClientMock = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: (...args: unknown[]) => createSupabaseServiceClientMock(...args),
}));

import { STAGE_HANDLERS, advanceCallJob, runTelephonyJobBatch } from "@/modules/telephony/internal/worker";

const fakeClient = {} as SupabaseClient;

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

beforeEach(() => {
  vi.clearAllMocks();
  createSupabaseServiceClientMock.mockReturnValue(fakeClient);
});

afterEach(() => {
  vi.useRealTimers();
});

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

describe("advanceCallJob: acquired → ステージ dispatch (#57 の未実装スタブは commit を一切呼ばない)", () => {
  it("STAGE_HANDLERS のキーは downloading/transcribing/analyzing/linking の 4 つちょうど (#58 が差し替える対象)", () => {
    expect(Object.keys(STAGE_HANDLERS).sort()).toEqual(["analyzing", "downloading", "linking", "transcribing"]);
  });

  it.each(["downloading", "transcribing", "analyzing", "linking"] as const)(
    "acquired (%s): 対応するステージスタブが即 return し、現在の status をそのまま ok:true で返す。commitCallJobStage は呼ばれない",
    async (stage) => {
      acquireCallJobLeaseMock.mockResolvedValue({
        ok: true,
        value: makeRow({ status: stage, result_kind: "acquired" }),
      });

      const result = await advanceCallJob(fakeClient, "job-1");

      expect(result).toEqual({ ok: true, value: { status: stage } });
      expect(commitCallJobStageMock).not.toHaveBeenCalled();
    },
  );
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
