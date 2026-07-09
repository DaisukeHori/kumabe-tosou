import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * canonical: docs/design/ai-studio-v2.md §1 (ルータの全体フロー: キー選択 → 予算予約 →
 * プロバイダ呼び出し → usage 記録 → 予算確定 → キー状態遷移)。
 *
 * ai-providers-router.test.ts は resolveCandidates / classifyKeyOutcome 等の純粋な部品を
 * 単体で検証するが、routeGenerateText/routeGenerateImages/routeTranscribe という
 * 「ルータ本体の一連の流れ」自体は直接テストされていなかった (独立検証 P1 タスク項目 3/4/5/10 の
 * ギャップ)。本ファイルは repository 層・各プロバイダ呼び出し・Supabase クライアント生成を
 * すべてモックし、ルータ本体が
 *  - 予算超過時に即 KMB-E407 を返し、プロバイダを一切呼ばないこと
 *  - 全候補キー失敗時に KMB-E408 を返し、失敗ごとに usage を記録し、最後に予約を解放すること
 *    (budgetSettle(actual=0) が呼ばれる = 正常系での「解放」経路)
 *  - 成功時に確定コストで usage 記録・予算確定・キー状態更新を行うこと
 *  - 画像生成で実際に返った枚数 (要求 n 以下) で予算確定・usage 記録すること
 * を検証する。
 */

const listKeyRowsMock = vi.fn();
const vaultReadSecretMock = vi.fn();
const budgetReserveMock = vi.fn();
const budgetSettleMock = vi.fn();
const insertUsageLogMock = vi.fn();
const markKeyOutcomeRowMock = vi.fn();

vi.mock("@/modules/ai-providers/repository", async () => {
  const actual = await vi.importActual<typeof import("@/modules/ai-providers/repository")>(
    "@/modules/ai-providers/repository",
  );
  return {
    ...actual,
    listKeyRows: (...args: unknown[]) => listKeyRowsMock(...args),
    vaultReadSecret: (...args: unknown[]) => vaultReadSecretMock(...args),
    budgetReserve: (...args: unknown[]) => budgetReserveMock(...args),
    budgetSettle: (...args: unknown[]) => budgetSettleMock(...args),
    insertUsageLog: (...args: unknown[]) => insertUsageLogMock(...args),
    markKeyOutcomeRow: (...args: unknown[]) => markKeyOutcomeRowMock(...args),
  };
});

const callAnthropicTextMock = vi.fn();
vi.mock("@/modules/ai-providers/internal/anthropic", () => ({
  callAnthropicText: (...args: unknown[]) => callAnthropicTextMock(...args),
  listAnthropicModels: vi.fn(),
}));

const callOpenAiTextMock = vi.fn();
const callOpenAiImageMock = vi.fn();
const callOpenAiTranscribeMock = vi.fn();
vi.mock("@/modules/ai-providers/internal/openai", () => ({
  callOpenAiText: (...args: unknown[]) => callOpenAiTextMock(...args),
  callOpenAiImage: (...args: unknown[]) => callOpenAiImageMock(...args),
  callOpenAiTranscribe: (...args: unknown[]) => callOpenAiTranscribeMock(...args),
  listOpenAiModels: vi.fn(),
  isOpenAiImageModel: () => false,
}));

const callGeminiTextMock = vi.fn();
const callGeminiImageMock = vi.fn();
vi.mock("@/modules/ai-providers/internal/gemini", () => ({
  callGeminiText: (...args: unknown[]) => callGeminiTextMock(...args),
  callGeminiImage: (...args: unknown[]) => callGeminiImageMock(...args),
  listGeminiModels: vi.fn(),
  isGeminiImageModelName: () => false,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({}) as unknown as SupabaseClient,
}));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({}) as unknown as SupabaseClient,
}));

import { routeGenerateImages, routeGenerateText, routeTranscribe } from "@/modules/ai-providers/internal/router";
import type { AiProviderKeyRow } from "@/modules/ai-providers/repository";
import { computeImageCostMicroUsd, computeTextCostMicroUsd } from "@/modules/ai-providers/internal/pricing";

