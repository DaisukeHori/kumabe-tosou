import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApprovedDraft } from "@/modules/ai-studio/contracts";
import type { ChannelAccountRow, ChannelPostRow } from "@/modules/distribution/repository";

/**
 * canonical: cms-ai-pipeline.md §7.7 (X refresh 戦略: lock 待ちのプロセスは更新後のトークンを再読して続行)。
 * 2026-09-06 監査修正 #7:
 * - refresh リースが取れなかった側は固定 1.5 秒待ちではなく、リース解放 (または Vault 更新) を
 *   ポーリングして待つ。上限を超えたら post を scheduled に戻して次回起動に回す (何も投稿していない)。
 * - 401 → expired 化は、Vault の現在値で再試行して再度 401 のときだけ (並行 refresh 直後の
 *   旧トークン使用を失効と誤判定しない)。
 * 実 X API は叩かず fetch を全面モック、待ち時間は fake timers で進める。
 */

const { serviceClientBox, credentialsBox } = vi.hoisted(() => {
  const OPS_LIMITS = {
    x_monthly_post_limit: 1000,
    ai_monthly_budget_micro_usd: 50_000_000,
    ai_monthly_image_limit: 200,
    ai_default_image_model: null,
  };
  return {
    OPS_LIMITS,
    // resolveIntegrationCredentials("x") の応答 (DB 優先 / env フォールバックはテストごとに差し替える)
    credentialsBox: {
      current: {
        provider: "x",
        publicId: "client-id" as string | null,
        secret: "client-secret" as string | null,
        source: "env" as "db" | "env" | "none",
      },
      calls: [] as { provider: string; hasClient: boolean }[],
    },
    serviceClientBox: {
      serviceClient: {
        from: (table: string) => {
          if (table !== "site_settings") throw new Error(`fake service client: 未対応 (${table})`);
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: OPS_LIMITS }, error: null }) }) }) };
        },
      },
    },
  };
});

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ NEXT_PUBLIC_SITE_URL: "https://example.com" }),
}));
// X の OAuth クライアント認証情報は env 直読みではなく integration-credentials (DB → env) 経由で解決する
vi.mock("@/lib/integration-credentials", () => ({
  resolveIntegrationCredentials: async (provider: string, options?: { client?: unknown }) => {
    credentialsBox.calls.push({ provider, hasClient: options?.client !== undefined });
    return { ...credentialsBox.current, provider };
  },
  isIntegrationConfigured: async () => true,
}));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => serviceClientBox.serviceClient as unknown,
}));
vi.mock("@/modules/content/facade", () => ({ contentFacade: { createBlogPostFromDraft: vi.fn() } }));
vi.mock("@/modules/media/facade", () => ({ mediaFacade: { getJpegRenditionUrl: vi.fn() } }));

const getApprovedDraft = vi.fn();
vi.mock("@/modules/distribution/internal/ai-studio-bridge", () => ({
  resolveAiStudioFacade: async () => ({ getApprovedDraft: (...args: unknown[]) => getApprovedDraft(...args) }),
  tryResolveAiStudioWatchdogSweep: async () => null,
}));

const claimDueScheduledPosts = vi.fn();
const getChannelAccount = vi.fn();
const vaultReadSecret = vi.fn();
const vaultUpsertSecret = vi.fn();
const claimTokenRefreshLease = vi.fn();
const releaseTokenRefreshLease = vi.fn();
const updateXThreadProgress = vi.fn();
const markPublished = vi.fn();
const markFailed = vi.fn();
const markManualRequired = vi.fn();
const markChannelAccountExpired = vi.fn();
const flagScheduledPostsForExpiredChannel = vi.fn();
const revertPublishingToScheduled = vi.fn();
const getMonthlyXCostCentsSum = vi.fn();

vi.mock("@/modules/distribution/repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/distribution/repository")>();
  return {
    ...actual,
    claimDueScheduledPosts: (...args: unknown[]) => claimDueScheduledPosts(...args),
    getChannelAccount: (...args: unknown[]) => getChannelAccount(...args),
    vaultReadSecret: (...args: unknown[]) => vaultReadSecret(...args),
    vaultUpsertSecret: (...args: unknown[]) => vaultUpsertSecret(...args),
    claimTokenRefreshLease: (...args: unknown[]) => claimTokenRefreshLease(...args),
    releaseTokenRefreshLease: (...args: unknown[]) => releaseTokenRefreshLease(...args),
    updateXThreadProgress: (...args: unknown[]) => updateXThreadProgress(...args),
    markPublished: (...args: unknown[]) => markPublished(...args),
    markFailed: (...args: unknown[]) => markFailed(...args),
    markManualRequired: (...args: unknown[]) => markManualRequired(...args),
    markChannelAccountExpired: (...args: unknown[]) => markChannelAccountExpired(...args),
    flagScheduledPostsForExpiredChannel: (...args: unknown[]) => flagScheduledPostsForExpiredChannel(...args),
    revertPublishingToScheduled: (...args: unknown[]) => revertPublishingToScheduled(...args),
    getMonthlyXCostCentsSum: (...args: unknown[]) => getMonthlyXCostCentsSum(...args),
  };
});

