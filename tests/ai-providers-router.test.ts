import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * canonical: docs/design/ai-studio-v2.md §1 (キー選択・フォールバック・429→次キー・cooldown)。
 * router.ts のキー選択/フォールバック分類の単体テスト (設計書 §13)。
 *
 * resolveCandidates は repository 層 (listKeyRows / vaultReadSecret) にのみ依存し、
 * createSupabaseServerClient/ServiceClient は呼び出し元 (routeGenerateText 等) が構築して
 * 引数で渡す設計のため、ここでは repository をモックするだけでよく、
 * ダミーの SupabaseClient オブジェクトを渡せば足りる (実 DB 接続不要)。
 */

const listKeyRowsMock = vi.fn();
const vaultReadSecretMock = vi.fn();

vi.mock("@/modules/ai-providers/repository", async () => {
  const actual = await vi.importActual<typeof import("@/modules/ai-providers/repository")>(
    "@/modules/ai-providers/repository",
  );
  return {
    ...actual,
    listKeyRows: (...args: unknown[]) => listKeyRowsMock(...args),
    vaultReadSecret: (...args: unknown[]) => vaultReadSecretMock(...args),
  };
});

import {
  classifyKeyOutcome,
  inferProviderFromModel,
  isUsableNow,
  resolveCandidates,
} from "@/modules/ai-providers/internal/router";
import type { AiProviderKeyRow } from "@/modules/ai-providers/repository";

const dummyClient = {} as SupabaseClient;