function makeRow(overrides: Partial<AiProviderKeyRow>): AiProviderKeyRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    provider: "openai",
    label: "テストキー",
    vault_secret_name: "ai-provider-key-openai-test",
    key_last4: "abcd",
    priority: 100,
    status: "untested",
    cooldown_until: null,
    last_error: null,
    last_tested_at: null,
    detected_models: [],
    enabled_models: [],
    default_model: null,
    created_at: "2026-07-10T00:00:00.000Z",
    updated_at: "2026-07-10T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vaultReadSecretMock.mockResolvedValue({ ok: true, value: "sk-test-secret" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("routeGenerateText: 予算超過 (KMB-E407)", () => {
  it("budgetReserve が ok:false を返した場合、プロバイダを一切呼ばずに KMB-E407 を返す", async () => {
    listKeyRowsMock.mockResolvedValue({ ok: true, value: [makeRow({ status: "ok" })] });
    budgetReserveMock.mockResolvedValue({
      ok: true,
      value: { reservationId: "r-1", ok: false, errorCode: "KMB-E407" },
    });

    const result = await routeGenerateText({
      model: "gpt-5.4",
      feature: "test",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result).toEqual({ ok: false, code: "KMB-E407", detail: "KMB-E407" });
    expect(callOpenAiTextMock).not.toHaveBeenCalled();
    expect(insertUsageLogMock).not.toHaveBeenCalled();
    expect(budgetSettleMock).not.toHaveBeenCalled();
  });
});

