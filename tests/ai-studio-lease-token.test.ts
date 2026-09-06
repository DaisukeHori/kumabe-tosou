import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/cms-ai-pipeline.md §7.6 (lease 意味論)、migration 20260906000042。
 * 2026-09-06 監査修正 #8 (held 判定を exhausted より先に / lease_token) と #10 (成功 commit で error_code を
 * p_error_code に上書き)。
 *
 * この repo の vitest は DB を持たないため (tests/ai-studio-stage-machine.test.ts と同型の方針)、
 * (1) facade が acquire で受け取った lease_token を heartbeat / commit / 解放に渡す配線と、
 * (2) migration SQL の意味論 (判定順・条件・SET 句) を静的に検証する。
 */

const acquireLeaseMock = vi.fn();
const heartbeatLeaseMock = vi.fn();
const commitStageMock = vi.fn();
const releaseLeaseAfterFailureMock = vi.fn();
const getSourceMock = vi.fn();

vi.mock("@/modules/ai-studio/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/ai-studio/repository")>();
  return {
    ...actual,
    acquireLease: (...args: unknown[]) => acquireLeaseMock(...args),
    heartbeatLease: (...args: unknown[]) => heartbeatLeaseMock(...args),
    commitStage: (...args: unknown[]) => commitStageMock(...args),
    releaseLeaseAfterFailure: (...args: unknown[]) => releaseLeaseAfterFailureMock(...args),
    getSource: (...args: unknown[]) => getSourceMock(...args),
  };
});

const extractBriefMock = vi.fn();
vi.mock("@/modules/ai-studio/internal/claude", () => ({
  extractBrief: (...args: unknown[]) => extractBriefMock(...args),
  researchBrief: vi.fn(),
  draftChannel: vi.fn(),
  cleanTranscript: vi.fn(),
  buildSnsImagePrompt: vi.fn(),
}));
vi.mock("@/modules/ai-studio/internal/transcribe", () => ({ transcribeAudio: vi.fn() }));

const SUPABASE = { __kind: "fake-session-client" };
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => SUPABASE }));
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => ({}) }));
vi.mock("@/lib/supabase/session", () => ({ getSessionAndClient: async () => ({ supabase: SUPABASE, user: { id: "u" } }) }));
vi.mock("@/modules/ai-providers/facade", () => ({ aiProvidersFacade: { generateImages: vi.fn() } }));
vi.mock("@/modules/media/facade", () => ({ mediaFacade: { createFromBytes: vi.fn(), getPublicUrl: vi.fn() } }));
vi.mock("@/modules/settings/facade", () => ({ settingsFacade: { get: vi.fn() } }));

import { aiStudioFacade } from "@/modules/ai-studio/facade";

const RUN_ID = "11111111-1111-1111-1111-111111111111";
const TOKEN = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function acquiredExtracting(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    status: "extracting",
    lease_expires_at: new Date(Date.now() + 90_000).toISOString(),
    stage_attempts: 1,
    research_enabled: false,
    target_channels: ["site_blog"],
    source_id: "source-1",
    brief: null,
    research_notes: null,
    style_profiles: null,
    lease_token: TOKEN,
    result_kind: "acquired",
    ...overrides,
  };
}

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, web_search_requests: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  heartbeatLeaseMock.mockResolvedValue(undefined);
  releaseLeaseAfterFailureMock.mockResolvedValue(undefined);
  commitStageMock.mockResolvedValue("drafting");
  getSourceMock.mockResolvedValue({ id: "source-1", cleaned_text: "整文済み本文" });
});

