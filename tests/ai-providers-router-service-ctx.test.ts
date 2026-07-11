import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * canonical: docs/design/crm-suite/00-overview.md §3.1.2 (ExecutionContext によるクライアント注入)。
 *
 * §3.1.1 の実測済み問題: router.ts の routeGenerateText/routeGenerateImages/routeTranscribe は
 * 冒頭で createSupabaseServerClient() (cookie セッション) を固定生成し、予算 RPC
 * (ai_budget_reserve/ai_budget_settle) は auth.uid() が profiles に無いと raise exception する
 * ため、service_role クライアントで呼んでも通らない (Twilio webhook / pg_cron 文脈から AI を
 * 呼べない)。migration 0021 の is_admin_or_service() 緩和とセットで、router 側は
 * `ctx.mode === "service"` のとき cookie 依存の createSupabaseServerClient() を一切呼ばず、
 * ctx.client (省略時は service client) を予算/usage/候補解決の全 DB アクセスに使う設計になった
 * (§3.1.2b)。本ファイルはその配線を単体で検証する。
 *
 * A3 (既存 cookie 経路の非退行): ctx 省略時の挙動は ai-providers-router-integration.test.ts が
 * 検証済みの「常に sessionClient を使う」動作と完全一致するはずであり、本ファイルはそれを
 * 「sessionClient オブジェクトの同一性」という観点で追加検証する (既存テストのアサーションは
 * 一切書き換えない)。
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

// 識別可能な固定オブジェクトを sessionClient / rawServiceClient のマーカーとして使う
// (同一性比較 `toBe` で「どのクライアントが渡ったか」を厳密に検証するため)。
const sessionClientMarker = { __kind: "session-cookie-client" } as unknown as SupabaseClient;
const rawServiceClientMarker = { __kind: "raw-service-client" } as unknown as SupabaseClient;

const createSupabaseServerClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: (...args: unknown[]) => createSupabaseServerClientMock(...args),
}));

const createSupabaseServiceClientMock = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: (...args: unknown[]) => createSupabaseServiceClientMock(...args),
}));

import { routeGenerateImages, routeGenerateText, routeTranscribe } from "@/modules/ai-providers/internal/router";
import type { AiProviderKeyRow } from "@/modules/ai-providers/repository";