import {
  runPublishWorkerBatch,
  X_REFRESH_WAIT_MAX_ATTEMPTS,
  X_REFRESH_WAIT_POLL_MS,
} from "@/modules/distribution/internal/worker";

function account(leaseUntil: string | null = null): ChannelAccountRow {
  return {
    channel: "x",
    account_label: "@tester",
    auth_status: "connected",
    vault_secret_name: "sns_x_oauth",
    meta: { user_id: "u1", username: "tester", token_expires_at: new Date(Date.now() + 3_600_000).toISOString() },
    connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    token_refresh_lease_expires_at: leaseUntil,
  };
}

function post(): ChannelPostRow {
  return {
    id: "post-1",
    draft_id: "draft-1",
    channel: "x",
    status: "publishing",
    scheduled_at: new Date().toISOString(),
    published_at: null,
    external_id: null,
    external_url: null,
    tweet_count: 1,
    url_count: 0,
    estimated_cost_cents: 2,
    attempt_count: 1,
    last_error_code: null,
    last_error_detail: null,
    note_draft_status: "none",
    note_draft_url: null,
    idempotency_key: "idem-1",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

const DRAFT: ApprovedDraft = {
  draft_id: "draft-1",
  run_id: "run-1",
  channel: "x",
  content: { thread: [{ text: "hello", media_id: null }] } as unknown as ApprovedDraft["content"],
  approved_at: new Date().toISOString(),
};

function secret(accessToken: string, expiresInMs: number): string {
  return JSON.stringify({
    access_token: accessToken,
    refresh_token: `refresh-${accessToken}`,
    expires_at: new Date(Date.now() + expiresInMs).toISOString(),
  });
}

/** Vault の状態を可変にするための箱 */
let vault: { current: string };
let fetchMock: ReturnType<typeof vi.fn>;
let tweetAuthHeaders: string[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  tweetAuthHeaders = [];
  credentialsBox.current = { provider: "x", publicId: "client-id", secret: "client-secret", source: "env" };
  credentialsBox.calls = [];
  fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/2/tweets")) {
      tweetAuthHeaders.push(String((init?.headers as Record<string, string>).Authorization));
      return new Response(JSON.stringify({ data: { id: `tweet-${tweetAuthHeaders.length}` } }), { status: 200 });
    }
    if (url.endsWith("/2/oauth2/token")) {
      return new Response(
        JSON.stringify({ access_token: "refreshed-token", refresh_token: "refreshed-refresh", expires_in: 7200 }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected url: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);

  vault = { current: secret("stale-token", 60_000) }; // 期限 1 分前 = refresh 対象 (margin 10 分)
  vaultReadSecret.mockImplementation(async () => ({ ok: true, value: vault.current }));
  vaultUpsertSecret.mockImplementation(async (_c: unknown, _n: string, v: string) => {
    vault.current = v;
    return { ok: true, value: undefined };
  });
  claimDueScheduledPosts.mockResolvedValue({ ok: true, value: [post()] });
  getApprovedDraft.mockResolvedValue({ ok: true, value: DRAFT });
  getChannelAccount.mockResolvedValue({ ok: true, value: account() });
  getMonthlyXCostCentsSum.mockResolvedValue({ ok: true, value: 0 });
  // 既定は「リースを取れない」。vi.clearAllMocks は実装を消さないため、テストごとに明示的に上書きする
  claimTokenRefreshLease.mockResolvedValue({ ok: true, value: false });
  releaseTokenRefreshLease.mockResolvedValue({ ok: true, value: undefined });
  updateXThreadProgress.mockResolvedValue({ ok: true, value: undefined });
  markPublished.mockResolvedValue({ ok: true, value: undefined });
  markFailed.mockResolvedValue({ ok: true, value: undefined });
  markManualRequired.mockResolvedValue({ ok: true, value: undefined });
  markChannelAccountExpired.mockResolvedValue({ ok: true, value: undefined });
  flagScheduledPostsForExpiredChannel.mockResolvedValue({ ok: true, value: undefined });
  revertPublishingToScheduled.mockResolvedValue({ ok: true, value: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function runWithTimers(totalMs: number): Promise<void> {
  const run = runPublishWorkerBatch();
  await vi.advanceTimersByTimeAsync(totalMs);
  await run;
}

describe("getValidXAccessToken: refresh リースの競合 (#7)", () => {
  it("リースを取れた側は refresh して Vault を上書きし、新トークンで投稿する (非退行)", async () => {
    claimTokenRefreshLease.mockResolvedValue({ ok: true, value: true });

    await runWithTimers(0);

    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/2/oauth2/token"))).toBe(true);
    expect(vaultUpsertSecret).toHaveBeenCalledTimes(1);
    expect(releaseTokenRefreshLease).toHaveBeenCalledTimes(1);
    expect(tweetAuthHeaders).toEqual(["Bearer refreshed-token"]);
    expect(markPublished).toHaveBeenCalledTimes(1);
  });

  it("リースを取れなかった側は解放をポーリングして待ち、他プロセスが更新した Vault の新トークンで投稿する (自分では refresh しない)", async () => {
    // claim は失敗し続ける (他プロセス保持中)。2.5 秒後に他プロセスが Vault を更新してリースを解放する。
    const leaseUntil = new Date(Date.now() + 30_000).toISOString();
    getChannelAccount.mockResolvedValue({ ok: true, value: account(leaseUntil) });
    setTimeout(() => {
      vault.current = secret("other-process-token", 7_200_000);
      getChannelAccount.mockResolvedValue({ ok: true, value: account(null) });
    }, 2_500);

    await runWithTimers(10_000);

    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/2/oauth2/token"))).toBe(false);
    expect(vaultUpsertSecret).not.toHaveBeenCalled();
    expect(tweetAuthHeaders).toEqual(["Bearer other-process-token"]);
    expect(markPublished).toHaveBeenCalledTimes(1);
    expect(revertPublishingToScheduled).not.toHaveBeenCalled();
    // 固定 1.5 秒待ちではなく、リース保持中は継続してポーリングしている (1s 間隔で 3 回目の周回で解放を検知)
    expect(claimTokenRefreshLease.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("リースが上限時間内に解放されなければ、投稿せず post を scheduled に戻して次回に回す (manual_required にしない)", async () => {
    claimTokenRefreshLease.mockResolvedValue({ ok: true, value: false });
    getChannelAccount.mockResolvedValue({ ok: true, value: account(new Date(Date.now() + 600_000).toISOString()) });

    await runWithTimers(X_REFRESH_WAIT_POLL_MS * (X_REFRESH_WAIT_MAX_ATTEMPTS + 2));

    expect(claimTokenRefreshLease).toHaveBeenCalledTimes(X_REFRESH_WAIT_MAX_ATTEMPTS);
    expect(tweetAuthHeaders).toEqual([]);
    expect(revertPublishingToScheduled).toHaveBeenCalledTimes(1);
    expect(revertPublishingToScheduled.mock.calls[0][1]).toBe("post-1");
    expect(revertPublishingToScheduled.mock.calls[0][2]).toMatchObject({ code: "KMB-E503" });
    expect(markManualRequired).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
    expect(markPublished).not.toHaveBeenCalled();
  });

  it("待っている間に他プロセスが refresh 済みなら、リースを取れても二重 refresh せず Vault の新値を使う", async () => {
    claimTokenRefreshLease.mockResolvedValueOnce({ ok: true, value: false }).mockResolvedValue({ ok: true, value: true });
    getChannelAccount.mockResolvedValue({ ok: true, value: account(new Date(Date.now() + 30_000).toISOString()) });
    // リースは保持されたまま Vault だけ先に更新されるケース (release 直前)
    setTimeout(() => {
      vault.current = secret("fresh-from-other", 7_200_000);
    }, 500);

    await runWithTimers(5_000);

    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/2/oauth2/token"))).toBe(false);
    expect(tweetAuthHeaders).toEqual(["Bearer fresh-from-other"]);
    expect(markPublished).toHaveBeenCalledTimes(1);
  });
});

describe("getValidXAccessToken: OAuth クライアント認証情報の解決 (設定 > 外部連携)", () => {
  it("DB に保存された認証情報が env より優先され、その client_id / secret で refresh する (service client を渡す)", async () => {
    // process.env に古い値が残っていても、resolve が返す DB 由来の値だけを使う
    vi.stubEnv("X_CLIENT_ID", "env-client-id");
    vi.stubEnv("X_CLIENT_SECRET", "env-client-secret");
    credentialsBox.current = { provider: "x", publicId: "db-client-id", secret: "db-client-secret", source: "db" };
    claimTokenRefreshLease.mockResolvedValue({ ok: true, value: true });

    await runWithTimers(0);

    const tokenCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/2/oauth2/token"));
    expect(tokenCall).toBeDefined();
    const init = tokenCall?.[1] as RequestInit;
    expect(new URLSearchParams(String(init.body)).get("client_id")).toBe("db-client-id");
    const authHeader = String((init.headers as Record<string, string>).Authorization);
    expect(Buffer.from(authHeader.replace(/^Basic /, ""), "base64").toString()).toBe("db-client-id:db-client-secret");
    // cron 経由 (セッション無し) のため service client を明示して解決している
    expect(credentialsBox.calls).toEqual([{ provider: "x", hasClient: true }]);
    expect(tweetAuthHeaders).toEqual(["Bearer refreshed-token"]);
    expect(markPublished).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });

  it("認証情報が未設定 (DB にも env にも無い) なら refresh せず現行トークンで投稿を試みる", async () => {
    credentialsBox.current = { provider: "x", publicId: null, secret: null, source: "none" };
    claimTokenRefreshLease.mockResolvedValue({ ok: true, value: true });

    await runWithTimers(0);

    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith("/2/oauth2/token"))).toBe(false);
    expect(claimTokenRefreshLease).not.toHaveBeenCalled();
    expect(tweetAuthHeaders).toEqual(["Bearer stale-token"]);
  });
});

describe("401 → expired 化は Vault の現在値で再試行して再度 401 のときだけ (#7)", () => {
  beforeEach(() => {
    // トークンは新鮮 (refresh 対象外) にして 401 分岐だけを検証する
    vault.current = secret("token-A", 3_600_000);
  });

  it("401 の直後に Vault が別トークンに更新されていれば、その値で 1 回再試行して published (expired 化しない)", async () => {
    let tweetCalls = 0;
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.endsWith("/2/tweets")) throw new Error(`unexpected url: ${url}`);
      tweetCalls += 1;
      const auth = String((init?.headers as Record<string, string>).Authorization);
      tweetAuthHeaders.push(auth);
      if (auth === "Bearer token-A") {
        // 並行プロセスが直前に refresh 済み → Vault は token-B になっている
        vault.current = secret("token-B", 3_600_000);
        return new Response("unauthorized", { status: 401 });
      }
      return new Response(JSON.stringify({ data: { id: `tweet-${tweetCalls}` } }), { status: 200 });
    });

    await runWithTimers(0);

    expect(tweetAuthHeaders).toEqual(["Bearer token-A", "Bearer token-B"]);
    expect(markChannelAccountExpired).not.toHaveBeenCalled();
    expect(flagScheduledPostsForExpiredChannel).not.toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
    expect(markPublished).toHaveBeenCalledTimes(1);
  });

  it("401 の直後も Vault が同じトークンなら本当に失効 → expired 化 + scheduled フラグ + failed(KMB-E503)", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.endsWith("/2/tweets")) throw new Error(`unexpected url: ${url}`);
      tweetAuthHeaders.push(String((init?.headers as Record<string, string>).Authorization));
      return new Response("unauthorized", { status: 401 });
    });

    await runWithTimers(0);

    // Vault は token-A のまま → 再試行しない (再試行しても同じ値のため)
    expect(tweetAuthHeaders).toEqual(["Bearer token-A"]);
    expect(markChannelAccountExpired).toHaveBeenCalledWith(expect.anything(), "x");
    expect(flagScheduledPostsForExpiredChannel).toHaveBeenCalledWith(expect.anything(), "x");
    expect(markFailed).toHaveBeenCalledTimes(1);
    expect(markFailed.mock.calls[0][2]).toMatchObject({ code: "KMB-E503" });
  });

  it("Vault の新値で再試行しても再度 401 なら expired 化 (再試行は 1 回だけ)", async () => {
    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.endsWith("/2/tweets")) throw new Error(`unexpected url: ${url}`);
      tweetAuthHeaders.push(String((init?.headers as Record<string, string>).Authorization));
      vault.current = secret(`token-${tweetAuthHeaders.length + 1}`, 3_600_000); // 毎回別の値に見せる
      return new Response("unauthorized", { status: 401 });
    });

    await runWithTimers(0);

    expect(tweetAuthHeaders).toHaveLength(2);
    expect(markChannelAccountExpired).toHaveBeenCalledTimes(1);
    expect(markFailed.mock.calls[0][2]).toMatchObject({ code: "KMB-E503" });
  });
});
