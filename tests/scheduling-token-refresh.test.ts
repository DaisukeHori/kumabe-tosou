import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * canonical: docs/design/crm-suite/03-scheduling.md §8.3 (トークン管理)。
 * 実装計画書「テスト戦略」§scheduling-token-refresh.test.ts の必須ケース:
 *   CASリース単一実行 / 期限マージン / invalid_grant→expired / invalid_client→E723区別
 *
 * repository.ts (Vault RPC / リース CAS / connection 状態更新) を vi.mock し、
 * X の getValidXAccessToken 移植パターン (scheduling-actual.integration.test.ts と同型の
 * 「docker 無し = repository をモックした internal 単体テスト」方針) で検証する。
 */

const vaultReadSecretMock = vi.fn();
const vaultUpsertSecretMock = vi.fn();
const claimCalendarTokenRefreshLeaseMock = vi.fn();
const releaseCalendarTokenRefreshLeaseMock = vi.fn();
const updateCalendarConnectionStatusMock = vi.fn();

vi.mock("@/modules/scheduling/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/scheduling/repository")>();
  return {
    ...actual,
    vaultReadSecret: (...args: unknown[]) => vaultReadSecretMock(...args),
    vaultUpsertSecret: (...args: unknown[]) => vaultUpsertSecretMock(...args),
    claimCalendarTokenRefreshLease: (...args: unknown[]) => claimCalendarTokenRefreshLeaseMock(...args),
    releaseCalendarTokenRefreshLease: (...args: unknown[]) => releaseCalendarTokenRefreshLeaseMock(...args),
    updateCalendarConnectionStatus: (...args: unknown[]) => updateCalendarConnectionStatusMock(...args),
  };
});

import {
  forceRefreshCalendarSecret,
  getValidCalendarSecret,
  TokenClientMisconfiguredError,
  TokenExpiredError,
} from "@/modules/scheduling/internal/token";
import type { CalendarProviderAdapter } from "@/modules/scheduling/internal/provider";
import { OAuthTokenError } from "@/modules/scheduling/internal/provider";
import type { CalendarVaultSecret } from "@/modules/scheduling/internal/vault-names";

const FAKE_CLIENT = {} as unknown as SupabaseClient;
const ENV = { clientId: "cid", clientSecret: "csecret" };

function secretJson(overrides: Partial<CalendarVaultSecret> = {}): string {
  const secret: CalendarVaultSecret = {
    access_token: "access-old",
    refresh_token: "refresh-old",
    expires_at: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
  return JSON.stringify(secret);
}

function makeAdapter(overrides: Partial<CalendarProviderAdapter> = {}): CalendarProviderAdapter {
  const notImplemented = () => {
    throw new Error("not implemented in this test");
  };
  return {
    ensureAppCalendar: notImplemented,
    calendarExists: notImplemented,
    createEvent: notImplemented,
    updateEvent: notImplemented,
    deleteEvent: notImplemented,
    pullChanges: notImplemented,
    findByLinkId: notImplemented,
    getBusy: notImplemented,
    refreshTokens: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  releaseCalendarTokenRefreshLeaseMock.mockResolvedValue({ ok: true, value: undefined });
  updateCalendarConnectionStatusMock.mockResolvedValue({ ok: true, value: undefined });
});

describe("getValidCalendarSecret: 期限マージン (§8.3 手順1)", () => {
  it("expires_at まで5分超あれば現行 secret をそのまま返し、リースは取得しない", async () => {
    vaultReadSecretMock.mockResolvedValue({ ok: true, value: secretJson({ expires_at: "2099-01-01T00:00:00.000Z" }) });
    const adapter = makeAdapter();

    const secret = await getValidCalendarSecret(FAKE_CLIENT, "google", adapter, ENV);

    expect(secret.access_token).toBe("access-old");
    expect(claimCalendarTokenRefreshLeaseMock).not.toHaveBeenCalled();
    expect(adapter.refreshTokens).not.toHaveBeenCalled();
  });

  it("未接続 (Vault に secret が無い) は TokenExpiredError を送出し、リースを取得しない", async () => {
    vaultReadSecretMock.mockResolvedValue({ ok: true, value: null });
    const adapter = makeAdapter();

    await expect(getValidCalendarSecret(FAKE_CLIENT, "google", adapter, ENV)).rejects.toBeInstanceOf(TokenExpiredError);
    expect(claimCalendarTokenRefreshLeaseMock).not.toHaveBeenCalled();
  });

  it("Vault RPC 自体のインフラ異常は握り潰さず例外を投げる (未接続と区別する)", async () => {
    vaultReadSecretMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "db down" });
    const adapter = makeAdapter();

    let caught: unknown;
    try {
      await getValidCalendarSecret(FAKE_CLIENT, "google", adapter, ENV);
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeInstanceOf(TokenExpiredError);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("db down");
  });
});