describe("advanceRunDetailed: acquire で発行された lease_token を commit / 解放に渡す (#8)", () => {
  it("成功 commit は leaseToken 付きで ai_run_commit_stage を呼ぶ", async () => {
    acquireLeaseMock.mockResolvedValue(acquiredExtracting());
    extractBriefMock.mockResolvedValue({ ok: true, value: { data: { theme: "t" }, usage: USAGE } });

    const outcome = await aiStudioFacade.advanceRunDetailed(RUN_ID);

    expect(outcome).toEqual({ kind: "advanced", status: "drafting" });
    expect(commitStageMock).toHaveBeenCalledTimes(1);
    expect(commitStageMock.mock.calls[0][1]).toMatchObject({
      runId: RUN_ID,
      expectedStatus: "extracting",
      leaseToken: TOKEN,
    });
    expect(releaseLeaseAfterFailureMock).not.toHaveBeenCalled();
  });

  it("stage 失敗時の解放 (releaseLeaseAfterFailure) にも leaseToken を渡す", async () => {
    acquireLeaseMock.mockResolvedValue(acquiredExtracting());
    extractBriefMock.mockResolvedValue({ ok: false, code: "KMB-E401", detail: "claude error" });

    const outcome = await aiStudioFacade.advanceRunDetailed(RUN_ID);

    expect(outcome).toEqual({ kind: "error", code: "KMB-E401", detail: "claude error" });
    expect(releaseLeaseAfterFailureMock).toHaveBeenCalledWith(SUPABASE, RUN_ID, "KMB-E401", TOKEN);
    expect(commitStageMock).not.toHaveBeenCalled();
  });

  it("heartbeat は leaseToken 付きで呼ばれる (別プロセスの lease を延長しない)", async () => {
    vi.useFakeTimers();
    try {
      acquireLeaseMock.mockResolvedValue(acquiredExtracting());
      let resolveBrief: (v: unknown) => void = () => undefined;
      extractBriefMock.mockReturnValue(new Promise((resolve) => (resolveBrief = resolve)));

      const pending = aiStudioFacade.advanceRunDetailed(RUN_ID);
      await vi.advanceTimersByTimeAsync(20_000 * 2 + 10);
      resolveBrief({ ok: true, value: { data: { theme: "t" }, usage: USAGE } });
      await pending;

      expect(heartbeatLeaseMock).toHaveBeenCalledTimes(2);
      expect(heartbeatLeaseMock).toHaveBeenCalledWith(SUPABASE, RUN_ID, TOKEN);
    } finally {
      vi.useRealTimers();
    }
  });

  it("acquired なのに lease_token が無い (migration 未適用) 場合は stage を実行せず KMB-E901", async () => {
    acquireLeaseMock.mockResolvedValue(acquiredExtracting({ lease_token: null }));

    const outcome = await aiStudioFacade.advanceRunDetailed(RUN_ID);

    expect(outcome).toMatchObject({ kind: "error", code: "KMB-E901" });
    expect(extractBriefMock).not.toHaveBeenCalled();
    expect(commitStageMock).not.toHaveBeenCalled();
  });

  it("held (result_kind='held') は lease_token 無しで 409 相当を返す (非退行)", async () => {
    acquireLeaseMock.mockResolvedValue(acquiredExtracting({ lease_token: null, result_kind: "held" }));
    expect(await aiStudioFacade.advanceRunDetailed(RUN_ID)).toEqual({ kind: "held" });
  });
});

describe("migration 20260906000042 の SQL 意味論 (静的検証)", () => {
  const sql = readFileSync(
    path.resolve(__dirname, "../supabase/migrations/20260906000042_ai_run_lease_token.sql"),
    "utf-8",
  );

  function fnBody(name: string): string {
    const start = sql.indexOf(`create or replace function public.${name}(`);
    expect(start).toBeGreaterThan(-1);
    const end = sql.indexOf("$$;", start);
    return sql.slice(start, end);
  }

  it("ai_run_acquire_lease: held 判定 (lease_expires_at >= now()) が exhausted 判定 (stage_attempts >= 3) より先にある (#8)", () => {
    const body = fnBody("ai_run_acquire_lease");
    const heldIdx = body.indexOf("v_row.lease_expires_at >= now()");
    const exhaustedIdx = body.indexOf("v_row.stage_attempts >= 3");
    expect(heldIdx).toBeGreaterThan(-1);
    expect(exhaustedIdx).toBeGreaterThan(-1);
    expect(heldIdx).toBeLessThan(exhaustedIdx);
  });

  it("ai_run_acquire_lease: acquire で lease_token を発行して返し、held/exhausted/terminal/not_found では null", () => {
    const body = fnBody("ai_run_acquire_lease");
    expect(body).toContain("v_token := gen_random_uuid();");
    expect(body).toContain("lease_token = v_token,");
    expect(body).toContain("'acquired'::text, v_row.style_profiles, v_row.lease_token;");
    expect(body).toMatch(/'held'::text, v_row\.style_profiles, null::uuid;/);
    expect(body).toMatch(/'exhausted'::text, v_row\.style_profiles, null::uuid;/);
    expect(body).toMatch(/'terminal'::text, v_row\.style_profiles, null::uuid;/);
    expect(body).toMatch(/'not_found'::text, null::jsonb, null::uuid;/);
    expect(sql).toContain("add column if not exists lease_token uuid");
  });

  it.each(["ai_run_commit_stage", "ai_run_commit_image_stage"])(
    "%s: p_lease_token 一致を CAS 条件に含め、成功時は error_code = p_error_code (coalesce 廃止、#10) と lease_token 解放",
    (name) => {
      const body = fnBody(name);
      expect(body).toContain("p_lease_token uuid default null");
      expect(body).toContain("and (p_lease_token is null or lease_token = p_lease_token)");
      expect(body).toContain("error_code = p_error_code,");
      expect(body).not.toContain("coalesce(p_error_code, error_code)");
      expect(body).toContain("lease_token = null,");
      expect(body).toContain("lease_expires_at = null,");
    },
  );
});
