// scheduling/internal/token.ts
// canonical: docs/design/crm-suite/03-scheduling.md §8.3 (トークン管理)。
// X の getValidXAccessToken (distribution/internal/worker.ts:95-142) の移植。
//
// provider 非依存のオーケストレーションのみ (provider 固有の refresh 実装は
// CalendarProviderAdapter.refreshTokens 側に吸収される — #55 (Microsoft) が provider 引数の
// 分岐を追加するだけで済む形)。
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CalendarProvider } from "../contracts";
import * as repo from "../repository";
import { TOKEN_REFRESH_LEASE_TTL_MS, TOKEN_REFRESH_LEASE_WAIT_MS } from "./lease";
import type { CalendarProviderAdapter, ProviderEnv } from "./provider";
import { OAuthTokenError } from "./provider";
import { CALENDAR_VAULT_SECRET_NAMES, zCalendarVaultSecret, type CalendarVaultSecret } from "./vault-names";

const REFRESH_MARGIN_MS = 5 * 60 * 1000; // 5 分 (§8.3 手順 1)

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 未接続 (Vault に secret が無い) / 再連携が必要 (invalid_grant 系) を表す。呼び出し側は
 *  connection.status='expired' への更新が既に完了していることを前提にできる。 */
export class TokenExpiredError extends Error {
  constructor(public readonly provider: CalendarProvider) {
    super(`カレンダー接続 (${provider}) の再連携が必要です`);
    this.name = "TokenExpiredError";
  }
}

/** invalid_client (クライアントシークレット失効。§8.3 手順 6 — E720 と区別する)。 */
export class TokenClientMisconfiguredError extends Error {
  constructor(public readonly provider: CalendarProvider) {
    super(`カレンダー接続 (${provider}) のクライアントシークレット更新 (env) が必要です`);
    this.name = "TokenClientMisconfiguredError";
  }
}

async function readSecret(serviceClient: SupabaseClient, secretName: string): Promise<CalendarVaultSecret | null> {
  const result = await repo.vaultReadSecret(serviceClient, secretName);
  if (!result.ok) {
    // エラー握り潰し禁止: Vault RPC 自体の失敗 (インフラ異常) は「未接続」と区別して
    // 例外を投げる (未接続なら TokenExpiredError、インフラ異常なら生 Error)。
    throw new Error(`Vault の読み取りに失敗しました (${secretName}): ${result.code} ${result.detail ?? ""}`);
  }
  if (!result.value) return null; // Vault に secret が無い = 未接続/切断済み
  const parsed = zCalendarVaultSecret.safeParse(JSON.parse(result.value));
  if (!parsed.success) {
    throw new Error(`Vault secret (${secretName}) が契約 (zCalendarVaultSecret) と一致しません`);
  }
  return parsed.data;
}

async function storeSecret(serviceClient: SupabaseClient, secretName: string, secret: CalendarVaultSecret): Promise<void> {
  const result = await repo.vaultUpsertSecret(serviceClient, secretName, JSON.stringify(secret));
  if (!result.ok) {
    throw new Error(`Vault への書き込みに失敗しました (${secretName}): ${result.code} ${result.detail ?? ""}`);
  }
}

/**
 * refresh を実行し、Vault へ上書き保存する。invalid_grant/invalid_client の分類・
 * calendar_connections.status 更新は呼び出し元 (getValidCalendarSecret /
 * forceRefreshCalendarSecret) が担当する (この関数はリース保持中であることを前提に
 * 呼ばれる — リースの取得/解放はしない)。
 */
async function doRefresh(
  serviceClient: SupabaseClient,
  provider: CalendarProvider,
  adapter: CalendarProviderAdapter,
  env: ProviderEnv,
  currentSecret: CalendarVaultSecret,
): Promise<CalendarVaultSecret> {
  const secretName = CALENDAR_VAULT_SECRET_NAMES[provider];
  try {
    const refreshed = await adapter.refreshTokens(currentSecret, env);
    await storeSecret(serviceClient, secretName, refreshed);
    return refreshed;
  } catch (err) {
    if (err instanceof OAuthTokenError) {
      if (err.oauthError === "invalid_client") {
        const updateResult = await repo.updateCalendarConnectionStatus(
          serviceClient,
          provider,
          "error",
          "KMB-E723",
          "クライアントシークレットの更新 (env) が必要です",
        );
        if (!updateResult.ok) {
          console.error(
            `[scheduling] token.ts: connection status (error/E723) の更新に失敗しました (provider=${provider}): ${updateResult.code} ${updateResult.detail ?? ""}`,
          );
        }
        throw new TokenClientMisconfiguredError(provider);
      }
      if (err.status >= 400 && err.status < 500) {
        // invalid_grant を含む 400 系 OAuth エラー全般を安全側 (再連携要求) に倒す
        // (§8.3 手順 5)。自動リトライしないことが最重要 — 誤って expired にしても
        // admin が再連携すれば復旧するため、判定を誤って自動リトライし続けるより安全。
        const updateResult = await repo.updateCalendarConnectionStatus(
          serviceClient,
          provider,
          "expired",
          "KMB-E720",
          err.message.slice(0, 500),
        );
        if (!updateResult.ok) {
          console.error(
            `[scheduling] token.ts: connection status (expired/E720) の更新に失敗しました (provider=${provider}): ${updateResult.code} ${updateResult.detail ?? ""}`,
          );
        }
        throw new TokenExpiredError(provider);
      }
    }
    // それ以外 (ネットワーク断・5xx 等の一時的失敗) は connection の状態を変更せず、
    // そのまま例外を再送出する (恒久失効と誤判定して admin に不要な再連携を要求しない)。
    throw err;
  }
}