function makeRow(overrides: Partial<AiProviderKeyRow>): AiProviderKeyRow {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    provider: "openai",
    label: "テストキー",
    vault_secret_name: "ai-provider-key-openai-test",
    key_last4: "abcd",
    priority: 100,
    status: "ok",
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

describe("inferProviderFromModel", () => {
  it("claude- プレフィックスは anthropic", () => {
    expect(inferProviderFromModel("claude-opus-4-8")).toBe("anthropic");
  });
  it("gemini- / imagen- プレフィックスは gemini", () => {
    expect(inferProviderFromModel("gemini-3.1-flash-image")).toBe("gemini");
    expect(inferProviderFromModel("imagen-3.0-generate-002")).toBe("gemini");
  });
  it("それ以外 (gpt-* 等) は openai (既定フォールバック)", () => {
    expect(inferProviderFromModel("gpt-5.4")).toBe("openai");
    expect(inferProviderFromModel("dall-e-3")).toBe("openai");
    expect(inferProviderFromModel("totally-unknown-model")).toBe("openai");
  });
});

describe("isUsableNow", () => {
  const now = new Date("2026-07-10T12:00:00.000Z");

  it("status='failed' は常に使用不可", () => {
    expect(isUsableNow({ status: "failed", cooldown_until: null }, now)).toBe(false);
  });

  it("status='limited' かつ cooldown_until が未来なら使用不可", () => {
    expect(isUsableNow({ status: "limited", cooldown_until: "2026-07-10T12:00:01.000Z" }, now)).toBe(false);
  });

  it("status='limited' かつ cooldown_until が過去なら使用可能 (cooldown 明け)", () => {
    expect(isUsableNow({ status: "limited", cooldown_until: "2026-07-10T11:59:59.000Z" }, now)).toBe(true);
  });

  it("status='ok' / 'untested' は使用可能", () => {
    expect(isUsableNow({ status: "ok", cooldown_until: null }, now)).toBe(true);
    expect(isUsableNow({ status: "untested", cooldown_until: null }, now)).toBe(true);
  });
});

describe("classifyKeyOutcome (§1 MAJOR-1 のフォールバック状態遷移)", () => {
  it("成功 (error=null) → 'ok' へ (cooldown 解除)", () => {
    expect(classifyKeyOutcome(null)).toEqual({ changeStatus: true, status: "ok", cooldownSeconds: null });
  });

  it("auth (401/403) → 'failed'", () => {
    expect(classifyKeyOutcome({ kind: "auth", message: "invalid key" })).toEqual({
      changeStatus: true,
      status: "failed",
      cooldownSeconds: null,
    });
  });

  it("rate_limit (429) with Retry-After → 'limited' + その秒数", () => {
    expect(classifyKeyOutcome({ kind: "rate_limit", message: "rate limited", retryAfterSeconds: 12 })).toEqual({
      changeStatus: true,
      status: "limited",
      cooldownSeconds: 12,
    });
  });

  it("rate_limit (429) without Retry-After → 既定 30 秒", () => {
    expect(classifyKeyOutcome({ kind: "rate_limit", message: "rate limited", retryAfterSeconds: null })).toEqual({
      changeStatus: true,
      status: "limited",
      cooldownSeconds: 30,
    });
  });

  it("model_not_found → キー状態は変えない (次のキーへ進むのみ)", () => {
    expect(classifyKeyOutcome({ kind: "model_not_found", message: "model not found" }).changeStatus).toBe(false);
  });

  it("network → キー状態は変えない (internal 側で 1 回リトライ済み)", () => {
    expect(classifyKeyOutcome({ kind: "network", message: "ECONNRESET" }).changeStatus).toBe(false);
  });

  it("refusal → キー起因ではないため状態を変えない", () => {
    expect(classifyKeyOutcome({ kind: "refusal", message: "refused" }).changeStatus).toBe(false);
  });

  it("other → キー状態は変えない", () => {
    expect(classifyKeyOutcome({ kind: "other", message: "unknown" }).changeStatus).toBe(false);
  });
});

describe("resolveCandidates (§1: priority 順・cooldown/failed スキップ・env フォールバック)", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    listKeyRowsMock.mockReset();
    vaultReadSecretMock.mockReset();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("登録キーが使用可能ならそれを使う (DB の priority/created_at 順をそのまま透過する)", async () => {
    const rowA = makeRow({ id: "a", priority: 1 });
    const rowB = makeRow({ id: "b", priority: 2 });
    listKeyRowsMock.mockResolvedValue({ ok: true, value: [rowA, rowB] });
    vaultReadSecretMock.mockImplementation(async (_client: unknown, name: string) => ({
      ok: true,
      value: `secret-for-${name}`,
    }));

    const result = await resolveCandidates(dummyClient, dummyClient, "openai");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((c) => c.id)).toEqual(["a", "b"]);
    expect(result.value[0].apiKey).toBe(`secret-for-${rowA.vault_secret_name}`);
  });

  it("status='failed' のキーはスキップされる", async () => {
    const failedRow = makeRow({ id: "failed-key", status: "failed" });
    const okRow = makeRow({ id: "ok-key", status: "ok" });
    listKeyRowsMock.mockResolvedValue({ ok: true, value: [failedRow, okRow] });
    vaultReadSecretMock.mockResolvedValue({ ok: true, value: "secret" });

    const result = await resolveCandidates(dummyClient, dummyClient, "openai");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((c) => c.id)).toEqual(["ok-key"]);
  });

  it("status='limited' かつ cooldown 中のキーはスキップされる (429→次キー)", async () => {
    const futureCooldown = new Date(Date.now() + 60_000).toISOString();
    const limitedRow = makeRow({ id: "limited-key", status: "limited", cooldown_until: futureCooldown });
    const okRow = makeRow({ id: "ok-key", status: "ok" });
    listKeyRowsMock.mockResolvedValue({ ok: true, value: [limitedRow, okRow] });
    vaultReadSecretMock.mockResolvedValue({ ok: true, value: "secret" });

    const result = await resolveCandidates(dummyClient, dummyClient, "openai");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((c) => c.id)).toEqual(["ok-key"]);
  });

  it("Vault にシークレットが無い (null) キーはスキップされる", async () => {
    const row = makeRow({ id: "no-secret" });
    listKeyRowsMock.mockResolvedValue({ ok: true, value: [row] });
    vaultReadSecretMock.mockResolvedValue({ ok: true, value: null });

    const result = await resolveCandidates(dummyClient, dummyClient, "openai");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("登録キーが 0 件 (使用可能なもの無し) の場合 env 変数へフォールバックする (非退行要件)", async () => {
    listKeyRowsMock.mockResolvedValue({ ok: true, value: [] });
    process.env.OPENAI_API_KEY = "env-openai-key";

    const result = await resolveCandidates(dummyClient, dummyClient, "openai");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([{ id: null, apiKey: "env-openai-key", row: null }]);
  });

  it("全キーが cooldown/failed で env も未設定なら候補ゼロ", async () => {
    const failedRow = makeRow({ id: "failed-key", status: "failed" });
    listKeyRowsMock.mockResolvedValue({ ok: true, value: [failedRow] });
    delete process.env.OPENAI_API_KEY;

    const result = await resolveCandidates(dummyClient, dummyClient, "openai");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("プロバイダ別に正しい env 変数を参照する (anthropic/gemini)", async () => {
    listKeyRowsMock.mockResolvedValue({ ok: true, value: [] });
    process.env.ANTHROPIC_API_KEY = "env-anthropic-key";
    process.env.GEMINI_API_KEY = "env-gemini-key";

    const anthropicResult = await resolveCandidates(dummyClient, dummyClient, "anthropic");
    const geminiResult = await resolveCandidates(dummyClient, dummyClient, "gemini");
    expect(anthropicResult.ok && anthropicResult.value[0]?.apiKey).toBe("env-anthropic-key");
    expect(geminiResult.ok && geminiResult.value[0]?.apiKey).toBe("env-gemini-key");
  });
});
