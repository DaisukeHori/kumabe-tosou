import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/crm-suite/04-telephony.md §6.1 手順 1-4 (webhook 3 本共通の前処理 —
 * src/app/api/telephony/shared.ts の verifyTelephonyWebhook)。
 *
 * 障害再現: NEXT_PUBLIC_SITE_URL に末尾スラッシュ付き (`https://x.example.com/`) を設定すると、
 * 旧実装は検証 URL を `${SITE_URL}${pathname}` で組み立てていたため
 * `https://x.example.com//api/telephony/voice` になり、Twilio が実際に署名した URL
 * (単一スラッシュ) と一致せず全 webhook が KMB-E801 (403) になっていた。
 * 本テストは src/lib/site-base-url.ts の normalizeSiteBaseUrl を経由して署名検証が通ることを固定する。
 */

const getEnvMock = vi.fn();
vi.mock("@/lib/env", () => ({
  getEnv: () => getEnvMock(),
}));

// Twilio 認証情報は src/lib/integration-credentials.ts (設定 > 外部連携 (DB+Vault) 優先・env フォールバック)
// から解決する。isIntegrationConfigured / resolveIntegrationCredentials の両方をモックし、
// 「DB に保存された Auth Token で署名検証が通る」経路も固定する。
const isIntegrationConfiguredMock = vi.fn();
const resolveIntegrationCredentialsMock = vi.fn();
vi.mock("@/lib/integration-credentials", () => ({
  isIntegrationConfigured: (...args: unknown[]) => isIntegrationConfiguredMock(...args),
  resolveIntegrationCredentials: (...args: unknown[]) => resolveIntegrationCredentialsMock(...args),
}));

import { normalizeSiteBaseUrl } from "@/lib/site-base-url";
import { computeTwilioSignature } from "@/lib/telephony-signature";
import { verifyTelephonyWebhook } from "@/app/api/telephony/shared";

const AUTH_TOKEN = "__telephony_test__auth_token_1234567890";
const CANONICAL_SITE_URL = "https://x.example.com";
const PARAMS: Record<string, string> = {
  CallSid: "CA00000000000000000000000000000001",
  DialCallStatus: "no-answer",
  CallStatus: "in-progress",
};

function buildRequest(pathAndQuery: string, signature: string | null): Request {
  const body = new URLSearchParams(PARAMS).toString();
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (signature !== null) headers["X-Twilio-Signature"] = signature;
  // Vercel プロキシ経由を模して request.url は内部ホスト/http にする (ホスト部は env から組み立てる設計)。
  return new Request(`http://internal-host:3000${pathAndQuery}`, { method: "POST", headers, body });
}

function credentials(secret: string | null, source: "db" | "env" | "none") {
  return { provider: "twilio", publicId: "AC00000000000000000000000000000000", secret, source };
}

