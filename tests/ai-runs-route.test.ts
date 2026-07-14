import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: GitHub Issue #20 / docs/module-contracts.md §5 DistributionFacade.getStyleProfiles
 * のコメント (「ai-studio の draft 生成は本メソッドの結果を app 層 (route handler) が取得して
 * AiStudioFacade に引数で渡す合成パターンで使う」)。
 *
 * POST /api/ai/runs (src/app/api/ai/runs/route.ts) が実際にその合成 (distribution →
 * ai-studio) を担う app 層であることを検証する (tests/shop-lead-route.test.ts / tests/
 * documents-generate-blocks-action.test.ts の確立パターンを踏襲。facade をすべてモックし
 * 実 DB には触れない)。
 */

const requireAdminMock = vi.fn();
vi.mock("@/modules/platform/facade", () => ({
  platformFacade: { requireAdmin: (...args: unknown[]) => requireAdminMock(...args) },
}));

const getStyleProfilesMock = vi.fn();
vi.mock("@/modules/distribution/facade", () => ({
  distributionFacade: { getStyleProfiles: (...args: unknown[]) => getStyleProfilesMock(...args) },
}));

const startRunMock = vi.fn();
vi.mock("@/modules/ai-studio/facade", () => ({
  aiStudioFacade: { startRun: (...args: unknown[]) => startRunMock(...args) },
}));

import { POST } from "@/app/api/ai/runs/route";

const STYLE_PROFILES = {
  site_blog: { tone_instructions: "a", format_rules: "b", example_output: null },
  note: { tone_instructions: "a", format_rules: "b", example_output: null },
  x: { tone_instructions: "a", format_rules: "b", example_output: null },
  instagram: { tone_instructions: "a", format_rules: "b", example_output: null },
};

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/ai/runs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  source_id: "11111111-1111-4111-8111-111111111111",
  channels: ["x"],
  research: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue({ ok: true, value: { userId: "admin-1" } });
  getStyleProfilesMock.mockResolvedValue({ ok: true, value: STYLE_PROFILES });
  startRunMock.mockResolvedValue({ ok: true, value: { run_id: "run-1" } });
});

describe("POST /api/ai/runs — distribution.getStyleProfiles → ai-studio.startRun の合成", () => {
  it("正常系: getStyleProfiles → startRun の順で1回ずつ呼ばれ、その結果が startRun の第4引数に渡る", async () => {
    const callOrder: string[] = [];
    getStyleProfilesMock.mockImplementationOnce(async () => {
      callOrder.push("distribution.getStyleProfiles");
      return { ok: true, value: STYLE_PROFILES };
    });
    startRunMock.mockImplementationOnce(async () => {
      callOrder.push("aiStudio.startRun");
      return { ok: true, value: { run_id: "run-1" } };
    });

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ run_id: "run-1" });
    expect(callOrder).toEqual(["distribution.getStyleProfiles", "aiStudio.startRun"]);
    expect(startRunMock).toHaveBeenCalledWith(
      VALID_BODY.source_id,
      VALID_BODY.channels,
      VALID_BODY.research,
      STYLE_PROFILES,
    );
  });

  it("admin でなければ 401/403 を返し、facade は一切呼ばれない", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, code: "KMB-E201" });

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(401);
    expect(getStyleProfilesMock).not.toHaveBeenCalled();
    expect(startRunMock).not.toHaveBeenCalled();
  });

  it("契約違反の body は 400 KMB-E101 を返し、facade は一切呼ばれない", async () => {
    const res = await POST(makeRequest({ source_id: "not-a-uuid", channels: [], research: false }));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "KMB-E101" });
    expect(getStyleProfilesMock).not.toHaveBeenCalled();
    expect(startRunMock).not.toHaveBeenCalled();
  });

  it("distribution.getStyleProfiles が失敗したら 400 でそのエラーを返し、startRun は呼ばれない", async () => {
    getStyleProfilesMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "db down" });

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "KMB-E901", detail: "db down" });
    expect(startRunMock).not.toHaveBeenCalled();
  });

  it("aiStudio.startRun が失敗したら 400 でそのエラーを返す", async () => {
    startRunMock.mockResolvedValue({ ok: false, code: "KMB-E101", detail: "整文確定が未実施です" });

    const res = await POST(makeRequest(VALID_BODY));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "KMB-E101", detail: "整文確定が未実施です" });
  });
});