describe("getValidCalendarSecret: CAS リース単一実行 (§8.3 手順2/3/4)", () => {
  it("期限接近時、リースが取れれば refresh を実行し Vault へ全体上書き保存、finally でリースを解放する", async () => {
    vaultReadSecretMock.mockResolvedValue({ ok: true, value: secretJson({ expires_at: new Date(Date.now() + 60_000).toISOString() }) });
    claimCalendarTokenRefreshLeaseMock.mockResolvedValue({ ok: true, value: true });
    vaultUpsertSecretMock.mockResolvedValue({ ok: true, value: undefined });
    const refreshed: CalendarVaultSecret = {
      access_token: "access-new",
      refresh_token: "refresh-old",
      expires_at: "2099-01-01T00:00:00.000Z",
    };
    const adapter = makeAdapter({ refreshTokens: vi.fn().mockResolvedValue(refreshed) });

    const result = await getValidCalendarSecret(FAKE_CLIENT, "google", adapter, ENV);

    expect(result.access_token).toBe("access-new");
    expect(claimCalendarTokenRefreshLeaseMock).toHaveBeenCalledTimes(1);
    expect(adapter.refreshTokens).toHaveBeenCalledTimes(1);
    expect(vaultUpsertSecretMock).toHaveBeenCalledWith(FAKE_CLIENT, "calendar_google_oauth", JSON.stringify(refreshed));
    expect(releaseCalendarTokenRefreshLeaseMock).toHaveBeenCalledTimes(1);
  });

  it("リースが他プロセスに保持中 (取得失敗) の場合は refresh を実行せず、待機後に Vault を再読みして返す", async () => {
    vi.useFakeTimers();
    const nearExpirySecret = secretJson({ expires_at: new Date(Date.now() + 60_000).toISOString() });
    const rereadSecret: CalendarVaultSecret = {
      access_token: "access-from-other-process",
      refresh_token: "refresh-old",
      expires_at: "2099-01-01T00:00:00.000Z",
    };
    vaultReadSecretMock
      .mockResolvedValueOnce({ ok: true, value: nearExpirySecret })
      .mockResolvedValueOnce({ ok: true, value: JSON.stringify(rereadSecret) });
    claimCalendarTokenRefreshLeaseMock.mockResolvedValue({ ok: true, value: false });
    const adapter = makeAdapter();

    const promise = getValidCalendarSecret(FAKE_CLIENT, "google", adapter, ENV);
    await vi.advanceTimersByTimeAsync(1_500);
    const result = await promise;

    expect(result.access_token).toBe("access-from-other-process");
    expect(adapter.refreshTokens).not.toHaveBeenCalled();
    expect(vaultReadSecretMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe("doRefresh: invalid_grant → connection.status='expired' + KMB-E720 (§8.3 手順5)", () => {
  it("invalid_grant (400系) は connection を expired/KMB-E720 に更新し、TokenExpiredError を送出する。自動リトライしない", async () => {
    vaultReadSecretMock.mockResolvedValue({ ok: true, value: secretJson({ expires_at: new Date(Date.now() + 60_000).toISOString() }) });
    claimCalendarTokenRefreshLeaseMock.mockResolvedValue({ ok: true, value: true });
    const adapter = makeAdapter({
      refreshTokens: vi.fn().mockRejectedValue(new OAuthTokenError("invalid_grant response", 400, "invalid_grant")),
    });

    await expect(getValidCalendarSecret(FAKE_CLIENT, "google", adapter, ENV)).rejects.toBeInstanceOf(TokenExpiredError);

    expect(updateCalendarConnectionStatusMock).toHaveBeenCalledWith(FAKE_CLIENT, "google", "expired", "KMB-E720", expect.any(String));
    expect(vaultUpsertSecretMock).not.toHaveBeenCalled();
    expect(releaseCalendarTokenRefreshLeaseMock).toHaveBeenCalledTimes(1);
    // 自動リトライしない: refreshTokens は1回のみ呼ばれる
    expect(adapter.refreshTokens).toHaveBeenCalledTimes(1);
  });
});

describe("doRefresh: invalid_client → connection.status='error' + KMB-E723 (E720 と区別。§8.3 手順6)", () => {
  it("invalid_client は expired/E720 ではなく error/KMB-E723 に更新し、TokenClientMisconfiguredError を送出する", async () => {
    vaultReadSecretMock.mockResolvedValue({ ok: true, value: secretJson({ expires_at: new Date(Date.now() + 60_000).toISOString() }) });
    claimCalendarTokenRefreshLeaseMock.mockResolvedValue({ ok: true, value: true });
    const adapter = makeAdapter({
      refreshTokens: vi.fn().mockRejectedValue(new OAuthTokenError("invalid_client response", 401, "invalid_client")),
    });

    await expect(getValidCalendarSecret(FAKE_CLIENT, "google", adapter, ENV)).rejects.toBeInstanceOf(TokenClientMisconfiguredError);

    expect(updateCalendarConnectionStatusMock).toHaveBeenCalledWith(
      FAKE_CLIENT,
      "google",
      "error",
      "KMB-E723",
      expect.stringContaining("クライアントシークレット"),
    );
    // E720 (expired) には更新されていないことを明示的に確認 (地雷: 混同すると再連携バナーへの誤誘導)
    expect(updateCalendarConnectionStatusMock).not.toHaveBeenCalledWith(FAKE_CLIENT, "google", "expired", "KMB-E720", expect.anything());
  });
});

describe("doRefresh: 一時的失敗 (5xx/ネットワーク) は connection の状態を変更せず再送出する", () => {
  it("OAuthTokenError(status=500) は invalid_client/invalid_grant のいずれにも該当せず、connection 状態を変更しない", async () => {
    vaultReadSecretMock.mockResolvedValue({ ok: true, value: secretJson({ expires_at: new Date(Date.now() + 60_000).toISOString() }) });
    claimCalendarTokenRefreshLeaseMock.mockResolvedValue({ ok: true, value: true });
    const originalErr = new OAuthTokenError("server error", 500, null);
    const adapter = makeAdapter({ refreshTokens: vi.fn().mockRejectedValue(originalErr) });

    let caught: unknown;
    try {
      await getValidCalendarSecret(FAKE_CLIENT, "google", adapter, ENV);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(originalErr);
    expect(updateCalendarConnectionStatusMock).not.toHaveBeenCalled();
    expect(releaseCalendarTokenRefreshLeaseMock).toHaveBeenCalledTimes(1);
  });

  it("OAuthTokenError 以外の例外 (ネットワーク断) もそのまま再送出し、connection 状態を変更しない", async () => {
    vaultReadSecretMock.mockResolvedValue({ ok: true, value: secretJson({ expires_at: new Date(Date.now() + 60_000).toISOString() }) });
    claimCalendarTokenRefreshLeaseMock.mockResolvedValue({ ok: true, value: true });
    const networkErr = new TypeError("fetch failed");
    const adapter = makeAdapter({ refreshTokens: vi.fn().mockRejectedValue(networkErr) });

    let caught: unknown;
    try {
      await getValidCalendarSecret(FAKE_CLIENT, "google", adapter, ENV);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(networkErr);
    expect(updateCalendarConnectionStatusMock).not.toHaveBeenCalled();
  });
});

describe("forceRefreshCalendarSecret: margin を無視して強制的に refresh する (401 リトライ専用)", () => {
  it("expires_at が far future でも margin チェックを無視して refresh を実行する", async () => {
    vaultReadSecretMock.mockResolvedValue({ ok: true, value: secretJson({ expires_at: "2099-01-01T00:00:00.000Z" }) });
    claimCalendarTokenRefreshLeaseMock.mockResolvedValue({ ok: true, value: true });
    vaultUpsertSecretMock.mockResolvedValue({ ok: true, value: undefined });
    const refreshed: CalendarVaultSecret = {
      access_token: "access-forced",
      refresh_token: "refresh-old",
      expires_at: "2099-01-01T00:00:00.000Z",
    };
    const adapter = makeAdapter({ refreshTokens: vi.fn().mockResolvedValue(refreshed) });

    const result = await forceRefreshCalendarSecret(FAKE_CLIENT, "google", adapter, ENV);

    expect(result.access_token).toBe("access-forced");
    expect(adapter.refreshTokens).toHaveBeenCalledTimes(1);
  });
});
