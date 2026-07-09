import { describe, expect, it } from "vitest";

import {
  zGenerateImageReq,
  zGenerateTextReq,
  zSaveKeyInput,
  zTranscribeReq,
} from "@/modules/ai-providers/contracts";

/**
 * ai-providers/contracts.ts の Zod 検証テスト (設計書 §13)。
 */
describe("zSaveKeyInput", () => {
  it("有効な入力を受け付ける", () => {
    const result = zSaveKeyInput.safeParse({
      provider: "openai",
      label: "本番キー",
      apiKey: "sk-1234567890",
      priority: 100,
    });
    expect(result.success).toBe(true);
  });

  it("priority 省略時は既定値 100 を補完する", () => {
    const result = zSaveKeyInput.safeParse({
      provider: "anthropic",
      label: "検証キー",
      apiKey: "sk-ant-1234567890",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.priority).toBe(100);
  });

  it("provider が不正な値だと拒否する", () => {
    const result = zSaveKeyInput.safeParse({
      provider: "azure",
      label: "不正プロバイダ",
      apiKey: "sk-1234567890",
    });
    expect(result.success).toBe(false);
  });

  it("apiKey が短すぎると拒否する (min 8)", () => {
    const result = zSaveKeyInput.safeParse({ provider: "gemini", label: "短すぎキー", apiKey: "123" });
    expect(result.success).toBe(false);
  });

  it("priority の範囲外 (0 や 10000) は拒否する", () => {
    expect(
      zSaveKeyInput.safeParse({ provider: "gemini", label: "x", apiKey: "12345678", priority: 0 }).success,
    ).toBe(false);
    expect(
      zSaveKeyInput.safeParse({ provider: "gemini", label: "x", apiKey: "12345678", priority: 10_000 }).success,
    ).toBe(false);
  });

  it("未知のキー (契約外拡張) は .strict() で拒否する", () => {
    const result = zSaveKeyInput.safeParse({
      provider: "openai",
      label: "x",
      apiKey: "12345678",
      priority: 100,
      unknownField: "value",
    });
    expect(result.success).toBe(false);
  });
});

describe("zGenerateTextReq", () => {
  it("最小構成 (messages のみ) を受け付ける", () => {
    const result = zGenerateTextReq.safeParse({
      feature: "studio",
      messages: [{ role: "user", content: "こんにちは" }],
    });
    expect(result.success).toBe(true);
  });

  it("messages が空配列だと拒否する (min 1)", () => {
    const result = zGenerateTextReq.safeParse({ feature: "studio", messages: [] });
    expect(result.success).toBe(false);
  });

  it("responseSchema / webSearch / refTable/refId を含む完全な入力を受け付ける", () => {
    const result = zGenerateTextReq.safeParse({
      model: "claude-opus-4-8",
      feature: "studio",
      system: "system prompt",
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 1000,
      temperature: 0.5,
      responseSchema: { name: "brief", schema: { type: "object", properties: {} } },
      webSearch: { maxUses: 8 },
      refTable: "ai_runs",
      refId: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.success).toBe(true);
  });

  it("feature が空文字だと拒否する", () => {
    const result = zGenerateTextReq.safeParse({
      feature: "",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.success).toBe(false);
  });
});

describe("zGenerateImageReq", () => {
  it("model は必須 (画像既定モデルは ops 設定側が解決する設計、判断点)", () => {
    const withoutModel = zGenerateImageReq.safeParse({ feature: "image-gen", prompt: "a cat" });
    expect(withoutModel.success).toBe(false);

    const withModel = zGenerateImageReq.safeParse({
      model: "gpt-image-2",
      feature: "image-gen",
      prompt: "a cat",
    });
    expect(withModel.success).toBe(true);
  });

  it("n は 1〜4 の範囲 (省略時は既定 1)", () => {
    const base = { model: "gpt-image-2", feature: "image-gen", prompt: "a cat" };
    expect(zGenerateImageReq.safeParse(base).success).toBe(true);
    expect(zGenerateImageReq.safeParse({ ...base, n: 1 }).success).toBe(true);
    expect(zGenerateImageReq.safeParse({ ...base, n: 4 }).success).toBe(true);
    expect(zGenerateImageReq.safeParse({ ...base, n: 5 }).success).toBe(false);
    expect(zGenerateImageReq.safeParse({ ...base, n: 0 }).success).toBe(false);

    const parsed = zGenerateImageReq.parse(base);
    expect(parsed.n).toBe(1);
  });

  it("sourceImages は最大 4 枚", () => {
    const img = { mimeType: "image/png", dataBase64: "AAAA" };
    const base = { model: "gpt-image-2", feature: "image-gen", prompt: "a cat" };
    expect(zGenerateImageReq.safeParse({ ...base, sourceImages: [img, img, img, img] }).success).toBe(true);
    expect(zGenerateImageReq.safeParse({ ...base, sourceImages: [img, img, img, img, img] }).success).toBe(false);
  });
});

describe("zTranscribeReq", () => {
  it("audioBase64 は必須", () => {
    const result = zTranscribeReq.safeParse({ feature: "transcribe", filename: "a.webm", audioBase64: "" });
    expect(result.success).toBe(false);
  });

  it("最小構成を受け付け、model 省略可 (router が既定モデルを使う)", () => {
    const result = zTranscribeReq.safeParse({
      feature: "transcribe",
      filename: "a.webm",
      audioBase64: "AAAA",
    });
    expect(result.success).toBe(true);
  });
});
