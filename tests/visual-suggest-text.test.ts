import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/ai-studio-v2.md §3 (文言候補) / §5 (スクショの graceful degradation)。
 *
 * suggestText / listTextModels (src/app/admin/visual/actions.ts) のロジックのみを検証する。
 * ai-providers・page-media・content・スクショ取得はすべてモックに差し替え、実 AI API・実
 * Chromium は一切叩かない (visual-actions.test.ts の vi.mock 方式に倣う)。
 * validateSlotText/normalizeLineEndings/resolveMaxLineLen は実物を使う (page-media/text-registry.ts
 * は module-boundary 上 internal/repository ではないため直接 import 可能。zSetTextReq 経路と同じ
 * precedent)。
 */

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

const requireAdmin = vi.fn();
vi.mock("@/modules/platform/facade", () => ({
  platformFacade: { requireAdmin: (...args: unknown[]) => requireAdmin(...args) },
}));

const { TEXT_SLOT, LINES_SLOT } = vi.hoisted(() => ({
  // kind=text (改行禁止・maxLen=10)
  TEXT_SLOT: {
    key: "test.heading",
    page: "home",
    route: "/",
    label: "テスト見出し",
    kind: "text" as const,
    maxLen: 10,
    defaultText: "既定の見出し",
  },
  // kind=lines (maxLen=20・maxLines=2・maxLineLen=8)
  LINES_SLOT: {
    key: "test.lines",
    page: "home",
    route: "/",
    label: "テスト複数行見出し",
    kind: "lines" as const,
    maxLen: 20,
    defaultText: "1行目\n2行目",
    maxLines: 2,
    maxLineLen: 8,
  },
}));

const buildSiteContextMd = vi.fn();
vi.mock("@/modules/page-media/facade", () => ({
  pageMediaFacade: {
    buildSiteContextMd: (...args: unknown[]) => buildSiteContextMd(...args),
    setSlot: vi.fn(),
    setSlotAlt: vi.fn(),
    listForAdmin: vi.fn(),
    setText: vi.fn(),
    listTextsForAdmin: vi.fn(),
  },
  SLOT_REGISTRY: [],
  TEXT_REGISTRY: [TEXT_SLOT, LINES_SLOT],
  EDITABLE_ROUTES: ["/"],
}));

vi.mock("@/modules/content/facade", () => ({
  contentFacade: {
    setWorkCover: vi.fn(),
    setVoicePhoto: vi.fn(),
    setPostCover: vi.fn(),
    setWorkImage: vi.fn(),
    getWorkAdmin: vi.fn(),
    getPostAdmin: vi.fn(),
    listWorksAdmin: vi.fn(),
    listVoicesAdmin: vi.fn(),
    listPostsAdmin: vi.fn(),
    listPublished: vi.fn(),
  },
}));

const generateText = vi.fn();
const listAvailableModels = vi.fn();
vi.mock("@/modules/ai-providers/facade", () => ({
  aiProvidersFacade: {
    generateText: (...args: unknown[]) => generateText(...args),
    listAvailableModels: (...args: unknown[]) => listAvailableModels(...args),
  },
}));

const captureRouteScreenshot = vi.fn();
vi.mock("@/lib/screenshot/capture", () => ({
  captureRouteScreenshot: (...args: unknown[]) => captureRouteScreenshot(...args),
}));

import { listTextModels, suggestText } from "@/app/admin/visual/actions";

function textResult(candidates: unknown, stopReason: string | null = "end_turn") {
  return {
    ok: true as const,
    value: {
      text: JSON.stringify({ candidates }),
      provider: "anthropic" as const,
      model: "claude-opus-4-8",
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        webSearchRequests: 0,
      },
      costMicroUsd: 1_000,
      stopReason,
    },
  };
}

const VALID_CONTEXT = { ok: true as const, value: { contextJson: "{}", targetRoute: "/" } };

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, value: { userId: "admin-1" } });
  buildSiteContextMd.mockResolvedValue(VALID_CONTEXT);
});

