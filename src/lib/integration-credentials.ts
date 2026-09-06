import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { isOAuthEnabled } from "@/lib/env";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { Result } from "@/modules/platform/contracts";

/**
 * 外部サービスの認証情報 (OAuth クライアント / API キー) の解決レイヤ。
 *
 * 従来は Vercel の環境変数 (GOOGLE_CALENDAR_CLIENT_ID 等) でしか設定できず、納品先の管理者が
 * 自分で接続を有効化できなかった。integration_credentials テーブル (migration 20260906000070) +
 * Vault に保存された値を最優先で使い、無ければ環境変数にフォールバックする。
 *
 * 呼び出し側は同期の isXxxConfigured() (env.ts) ではなく、本ファイルの非同期 API を使うこと:
 *   - resolveIntegrationCredentials(provider): 実際に使う publicId / secret
 *   - isIntegrationConfigured(provider): 接続 UI の有効化判定
 *   - listIntegrationStatuses(): 管理画面の一覧表示 (secret は末尾 4 桁のみ)
 *
 * 秘密情報の扱い: secret は Vault からの読み出し値をプロセス内で短時間 (30 秒) だけキャッシュする。
 * Twilio の webhook (15 秒制約) で毎回 Vault RPC を往復しないための措置で、保存/削除時は即座に
 * 無効化する。ログや戻り値に secret を含めるのは resolveIntegrationCredentials のみ。
 */

export const INTEGRATION_PROVIDERS = ["google_calendar", "ms_calendar", "x", "meta", "twilio", "resend"] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export function isIntegrationProvider(value: string): value is IntegrationProvider {
  return (INTEGRATION_PROVIDERS as readonly string[]).includes(value);
}

interface ProviderSpec {
  /** 非機微な識別子 (client_id / app_id / account_sid) の env 名。resend のように無いものは null */
  publicIdEnv: string | null;
  secretEnv: string;
  /** secret が必須か (X の OAuth 2.0 PKCE はパブリッククライアント運用なら secret 任意) */
  secretRequired: boolean;
  /** OAuth 接続機能のスイッチ (OAUTH_STATE_SECRET / Preview 環境) に従うか */
  requiresOAuth: boolean;
}

const PROVIDER_SPECS: Record<IntegrationProvider, ProviderSpec> = {
  google_calendar: {
    publicIdEnv: "GOOGLE_CALENDAR_CLIENT_ID",
    secretEnv: "GOOGLE_CALENDAR_CLIENT_SECRET",
    secretRequired: true,
    requiresOAuth: true,
  },
  ms_calendar: {
    publicIdEnv: "MS_CALENDAR_CLIENT_ID",
    secretEnv: "MS_CALENDAR_CLIENT_SECRET",
    secretRequired: true,
    requiresOAuth: true,
  },
  x: { publicIdEnv: "X_CLIENT_ID", secretEnv: "X_CLIENT_SECRET", secretRequired: false, requiresOAuth: true },
  meta: { publicIdEnv: "META_APP_ID", secretEnv: "META_APP_SECRET", secretRequired: true, requiresOAuth: true },
  twilio: {
    publicIdEnv: "TWILIO_ACCOUNT_SID",
    secretEnv: "TWILIO_AUTH_TOKEN",
    secretRequired: true,
    requiresOAuth: false,
  },
  resend: { publicIdEnv: null, secretEnv: "RESEND_API_KEY", secretRequired: true, requiresOAuth: false },
};

export function getIntegrationProviderSpec(provider: IntegrationProvider): {
  publicIdEnv: string | null;
  secretEnv: string;
  secretRequired: boolean;
  requiresOAuth: boolean;
} {
  return PROVIDER_SPECS[provider];
}

export type CredentialSource = "db" | "env" | "none";

export interface ResolvedIntegrationCredentials {
  provider: IntegrationProvider;
  publicId: string | null;
  secret: string | null;
  source: CredentialSource;
}

export interface IntegrationStatus {
  provider: IntegrationProvider;
  /** 接続 UI を有効化してよいか (必須項目が揃い、OAuth 系はスイッチも有効) */
  configured: boolean;
  source: CredentialSource;
  /** DB 保存時のみ非 null (env 由来の値は管理画面に露出しない) */
  publicId: string | null;
  secretSet: boolean;
  secretLast4: string | null;
  updatedAt: string | null;
}

const CACHE_TTL_MS = 30_000;
const cache = new Map<IntegrationProvider, { value: ResolvedIntegrationCredentials; expiresAt: number }>();