describe("routeGenerateText: 全候補キー失敗 (KMB-E408)", () => {
  it("唯一の候補キーが auth エラーで失敗する場合、usage を記録し、予約を解放し、KMB-E408 を返す", async () => {
    listKeyRowsMock.mockResolvedValue({ ok: true, value: [makeRow({ id: "key-1", status: "untested" })] });
    budgetReserveMock.mockResolvedValue({ ok: true, value: { reservationId: "r-2", ok: true, errorCode: null } });
    callOpenAiTextMock.mockResolvedValue({ ok: false, error: { kind: "auth", message: "invalid api key" } });

    const result = await routeGenerateText({
      model: "gpt-5.4",
      feature: "test",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("KMB-E408");

    // usage は失敗も記録する契約 (repository.ts の insertUsageLog コメント参照)
    expect(insertUsageLogMock).toHaveBeenCalledTimes(1);
    expect(insertUsageLogMock.mock.calls[0][1]).toMatchObject({
      status: "error",
      errorCode: "auth",
      costMicroUsd: 0,
      keyId: "key-1",
    });

    // キー状態は 'failed' に遷移する (auth → failed)
    expect(markKeyOutcomeRowMock).toHaveBeenCalledTimes(1);
    expect(markKeyOutcomeRowMock.mock.calls[0][2]).toMatchObject({ status: "failed", cooldownUntil: null });

    // 全滅後、予約は actual=0 で解放される (「失敗時は解放」の実装経路)
    expect(budgetSettleMock).toHaveBeenCalledTimes(1);
    expect(budgetSettleMock.mock.calls[0][1]).toMatchObject({ actualMicroUsd: 0, actualImageCount: 0 });
  });
});

describe("routeGenerateText: 成功", () => {
  it("確定コストで usage 記録・予算確定・キー状態更新 ('untested'→'ok') を行う", async () => {
    listKeyRowsMock.mockResolvedValue({ ok: true, value: [makeRow({ id: "key-ok", status: "untested" })] });
    budgetReserveMock.mockResolvedValue({ ok: true, value: { reservationId: "r-3", ok: true, errorCode: null } });
    const usage = {
      inputTokens: 1000,
      outputTokens: 500,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      webSearchRequests: 0,
    };
    callOpenAiTextMock.mockResolvedValue({ ok: true, value: { text: "こんにちは", usage, stopReason: "stop" } });

    const result = await routeGenerateText({
      model: "gpt-5.4",
      feature: "test",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expectedCost = computeTextCostMicroUsd("openai", "gpt-5.4", usage);
    expect(result.value.costMicroUsd).toBe(expectedCost);
    expect(result.value.text).toBe("こんにちは");

    expect(insertUsageLogMock).toHaveBeenCalledTimes(1);
    expect(insertUsageLogMock.mock.calls[0][1]).toMatchObject({ status: "ok", costMicroUsd: expectedCost });

    expect(budgetSettleMock).toHaveBeenCalledTimes(1);
    expect(budgetSettleMock.mock.calls[0][1]).toMatchObject({ actualMicroUsd: expectedCost });

    // 'untested' → 'ok' は状態変化のため markKeyOutcomeRow が呼ばれる
    expect(markKeyOutcomeRowMock).toHaveBeenCalledTimes(1);
    expect(markKeyOutcomeRowMock.mock.calls[0][2]).toMatchObject({ status: "ok" });
  });

  it("すでに status='ok' のキーが成功しても無駄な UPDATE を送らない", async () => {
    listKeyRowsMock.mockResolvedValue({ ok: true, value: [makeRow({ id: "key-ok2", status: "ok" })] });
    budgetReserveMock.mockResolvedValue({ ok: true, value: { reservationId: "r-4", ok: true, errorCode: null } });
    callOpenAiTextMock.mockResolvedValue({
      ok: true,
      value: {
        text: "hi",
        usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheWriteInputTokens: 0, webSearchRequests: 0 },
        stopReason: "stop",
      },
    });

    await routeGenerateText({ model: "gpt-5.4", feature: "test", messages: [{ role: "user", content: "hi" }] });
    expect(markKeyOutcomeRowMock).not.toHaveBeenCalled();
  });
});

describe("routeGenerateImages: 要求枚数と実返却枚数の乖離", () => {
  it("n=4 要求で 3 枚しか返らなかった場合、実際の枚数で予算確定・usage 記録する (過大確定しない)", async () => {
    listKeyRowsMock.mockResolvedValue({ ok: true, value: [makeRow({ id: "key-img", provider: "gemini", status: "untested" })] });
    budgetReserveMock.mockResolvedValue({ ok: true, value: { reservationId: "r-5", ok: true, errorCode: null } });
    const images = [
      { dataBase64: "a", mimeType: "image/png" },
      { dataBase64: "b", mimeType: "image/png" },
      { dataBase64: "c", mimeType: "image/png" },
    ];
    callGeminiImageMock.mockResolvedValue({ ok: true, value: { images } });

    const result = await routeGenerateImages({
      model: "gemini-3.1-flash-image",
      feature: "image-gen",
      prompt: "a cat",
      n: 4,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.images).toHaveLength(3);
    const expectedCost = computeImageCostMicroUsd("gemini", "gemini-3.1-flash-image", 3, undefined, undefined);
    expect(result.value.costMicroUsd).toBe(expectedCost);

    expect(budgetReserveMock.mock.calls[0][2]).toBe(4); // 予約は要求時点の n=4 で行う
    // v2 (reservation 方式・tester 検証 HIGH 対応): budgetSettle は estimateImageCount を
    // 直接受け取らず reservationId を持ち回る (server 側で予約行から estimate を引く)。
    expect(budgetSettleMock.mock.calls[0][1]).toMatchObject({
      reservationId: "r-5",
      actualImageCount: 3, // 確定は実際に返った枚数
      actualMicroUsd: expectedCost,
    });
    expect(insertUsageLogMock.mock.calls[0][1]).toMatchObject({ imageCount: 3, costMicroUsd: expectedCost });
  });

  it("全滅時は estimateImageCount 分を actualImageCount=0 で解放する", async () => {
    listKeyRowsMock.mockResolvedValue({ ok: true, value: [makeRow({ id: "key-img2", provider: "gemini", status: "untested" })] });
    budgetReserveMock.mockResolvedValue({ ok: true, value: { reservationId: "r-6", ok: true, errorCode: null } });
    callGeminiImageMock.mockResolvedValue({ ok: false, error: { kind: "rate_limit", message: "429", retryAfterSeconds: 5 } });

    const result = await routeGenerateImages({
      model: "gemini-3.1-flash-image",
      feature: "image-gen",
      prompt: "a cat",
      n: 4,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("KMB-E408");
    expect(budgetSettleMock).toHaveBeenCalledTimes(1);
    expect(budgetSettleMock.mock.calls[0][1]).toMatchObject({
      reservationId: "r-6",
      actualImageCount: 0,
      actualMicroUsd: 0,
    });
  });
});

describe("routeTranscribe: 候補ゼロ (キー未登録・env 未設定)", () => {
  it("候補が 0 件の場合、budgetReserve すら呼ばずに KMB-E408 を返す", async () => {
    listKeyRowsMock.mockResolvedValue({ ok: true, value: [] });
    delete process.env.OPENAI_API_KEY;

    const result = await routeTranscribe({ feature: "transcribe", filename: "a.webm", audioBase64: "AAAA" });
    expect(result).toEqual({
      ok: false,
      code: "KMB-E408",
      detail: "openai の利用可能なキーがありません (設定画面での登録、または環境変数を確認してください)",
    });
    expect(budgetReserveMock).not.toHaveBeenCalled();
  });
});