function makeRow(overrides: Partial<AiProviderKeyRow>): AiProviderKeyRow {
  return {
    id: "22222222-2222-2222-2222-222222222222",
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
  createSupabaseServerClientMock.mockResolvedValue(sessionClientMarker);
  createSupabaseServiceClientMock.mockReturnValue(rawServiceClientMarker);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// service ctx 注入用の、rawServiceClient とも sessionClient とも異なる第 3 のマーカー
// (「ctx.client がちゃんと使われている」ことを、raw serviceClient へのフォールバックとの
// 取り違えなしに検証するため)。
function makeInjectedServiceClient(id: string): SupabaseClient {
  return { __kind: "injected-service-client", id } as unknown as SupabaseClient;
}

describe("routeGenerateText: ExecutionContext によるクライアント配線", () => {
  it("ctx 省略時 (session) は、予算/usage/候補解決のすべてに sessionClient (cookie) が渡る", async () => {
    listKeyRowsMock.mockResolvedValue({ ok: true, value: [makeRow({ id: "key-1" })] });
    budgetReserveMock.mockResolvedValue({ ok: true, value: { reservationId: "r-1", ok: true, errorCode: null } });
    callOpenAiTextMock.mockResolvedValue({
      ok: true,
      value: {
        text: "hi",
        usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheWriteInputTokens: 0, webSearchRequests: 0 },
        stopReason: "stop",
      },
    });

    const result = await routeGenerateText({
      model: "gpt-5.4",
      feature: "test",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.ok).toBe(true);
    expect(createSupabaseServerClientMock).toHaveBeenCalledTimes(1);

    expect(listKeyRowsMock.mock.calls[0][0]).toBe(sessionClientMarker);
    expect(budgetReserveMock.mock.calls[0][0]).toBe(sessionClientMarker);
    expect(budgetSettleMock.mock.calls[0][0]).toBe(sessionClientMarker);
    expect(insertUsageLogMock.mock.calls[0][0]).toBe(sessionClientMarker);
    expect(markKeyOutcomeRowMock.mock.calls[0][0]).toBe(sessionClientMarker);

    // Vault からの秘密読み取りは常に raw service client (キー自体は cookie セッションに
    // 依存させない既存設計。ctx 分岐の対象外)。
    expect(vaultReadSecretMock.mock.calls[0][0]).toBe(rawServiceClientMarker);
  });

  it("ctx={mode:'service', client} 時は cookie client を一切呼ばず、注入された client が全 DB アクセスに渡る", async () => {
    const injected = makeInjectedServiceClient("text");
    listKeyRowsMock.mockResolvedValue({ ok: true, value: [makeRow({ id: "key-2" })] });
    budgetReserveMock.mockResolvedValue({ ok: true, value: { reservationId: "r-2", ok: true, errorCode: null } });
    callOpenAiTextMock.mockResolvedValue({
      ok: true,
      value: {
        text: "hi",
        usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheWriteInputTokens: 0, webSearchRequests: 0 },
        stopReason: "stop",
      },
    });

    const result = await routeGenerateText(
      { model: "gpt-5.4", feature: "test", messages: [{ role: "user", content: "hi" }] },
      { mode: "service", client: injected },
    );

    expect(result.ok).toBe(true);
    // 地雷回避の直接証拠: cookie 依存の createSupabaseServerClient() は一度も呼ばれない。
    expect(createSupabaseServerClientMock).not.toHaveBeenCalled();

    expect(listKeyRowsMock.mock.calls[0][0]).toBe(injected);
    expect(budgetReserveMock.mock.calls[0][0]).toBe(injected);
    expect(budgetSettleMock.mock.calls[0][0]).toBe(injected);
    expect(insertUsageLogMock.mock.calls[0][0]).toBe(injected);
    expect(markKeyOutcomeRowMock.mock.calls[0][0]).toBe(injected);

    // sessionClient (cookie) が紛れ込んでいないことも明示的に否定する。
    expect(listKeyRowsMock.mock.calls[0][0]).not.toBe(sessionClientMarker);
    expect(budgetReserveMock.mock.calls[0][0]).not.toBe(sessionClientMarker);
    expect(budgetSettleMock.mock.calls[0][0]).not.toBe(sessionClientMarker);
  });

  it("ctx={mode:'service'} で client 省略時は raw service client にフォールバックする", async () => {
    listKeyRowsMock.mockResolvedValue({ ok: true, value: [makeRow({ id: "key-3" })] });
    budgetReserveMock.mockResolvedValue({ ok: true, value: { reservationId: "r-3", ok: true, errorCode: null } });
    callOpenAiTextMock.mockResolvedValue({
      ok: true,
      value: {
        text: "hi",
        usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheWriteInputTokens: 0, webSearchRequests: 0 },
        stopReason: "stop",
      },
    });

    await routeGenerateText(
      { model: "gpt-5.4", feature: "test", messages: [{ role: "user", content: "hi" }] },
      { mode: "service" },
    );

    expect(createSupabaseServerClientMock).not.toHaveBeenCalled();
    expect(listKeyRowsMock.mock.calls[0][0]).toBe(rawServiceClientMarker);
    expect(budgetReserveMock.mock.calls[0][0]).toBe(rawServiceClientMarker);
  });
});