/** 保存/削除時、およびテストから呼ぶ。provider 省略で全件無効化 */
export function invalidateIntegrationCredentialsCache(provider?: IntegrationProvider): void {
  if (provider) cache.delete(provider);
  else cache.clear();
}

function vaultNameFor(provider: IntegrationProvider): string {
  return `integration_${provider}_secret`;
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function fromEnv(provider: IntegrationProvider): ResolvedIntegrationCredentials {
  const spec = PROVIDER_SPECS[provider];
  const publicId = spec.publicIdEnv ? emptyToNull(process.env[spec.publicIdEnv]) : null;
  const secret = emptyToNull(process.env[spec.secretEnv]);
  const hasAny = publicId !== null || secret !== null;
  return { provider, publicId, secret, source: hasAny ? "env" : "none" };
}

interface CredentialRow {
  provider: string;
  public_id: string | null;
  secret_vault_name: string | null;
  secret_last4: string | null;
  updated_at: string;
}

async function readRow(client: SupabaseClient, provider: IntegrationProvider): Promise<CredentialRow | null> {
  const { data, error } = await client
    .from("integration_credentials")
    .select("provider, public_id, secret_vault_name, secret_last4, updated_at")
    .eq("provider", provider)
    .maybeSingle();
  if (error) throw new Error(`integration_credentials の読み取りに失敗しました: ${error.message}`);
  return (data as CredentialRow | null) ?? null;
}

async function vaultRead(client: SupabaseClient, name: string): Promise<string | null> {
  const { data, error } = await client.rpc("vault_read_secret", { p_name: name });
  if (error) throw new Error(`Vault の読み取りに失敗しました (${name}): ${error.message}`);
  return emptyToNull(data as string | null);
}

/**
 * 実際に使う認証情報を返す。DB (Vault) を優先し、無ければ env にフォールバックする。
 * 失敗時 (DB 断・service role 未設定) は env にフォールバックし、例外は投げない。
 */
export async function resolveIntegrationCredentials(
  provider: IntegrationProvider,
  options?: { client?: SupabaseClient; bypassCache?: boolean },
): Promise<ResolvedIntegrationCredentials> {
  const now = Date.now();
  if (!options?.bypassCache) {
    const hit = cache.get(provider);
    if (hit && hit.expiresAt > now) return hit.value;
  }

  let resolved: ResolvedIntegrationCredentials;
  try {
    const client = options?.client ?? createSupabaseServiceClient();
    const row = await readRow(client, provider);
    if (row && (row.public_id !== null || row.secret_vault_name !== null)) {
      const secret = row.secret_vault_name ? await vaultRead(client, row.secret_vault_name) : null;
      resolved = { provider, publicId: emptyToNull(row.public_id), secret, source: "db" };
    } else {
      resolved = fromEnv(provider);
    }
  } catch (err) {
    console.warn(
      `[KMB-E901] integration_credentials (${provider}) の解決に失敗したため env にフォールバックします:`,
      err instanceof Error ? err.message : String(err),
    );
    resolved = fromEnv(provider);
  }

  cache.set(provider, { value: resolved, expiresAt: now + CACHE_TTL_MS });
  return resolved;
}

/** 必須項目が揃っているか (OAuth スイッチは見ない — 純粋な値の充足判定) */
export function hasRequiredCredentials(
  provider: IntegrationProvider,
  creds: Pick<ResolvedIntegrationCredentials, "publicId" | "secret">,
): boolean {
  const spec = PROVIDER_SPECS[provider];
  if (spec.publicIdEnv !== null && !creds.publicId) return false;
  if (spec.secretRequired && !creds.secret) return false;
  if (spec.publicIdEnv === null && !creds.secret) return false;
  return true;
}

/** 接続 UI / OAuth ルート / worker が「この連携は使える」と判断するための単一の判定 */
export async function isIntegrationConfigured(
  provider: IntegrationProvider,
  options?: { client?: SupabaseClient },
): Promise<boolean> {
  const spec = PROVIDER_SPECS[provider];
  if (spec.requiresOAuth && !isOAuthEnabled()) return false;
  const creds = await resolveIntegrationCredentials(provider, options);
  return hasRequiredCredentials(provider, creds);
}

/** 管理画面向けの状態 (secret は返さない)。DB 行が無い場合は env 由来かどうかだけを伝える */
export async function getIntegrationStatus(
  provider: IntegrationProvider,
  options?: { client?: SupabaseClient },
): Promise<IntegrationStatus> {
  const spec = PROVIDER_SPECS[provider];
  const oauthOk = spec.requiresOAuth ? isOAuthEnabled() : true;
  try {
    const client = options?.client ?? createSupabaseServiceClient();
    const row = await readRow(client, provider);
    if (row && (row.public_id !== null || row.secret_vault_name !== null)) {
      const complete = hasRequiredCredentials(provider, {
        publicId: emptyToNull(row.public_id),
        secret: row.secret_vault_name ? "set" : null,
      });
      return {
        provider,
        configured: oauthOk && complete,
        source: "db",
        publicId: emptyToNull(row.public_id),
        secretSet: row.secret_vault_name !== null,
        secretLast4: row.secret_last4,
        updatedAt: row.updated_at,
      };
    }
  } catch (err) {
    console.warn(
      `[KMB-E901] integration_credentials (${provider}) の状態取得に失敗しました:`,
      err instanceof Error ? err.message : String(err),
    );
  }
  const env = fromEnv(provider);
  return {
    provider,
    configured: oauthOk && hasRequiredCredentials(provider, env),
    source: env.source,
    publicId: null,
    secretSet: env.secret !== null,
    secretLast4: null,
    updatedAt: null,
  };
}

export async function listIntegrationStatuses(options?: { client?: SupabaseClient }): Promise<IntegrationStatus[]> {
  return Promise.all(INTEGRATION_PROVIDERS.map((p) => getIntegrationStatus(p, options)));
}

export interface SaveIntegrationCredentialsInput {
  /** null / 空文字は「未設定」。resend では無視される */
  publicId: string | null;
  /** null / 空文字は「既存の secret を維持」(未保存なら未設定のまま) */
  secret: string | null;
}

/**
 * 管理画面からの保存。secret は Vault へ、公開識別子と末尾 4 桁はテーブルへ。
 * 呼び出し側 (Server Action) が requireAdmin を済ませていること。
 */
export async function saveIntegrationCredentials(
  provider: IntegrationProvider,
  input: SaveIntegrationCredentialsInput,
  updatedBy: string | null,
  options?: { client?: SupabaseClient },
): Promise<Result<void>> {
  const spec = PROVIDER_SPECS[provider];
  const publicId = spec.publicIdEnv === null ? null : emptyToNull(input.publicId);
  const secret = emptyToNull(input.secret);
  try {
    const client = options?.client ?? createSupabaseServiceClient();
    const existing = await readRow(client, provider);

    if (spec.publicIdEnv !== null && publicId === null) {
      return { ok: false, code: "KMB-E101", detail: "識別子 (クライアント ID など) は必須です" };
    }
    if (secret === null && !existing?.secret_vault_name && spec.secretRequired) {
      return { ok: false, code: "KMB-E101", detail: "シークレットは必須です" };
    }

    let vaultName = existing?.secret_vault_name ?? null;
    let last4 = existing?.secret_last4 ?? null;
    if (secret !== null) {
      vaultName = vaultNameFor(provider);
      const { error } = await client.rpc("vault_upsert_secret", { p_name: vaultName, p_secret: secret });
      if (error) return { ok: false, code: "KMB-E901", detail: `Vault への保存に失敗しました: ${error.message}` };
      last4 = secret.slice(-4);
    }

    const { error } = await client.from("integration_credentials").upsert(
      {
        provider,
        public_id: publicId,
        secret_vault_name: vaultName,
        secret_last4: last4,
        updated_by: updatedBy,
      },
      { onConflict: "provider" },
    );
    if (error) return { ok: false, code: "KMB-E901", detail: error.message };

    invalidateIntegrationCredentialsCache(provider);
    return { ok: true, value: undefined };
  } catch (err) {
    return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
  }
}

/** 管理画面からの削除。Vault の secret も消し、以後は env フォールバックに戻る */
export async function deleteIntegrationCredentials(
  provider: IntegrationProvider,
  options?: { client?: SupabaseClient },
): Promise<Result<void>> {
  try {
    const client = options?.client ?? createSupabaseServiceClient();
    const existing = await readRow(client, provider);
    if (existing?.secret_vault_name) {
      const { error } = await client.rpc("vault_delete_secret", { p_name: existing.secret_vault_name });
      if (error) return { ok: false, code: "KMB-E901", detail: `Vault の削除に失敗しました: ${error.message}` };
    }
    const { error } = await client.from("integration_credentials").delete().eq("provider", provider);
    if (error) return { ok: false, code: "KMB-E901", detail: error.message };
    invalidateIntegrationCredentialsCache(provider);
    return { ok: true, value: undefined };
  } catch (err) {
    return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
  }
}