/**
 * 有効な access token を含む secret を返す (§8.3)。
 * 1. Vault 読み → expires_at まで 5 分超あれば現行 secret を返す
 * 2. 期限接近 → CAS リース。取れなければ 1.5 秒 sleep → Vault 再読
 * 3. リースが取れたら refresh を実行 → Vault 全体上書き
 * 4. finally でリース解放
 */
export async function getValidCalendarSecret(
  serviceClient: SupabaseClient,
  provider: CalendarProvider,
  adapter: CalendarProviderAdapter,
  env: ProviderEnv,
): Promise<CalendarVaultSecret> {
  const secretName = CALENDAR_VAULT_SECRET_NAMES[provider];
  const secret = await readSecret(serviceClient, secretName);
  if (!secret) throw new TokenExpiredError(provider);

  const msUntilExpiry = new Date(secret.expires_at).getTime() - Date.now();
  if (msUntilExpiry > REFRESH_MARGIN_MS) return secret;

  const leaseResult = await repo.claimCalendarTokenRefreshLease(serviceClient, provider, TOKEN_REFRESH_LEASE_TTL_MS);
  if (!leaseResult.ok || !leaseResult.value) {
    // 他プロセスが refresh 中 (または lease RPC 自体が一時的に失敗) — 少し待って Vault を
    // 再読みする (distribution/internal/worker.ts の getValidXAccessToken と同型のパターン。
    // Vault 読み取り自体がインフラ異常なら readSecret が例外を投げるため握り潰しにはならない)。
    await sleep(TOKEN_REFRESH_LEASE_WAIT_MS);
    const retried = await readSecret(serviceClient, secretName);
    return retried ?? secret;
  }

  try {
    return await doRefresh(serviceClient, provider, adapter, env, secret);
  } finally {
    const releaseResult = await repo.releaseCalendarTokenRefreshLease(serviceClient, provider);
    if (!releaseResult.ok) {
      console.error(
        `[scheduling] getValidCalendarSecret: token refresh lease の解放に失敗しました (provider=${provider}): ${releaseResult.code} ${releaseResult.detail ?? ""}`,
      );
    }
  }
}

/**
 * margin チェックを無視して強制的に refresh する (push/pull が 401 を受け取った際の
 * 「refresh 1 回 → 再試行」専用 — §8.4/§8.5)。リースの取得/解放は getValidCalendarSecret と
 * 同じ流儀。
 */
export async function forceRefreshCalendarSecret(
  serviceClient: SupabaseClient,
  provider: CalendarProvider,
  adapter: CalendarProviderAdapter,
  env: ProviderEnv,
): Promise<CalendarVaultSecret> {
  const secretName = CALENDAR_VAULT_SECRET_NAMES[provider];
  const secret = await readSecret(serviceClient, secretName);
  if (!secret) throw new TokenExpiredError(provider);

  const leaseResult = await repo.claimCalendarTokenRefreshLease(serviceClient, provider, TOKEN_REFRESH_LEASE_TTL_MS);
  if (!leaseResult.ok || !leaseResult.value) {
    await sleep(TOKEN_REFRESH_LEASE_WAIT_MS);
    const retried = await readSecret(serviceClient, secretName);
    return retried ?? secret;
  }

  try {
    return await doRefresh(serviceClient, provider, adapter, env, secret);
  } finally {
    const releaseResult = await repo.releaseCalendarTokenRefreshLease(serviceClient, provider);
    if (!releaseResult.ok) {
      console.error(
        `[scheduling] forceRefreshCalendarSecret: token refresh lease の解放に失敗しました (provider=${provider}): ${releaseResult.code} ${releaseResult.detail ?? ""}`,
      );
    }
  }
}