describe("routeGenerateImages: ExecutionContext によるクライアント配線", () => {
  it("ctx 省略時 (session) は sessionClient が渡る", async () => {
    listKeyRowsMock.mockResolvedValue({ ok: true, value: [makeRow({ id: "key-img-1", provider: "gemini" })] });
    budgetReserveMock.mockResolvedValue({ ok: true, value: { reservationId: "r-4", ok: true, errorCode: null } });
    callGeminiImageMock.mockResolvedValue({
      ok: true,
      value: { images: [{ dataBase64: "a", mimeType: "image/png" }] },
    });

    const result = await routeGenerateImages({
      model: "gemini-3.1-flash-image",
      feature: "image-gen",
      prompt: "a cat",
      n: 1,
    });

    expect(result.ok).toBe(true);
    expect(createSupabaseServerClientMock).toHaveBeenCalledTimes(1);
    expect(listKeyRowsMock.mock.calls[0][0]).toBe(sessionClientMarker);
    expect(budgetReserveMock.mock.calls[0][0]).toBe(sessionClientMarker);
    expect(budgetSettleMock.mock.calls[0][0]).toBe(sessionClientMarker);
    expect(insertUsageLogMock.mock.calls[0][0]).toBe(sessionClientMarker);
    expect(markKeyOutcomeRowMock.mock.calls[0][0]).toBe(sessionClientMarker);
  });

  it("ctx={mode:'service', client} 時は cookie client を呼ばず、注入 client が全 DB アクセスに渡る", async () => {
    const injected = makeInjectedServiceClient("image");
    listKeyRowsMock.mockResolvedValue({ ok: true, value: [makeRow({ id: "key-img-2", provider: "gemini" })] });
    budgetReserveMock.mockResolvedValue({ ok: true, value: { reservationId: "r-5", ok: true, errorCode: null } });
    callGeminiImageMock.mockResolvedValue({
      ok: true,
      value: { images: [{ dataBase64: "a", mimeType: "image/png" }] },
    });

    const result = await routeGenerateImages(
      { model: "gemini-3.1-flash-image", feature: "image-gen", prompt: "a cat", n: 1 },
      { mode: "service", client: injected },
    );

    expect(result.ok).toBe(true);
    expect(createSupabaseServerClientMock).not.toHaveBeenCalled();
    expect(listKeyRowsMock.mock.calls[0][0]).toBe(injected);
    expect(budgetReserveMock.mock.calls[0][0]).toBe(injected);
    expect(budgetSettleMock.mock.calls[0][0]).toBe(injected);
    expect(insertUsageLogMock.mock.calls[0][0]).toBe(injected);
    expect(markKeyOutcomeRowMock.mock.calls[0][0]).toBe(injected);
  });
});

describe("routeTranscribe: ExecutionContext によるクライアント配線", () => {
  it("ctx 省略時 (session) は sessionClient が渡る", async () => {
    listKeyRowsMock.mockResolvedValue({ ok: true, value: [makeRow({ id: "key-tr-1" })] });
    budgetReserveMock.mockResolvedValue({ ok: true, value: { reservationId: "r-6", ok: true, errorCode: null } });
    callOpenAiTranscribeMock.mockResolvedValue({ ok: true, value: { text: "こんにちは" } });

    const result = await routeTranscribe({ feature: "transcribe", filename: "a.webm", audioBase64: "AAAA" });

    expect(result.ok).toBe(true);
    expect(createSupabaseServerClientMock).toHaveBeenCalledTimes(1);
    expect(listKeyRowsMock.mock.calls[0][0]).toBe(sessionClientMarker);
    expect(budgetReserveMock.mock.calls[0][0]).toBe(sessionClientMarker);
    expect(budgetSettleMock.mock.calls[0][0]).toBe(sessionClientMarker);
    expect(insertUsageLogMock.mock.calls[0][0]).toBe(sessionClientMarker);
    expect(markKeyOutcomeRowMock.mock.calls[0][0]).toBe(sessionClientMarker);
  });

  it("ctx={mode:'service', client} 時は cookie client を呼ばず、注入 client が全 DB アクセスに渡る", async () => {
    const injected = makeInjectedServiceClient("transcribe");
    listKeyRowsMock.mockResolvedValue({ ok: true, value: [makeRow({ id: "key-tr-2" })] });
    budgetReserveMock.mockResolvedValue({ ok: true, value: { reservationId: "r-7", ok: true, errorCode: null } });
    callOpenAiTranscribeMock.mockResolvedValue({ ok: true, value: { text: "こんにちは" } });

    const result = await routeTranscribe(
      { feature: "transcribe", filename: "a.webm", audioBase64: "AAAA" },
      { mode: "service", client: injected },
    );

    expect(result.ok).toBe(true);
    expect(createSupabaseServerClientMock).not.toHaveBeenCalled();
    expect(listKeyRowsMock.mock.calls[0][0]).toBe(injected);
    expect(budgetReserveMock.mock.calls[0][0]).toBe(injected);
    expect(budgetSettleMock.mock.calls[0][0]).toBe(injected);
    expect(insertUsageLogMock.mock.calls[0][0]).toBe(injected);
    expect(markKeyOutcomeRowMock.mock.calls[0][0]).toBe(injected);
  });
});