beforeEach(() => {
  vi.clearAllMocks();
  isIntegrationConfiguredMock.mockResolvedValue(true);
  resolveIntegrationCredentialsMock.mockResolvedValue(credentials(AUTH_TOKEN, "env"));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("normalizeSiteBaseUrl (src/lib/site-base-url.ts)", () => {
  it("末尾スラッシュを除去する (1 個でも連続でも)。末尾なしはそのまま", () => {
    expect(normalizeSiteBaseUrl("https://x.example.com/")).toBe("https://x.example.com");
    expect(normalizeSiteBaseUrl("https://x.example.com///")).toBe("https://x.example.com");
    expect(normalizeSiteBaseUrl("https://x.example.com")).toBe("https://x.example.com");
  });

  it("途中のスラッシュには触れない (パス付き URL の末尾のみ)", () => {
    expect(normalizeSiteBaseUrl("https://x.example.com/app/")).toBe("https://x.example.com/app");
  });
});

describe("verifyTelephonyWebhook: NEXT_PUBLIC_SITE_URL の末尾スラッシュ", () => {
  it("末尾スラッシュ付き env でも、Twilio が署名した単一スラッシュ URL で検証が通る (旧実装の // 回帰防止)", async () => {
    getEnvMock.mockReturnValue({ NEXT_PUBLIC_SITE_URL: `${CANONICAL_SITE_URL}/` });
    const pathAndQuery = "/api/telephony/voice?step=dial_result";
    // Twilio 側は登録された webhook URL (単一スラッシュ) で署名する。
    const signature = computeTwilioSignature(AUTH_TOKEN, `${CANONICAL_SITE_URL}${pathAndQuery}`, PARAMS);

    const result = await verifyTelephonyWebhook(buildRequest(pathAndQuery, signature));

    expect(result).toEqual({ ok: true, params: PARAMS });
  });

  it("末尾スラッシュなし env でも同じ署名で検証が通る (正規化が既存動作を壊さない)", async () => {
    getEnvMock.mockReturnValue({ NEXT_PUBLIC_SITE_URL: CANONICAL_SITE_URL });
    const pathAndQuery = "/api/telephony/status";
    const signature = computeTwilioSignature(AUTH_TOKEN, `${CANONICAL_SITE_URL}${pathAndQuery}`, PARAMS);

    const result = await verifyTelephonyWebhook(buildRequest(pathAndQuery, signature));

    expect(result.ok).toBe(true);
  });

  it("// 付き URL で計算された署名 (旧実装が要求していた形) は一致しない — 検証 URL が単一スラッシュになっていることの反証", async () => {
    getEnvMock.mockReturnValue({ NEXT_PUBLIC_SITE_URL: `${CANONICAL_SITE_URL}/` });
    const pathAndQuery = "/api/telephony/voice";
    const doubleSlashSignature = computeTwilioSignature(AUTH_TOKEN, `${CANONICAL_SITE_URL}//api/telephony/voice`, PARAMS);

    const result = await verifyTelephonyWebhook(buildRequest(pathAndQuery, doubleSlashSignature));

    expect(result).toEqual({ ok: false, status: 403, code: "KMB-E801" });
  });

  it("署名ヘッダ欠落は 403 (KMB-E801)、Twilio 認証情報未設定 (isIntegrationConfigured=false) は 503 (KMB-E802)", async () => {
    getEnvMock.mockReturnValue({ NEXT_PUBLIC_SITE_URL: CANONICAL_SITE_URL });
    expect(await verifyTelephonyWebhook(buildRequest("/api/telephony/voice", null))).toEqual({
      ok: false,
      status: 403,
      code: "KMB-E801",
    });

    isIntegrationConfiguredMock.mockResolvedValue(false);
    expect(await verifyTelephonyWebhook(buildRequest("/api/telephony/voice", "x"))).toEqual({
      ok: false,
      status: 503,
      code: "KMB-E802",
    });
    expect(isIntegrationConfiguredMock).toHaveBeenCalledWith("twilio");
  });
});

describe("verifyTelephonyWebhook: 認証情報の解決元 (設定 > 外部連携 / env)", () => {
  it("DB (設定 > 外部連携) に保存された Auth Token で署名検証が通る", async () => {
    const DB_AUTH_TOKEN = "__telephony_test__db_auth_token_abcdef";
    getEnvMock.mockReturnValue({ NEXT_PUBLIC_SITE_URL: CANONICAL_SITE_URL });
    resolveIntegrationCredentialsMock.mockResolvedValue(credentials(DB_AUTH_TOKEN, "db"));
    const pathAndQuery = "/api/telephony/voice";
    const signature = computeTwilioSignature(DB_AUTH_TOKEN, `${CANONICAL_SITE_URL}${pathAndQuery}`, PARAMS);

    const result = await verifyTelephonyWebhook(buildRequest(pathAndQuery, signature));

    expect(result).toEqual({ ok: true, params: PARAMS });
    expect(resolveIntegrationCredentialsMock).toHaveBeenCalledWith("twilio");
  });

  it("DB の Auth Token と異なるトークンで計算された署名 (env の旧トークン等) は 403 (KMB-E801)", async () => {
    getEnvMock.mockReturnValue({ NEXT_PUBLIC_SITE_URL: CANONICAL_SITE_URL });
    resolveIntegrationCredentialsMock.mockResolvedValue(credentials("__telephony_test__db_auth_token_abcdef", "db"));
    const pathAndQuery = "/api/telephony/voice";
    const staleSignature = computeTwilioSignature(AUTH_TOKEN, `${CANONICAL_SITE_URL}${pathAndQuery}`, PARAMS);

    const result = await verifyTelephonyWebhook(buildRequest(pathAndQuery, staleSignature));

    expect(result).toEqual({ ok: false, status: 403, code: "KMB-E801" });
  });

  it("isIntegrationConfigured=true でも secret が null なら 403 (型上の安全網 — as で潰さない)", async () => {
    getEnvMock.mockReturnValue({ NEXT_PUBLIC_SITE_URL: CANONICAL_SITE_URL });
    resolveIntegrationCredentialsMock.mockResolvedValue(credentials(null, "none"));

    const result = await verifyTelephonyWebhook(buildRequest("/api/telephony/voice", "x"));

    expect(result).toEqual({ ok: false, status: 403, code: "KMB-E801" });
  });
});