describe("suggestText: 入力検証・requireAdmin", () => {
  it("instruction が 500 字を超えると KMB-E101 を返し、以降の処理を行わない", async () => {
    const result = await suggestText({
      slotKey: "test.heading",
      instruction: "あ".repeat(501),
      useScreenshot: false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E101");
    expect(requireAdmin).not.toHaveBeenCalled();
  });

  it("requireAdmin 失敗時は buildSiteContextMd / generateText を呼ばない", async () => {
    requireAdmin.mockResolvedValue({ ok: false, code: "KMB-E201" });
    const result = await suggestText({ slotKey: "test.heading", instruction: "", useScreenshot: false });
    expect(result).toEqual({ ok: false, code: "KMB-E201" });
    expect(buildSiteContextMd).not.toHaveBeenCalled();
    expect(generateText).not.toHaveBeenCalled();
  });

  it("TEXT_REGISTRY に存在しない slot_key は KMB-E107 を返す", async () => {
    const result = await suggestText({ slotKey: "nonexistent.slot", instruction: "", useScreenshot: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E107");
    expect(buildSiteContextMd).not.toHaveBeenCalled();
  });

  it("buildSiteContextMd が失敗したらそのまま返し、generateText を呼ばない", async () => {
    buildSiteContextMd.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "db down" });
    const result = await suggestText({ slotKey: "test.heading", instruction: "", useScreenshot: false });
    expect(result).toEqual({ ok: false, code: "KMB-E901", detail: "db down" });
    expect(generateText).not.toHaveBeenCalled();
  });
});

describe("suggestText: 候補フィルタ (§3 maxLen/maxLines 超過候補を除外)", () => {
  it("kind=text: maxLen (10) を超える候補は除外し、収まる候補のみ返す", async () => {
    const candidates = [
      "短い候補", // 4字 OK
      "これはとても長い見出しの候補文です", // 超過 → 除外
      "適正な候補文", // 6字 OK
      "0123456789A", // 11字 → 超過 → 除外
      "OK候補", // OK
    ];
    generateText.mockResolvedValue(textResult(candidates));

    const result = await suggestText({ slotKey: "test.heading", instruction: "", useScreenshot: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candidates).toEqual(["短い候補", "適正な候補文", "OK候補"]);
  });

  it("kind=text: 改行を含む候補は除外する", async () => {
    const candidates = ["OK候補1", "改行\nあり候補", "OK候補2", "OK候補3", "OK候補4"];
    generateText.mockResolvedValue(textResult(candidates));

    const result = await suggestText({ slotKey: "test.heading", instruction: "", useScreenshot: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candidates).not.toContain("改行\nあり候補");
    expect(result.value.candidates).toEqual(["OK候補1", "OK候補2", "OK候補3", "OK候補4"]);
  });

  it("kind=lines: maxLines (2) 超過・1行あたりの文字数 (8) 超過の候補を除外する", async () => {
    const candidates = [
      "1行目\n2行目", // OK (2行、各行8字以下)
      "1行目\n2行目\n3行目", // 3行 → maxLines 超過 → 除外
      "これはとても長い1行目の文字列\n2行目", // 1行目が8字超過 → 除外
      "短い1\n短い2", // OK
      "行A\n行B", // OK
    ];
    generateText.mockResolvedValue(textResult(candidates));

    const result = await suggestText({ slotKey: "test.lines", instruction: "", useScreenshot: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candidates).toEqual(["1行目\n2行目", "短い1\n短い2", "行A\n行B"]);
  });

  it("全候補が制約超過の場合は空配列を返す (エラーにはしない)", async () => {
    const candidates = Array.from({ length: 5 }, () => "これはとても長すぎる見出し候補の文字列です");
    generateText.mockResolvedValue(textResult(candidates));

    const result = await suggestText({ slotKey: "test.heading", instruction: "", useScreenshot: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.candidates).toEqual([]);
  });
});

describe("suggestText: スクショ (§5 graceful degradation)", () => {
  const VALID_CANDIDATES = ["候補1", "候補2", "候補3", "候補4", "候補5"];

  it("useScreenshot=false のときは captureRouteScreenshot を呼ばない", async () => {
    generateText.mockResolvedValue(textResult(VALID_CANDIDATES));
    const result = await suggestText({ slotKey: "test.heading", instruction: "", useScreenshot: false });
    expect(result.ok).toBe(true);
    expect(captureRouteScreenshot).not.toHaveBeenCalled();
    if (result.ok) expect(result.value.screenshotUsed).toBe(false);
  });

  it("useScreenshot=true でスクショ取得成功時は images を添付し screenshotUsed=true を返す", async () => {
    captureRouteScreenshot.mockResolvedValue({
      ok: true,
      value: { dataBase64: "d2VicA==", mimeType: "image/webp", storagePath: "root.webp" },
    });
    generateText.mockResolvedValue(textResult(VALID_CANDIDATES));

    const result = await suggestText({ slotKey: "test.heading", instruction: "", useScreenshot: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.screenshotUsed).toBe(true);
    expect(captureRouteScreenshot).toHaveBeenCalledWith("/");
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({ images: [{ mimeType: "image/webp", dataBase64: "d2VicA==" }] }),
    );
  });

  it("useScreenshot=true でスクショ取得に失敗した場合も MD のみで続行し、失敗扱いにしない", async () => {
    captureRouteScreenshot.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "chromium起動失敗" });
    generateText.mockResolvedValue(textResult(VALID_CANDIDATES));

    const result = await suggestText({ slotKey: "test.heading", instruction: "", useScreenshot: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.screenshotUsed).toBe(false);
    expect(result.value.candidates).toEqual(VALID_CANDIDATES);
    expect(generateText).toHaveBeenCalledWith(expect.objectContaining({ images: undefined }));
  });
});

describe("suggestText: AI 呼び出し結果の判定", () => {
  const VALID_CANDIDATES = ["候補1", "候補2", "候補3", "候補4", "候補5"];

  it("generateText が失敗したらそのまま返す (KMB-E408 等)", async () => {
    generateText.mockResolvedValue({ ok: false, code: "KMB-E408", detail: "全キー失敗" });
    const result = await suggestText({ slotKey: "test.heading", instruction: "", useScreenshot: false });
    expect(result).toEqual({ ok: false, code: "KMB-E408", detail: "全キー失敗" });
  });

  it("stopReason==='refusal' は KMB-E403 を返す", async () => {
    generateText.mockResolvedValue(textResult(VALID_CANDIDATES, "refusal"));
    const result = await suggestText({ slotKey: "test.heading", instruction: "", useScreenshot: false });
    expect(result).toEqual({ ok: false, code: "KMB-E403" });
  });

  it("AI 出力が JSON として解析できない場合は KMB-E404 を返す", async () => {
    generateText.mockResolvedValue({
      ok: true,
      value: {
        text: "これはJSONではありません",
        provider: "anthropic",
        model: "claude-opus-4-8",
        usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheWriteInputTokens: 0, webSearchRequests: 0 },
        costMicroUsd: 1,
        stopReason: "end_turn",
      },
    });
    const result = await suggestText({ slotKey: "test.heading", instruction: "", useScreenshot: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E404");
  });

  it("candidates が 5 件ちょうどでない場合は KMB-E404 を返す (スキーマ不一致)", async () => {
    generateText.mockResolvedValue(textResult(["候補1", "候補2", "候補3"]));
    const result = await suggestText({ slotKey: "test.heading", instruction: "", useScreenshot: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E404");
  });

  it("指示が空のときはユーザー指示に既定文言を使う", async () => {
    generateText.mockResolvedValue(textResult(VALID_CANDIDATES));
    await suggestText({ slotKey: "test.heading", instruction: "", useScreenshot: false });
    const call = generateText.mock.calls[0][0] as { messages: { content: string }[] };
    expect(call.messages[0].content).toContain("この場所に合う言い換え候補");
  });

  it("model 未指定のときは generateText に model を渡さない (ルータの既定モデルに委ねる)", async () => {
    generateText.mockResolvedValue(textResult(VALID_CANDIDATES));
    await suggestText({ slotKey: "test.heading", instruction: "", useScreenshot: false });
    const call = generateText.mock.calls[0][0] as { model?: string };
    expect(call.model).toBeUndefined();
  });

  it("model 指定時はそのまま generateText に渡す", async () => {
    generateText.mockResolvedValue(textResult(VALID_CANDIDATES));
    await suggestText({
      slotKey: "test.heading",
      instruction: "",
      model: "claude-sonnet-5",
      useScreenshot: false,
    });
    const call = generateText.mock.calls[0][0] as { model?: string };
    expect(call.model).toBe("claude-sonnet-5");
  });
});

describe("listTextModels", () => {
  it("requireAdmin 失敗時は listAvailableModels を呼ばない", async () => {
    requireAdmin.mockResolvedValue({ ok: false, code: "KMB-E201" });
    const result = await listTextModels();
    expect(result).toEqual({ ok: false, code: "KMB-E201" });
    expect(listAvailableModels).not.toHaveBeenCalled();
  });

  it("成功時は listAvailableModels('text') の結果をそのまま返す", async () => {
    const models = [{ id: "claude-opus-4-8", kind: "text", display: "Claude Opus 4.8" }];
    listAvailableModels.mockResolvedValue({ ok: true, value: models });
    const result = await listTextModels();
    expect(listAvailableModels).toHaveBeenCalledWith("text");
    expect(result).toEqual({ ok: true, value: models });
  });
});
