import "server-only";

// twitter-text は CJS の `module.exports = exports.default` 再代入パターンのため、
// webpack にバンドルされると named/namespace import どちらでも実行時に `extractUrls` 等の
// プロパティが失われる (`next start` の実機検証で TypeError を確認済み)。
// next.config.ts の serverExternalPackages でサーバーバンドル対象から除外し、
// Node の素の require() (全プロパティが揃うことを実測済み) に解決を委ねている。
import * as twitterText from "twitter-text";

import { getEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getSessionAndClient } from "@/lib/supabase/session";
import type { Channel, Paged, Pagination, Result } from "@/modules/platform/contracts";
import type { NoteContent, XContent } from "@/modules/ai-studio/contracts";
import { settingsFacade } from "@/modules/settings/facade";

import { resolveAiStudioFacade } from "./internal/ai-studio-bridge";
import { estimateXCostCents, exceedsMonthlyBillingGuard } from "./internal/billing";
import {
  exchangeMetaAuthorizationCode,
  exchangeForLongLivedToken,
  listFacebookPages,
  resolveInstagramBusinessAccount,
} from "./internal/instagram-api";
import { currentJstMonthRangeUtc } from "./internal/month-window";
import { ConfirmedApiError } from "./internal/publish-error-classify";
import { resolveInitialSchedule } from "./internal/schedule-policy";
import type { InstagramVaultSecret, XVaultSecret } from "./internal/vault-names";
import { VAULT_SECRET_NAMES } from "./internal/vault-names";
import { runPublishWorkerBatch, runWatchdogSweep } from "./internal/worker";
import { exchangeXAuthorizationCode, getXUserInfo } from "./internal/x-api";
import {
  zInstagramAccountMeta,
  zNoteAccountMeta,
  zXAccountMeta,
  type AccountChannel,
  type ChannelAccountView,
  type ChannelAuthStatus,
  type ChannelPostStatus,
  type ChannelPostView,
  type ManualReconcileAction,
  type NoteAccountInput,
  type ScheduleEntry,
  type StyleProfileInput,
  type StyleProfileView,
} from "./contracts";
import * as repo from "./repository";
import type { ChannelAccountRow, ChannelPostRow, StyleProfileRow } from "./repository";

export { runPublishWorkerBatch, runWatchdogSweep };

/**
 * distribution モジュールの公開 facade (契約書 §5)。
 * canonical: schedulePosts / cancel / markNotePublished / getMonthlyXPostCount。
 * それ以外は /admin/channels・OAuth Route Handler・worker が必要とする拡張
 * (module-contracts.md 未更新分 — オーケストレーターへ報告済み)。
 */
export interface DistributionFacade {
  schedulePosts(entries: ScheduleEntry[]): Promise<Result<{ post_ids: string[] }>>;
  cancel(postId: string): Promise<Result<void>>;
  markNotePublished(postId: string, externalUrl: string): Promise<Result<void>>;
  getMonthlyXPostCount(): Promise<Result<number>>;
}

export interface DistributionFacadeExtended extends DistributionFacade {
  listChannelPosts(
    filter: { status?: ChannelPostStatus; cursor: string | null; limit: number },
  ): Promise<Result<Paged<ChannelPostView>>>;
  retryFailed(postId: string): Promise<Result<void>>;
  resolveManualRequired(postId: string, action: ManualReconcileAction): Promise<Result<void>>;

  listChannelAccounts(): Promise<Result<ChannelAccountView[]>>;
  updateNoteAccount(input: NoteAccountInput): Promise<Result<void>>;
  markChannelExpired(channel: AccountChannel): Promise<Result<void>>;

  getStyleProfile(channel: Channel): Promise<Result<StyleProfileView | null>>;
  updateStyleProfile(channel: Channel, input: StyleProfileInput): Promise<Result<void>>;

  /** OAuth callback から呼ばれる (契約書 §7.3) */
  completeXOAuthCallback(input: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<Result<{ username: string }>>;

  /** Meta OAuth callback から呼ばれる (契約書 §7.4 の「短期→長期→ページ一覧」まで) */
  exchangeMetaCodeAndListPages(input: {
    code: string;
    redirectUri: string;
  }): Promise<Result<{ pages: { id: string; name: string; access_token: string }[]; expiresAt: string }>>;

  /** /admin/channels のページ選択 UI から呼ばれる (契約書 §7.4 の残り) */
  finalizeMetaConnection(input: {
    pageId: string;
    pageAccessToken: string;
    expiresAt: string;
  }): Promise<Result<{ username: string }>>;

  /** note コピペ支援 (設計書 §8.3) 用に承認済み draft の note 本文を取得する */
  getNoteDraftForCopy(
    draftId: string,
  ): Promise<Result<{ title: string; body_md: string; hashtags: string[] }>>;
}

// ---- 行 → ビュー型 mapping ----

function toChannelPostView(row: ChannelPostRow): ChannelPostView {
  return {
    id: row.id,
    draft_id: row.draft_id,
    channel: row.channel as Channel,
    status: row.status as ChannelPostStatus,
    scheduled_at: row.scheduled_at,
    published_at: row.published_at,
    external_id: row.external_id,
    external_url: row.external_url,
    tweet_count: row.tweet_count,
    url_count: row.url_count,
    estimated_cost_cents: row.estimated_cost_cents,
    attempt_count: row.attempt_count,
    last_error_code: row.last_error_code,
    last_error_detail: row.last_error_detail,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toChannelAccountView(row: ChannelAccountRow): ChannelAccountView {
  return {
    channel: row.channel as AccountChannel,
    account_label: row.account_label,
    auth_status: row.auth_status as ChannelAuthStatus,
    meta: row.meta,
    connected_at: row.connected_at,
    updated_at: row.updated_at,
  };
}

function toStyleProfileView(row: StyleProfileRow): StyleProfileView {
  return {
    channel: row.channel as Channel,
    tone_instructions: row.tone_instructions,
    format_rules: row.format_rules,
    example_output: row.example_output,
    updated_at: row.updated_at,
  };
}

// ---- canonical (§5) ----

async function schedulePosts(entries: ScheduleEntry[]): Promise<Result<{ post_ids: string[] }>> {
  let aiStudio;
  try {
    aiStudio = await resolveAiStudioFacade();
  } catch (err) {
    return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
  }

  type Prepared = {
    entry: ScheduleEntry;
    channel: Channel;
    status: "scheduled" | "manual_required";
    scheduledAt: string;
    tweetCount: number | null;
    urlCount: number | null;
    costCents: number;
  };
  const prepared: Prepared[] = [];

  for (const entry of entries) {
    const draftResult = await aiStudio.getApprovedDraft(entry.draft_id);
    if (!draftResult.ok) return draftResult;
    const draft = draftResult.value;

    const scheduleResolution = resolveInitialSchedule(draft.channel, entry.scheduled_at);
    if (!scheduleResolution.ok) {
      return { ok: false, code: "KMB-E101", detail: scheduleResolution.detail };
    }

    let tweetCount: number | null = null;
    let urlCount: number | null = null;
    let costCents = 0;
    if (draft.channel === "x") {
      const content = draft.content as XContent;
      tweetCount = content.thread.length;
      urlCount = content.thread.filter((t) => twitterText.extractUrls(t.text).length > 0).length;
      costCents = estimateXCostCents({ tweetCount, urlCount });
    }

    prepared.push({
      entry,
      channel: draft.channel,
      status: scheduleResolution.initialStatus,
      scheduledAt: scheduleResolution.scheduledAt ?? new Date().toISOString(),
      tweetCount,
      urlCount,
      costCents,
    });
  }

  const totalNewXCents = prepared.filter((p) => p.channel === "x").reduce((acc, p) => acc + p.costCents, 0);
  const serviceClient = createSupabaseServiceClient();

  if (totalNewXCents > 0) {
    const opsLimitsResult = await settingsFacade.get("ops_limits");
    const limitCents = opsLimitsResult.ok ? opsLimitsResult.value.x_monthly_post_limit : Number.POSITIVE_INFINITY;
    const range = currentJstMonthRangeUtc();
    const sumResult = await repo.getMonthlyXCostCentsSum(serviceClient, range);
    const currentSum = sumResult.ok ? sumResult.value : 0;
    if (exceedsMonthlyBillingGuard({ currentMonthCentsSum: currentSum, additionalCents: totalNewXCents, limitCents })) {
      return { ok: false, code: "KMB-E505", detail: "X の月間コスト上限を超過するため予約できません" };
    }
  }

  const postIds: string[] = [];
  for (const p of prepared) {
    const insertResult = await repo.insertChannelPost(serviceClient, {
      draft_id: p.entry.draft_id,
      channel: p.channel,
      status: p.status,
      scheduled_at: p.scheduledAt,
      tweet_count: p.tweetCount,
      url_count: p.urlCount,
      estimated_cost_cents: p.costCents,
    });
    if (!insertResult.ok) return insertResult;
    postIds.push(insertResult.value.id);
  }

  return { ok: true, value: { post_ids: postIds } };
}

async function cancel(postId: string): Promise<Result<void>> {
  const client = await createSupabaseServerClient();
  const result = await repo.cancelScheduledChannelPost(client, postId);
  if (!result.ok) return result;
  if (!result.value) {
    return { ok: false, code: "KMB-E101", detail: "scheduled 状態の投稿のみキャンセルできます" };
  }
  return { ok: true, value: undefined };
}

async function markNotePublished(postId: string, externalUrl: string): Promise<Result<void>> {
  const serviceClient = createSupabaseServiceClient();
  const postResult = await repo.getChannelPostById(serviceClient, postId);
  if (!postResult.ok) return postResult;
  if (!postResult.value) return { ok: false, code: "KMB-E901", detail: "対象の投稿が見つかりません" };
  if (postResult.value.channel !== "note") {
    return {
      ok: false,
      code: "KMB-E101",
      detail: "note チャネル以外は resolveManualRequired を使用してください",
    };
  }
  const result = await repo.resolveManualRequiredToPublished(serviceClient, postId, externalUrl);
  if (!result.ok) return result;
  if (!result.value) {
    return { ok: false, code: "KMB-E101", detail: "manual_required 状態の投稿のみ確定できます" };
  }
  return { ok: true, value: undefined };
}

async function getMonthlyXPostCount(): Promise<Result<number>> {
  const client = await createSupabaseServerClient();
  const range = currentJstMonthRangeUtc();
  return repo.getMonthlyXPostCount(client, range);
}

// ---- 拡張: /admin/channels 配信キュー ----

async function listChannelPosts(
  filter: { status?: ChannelPostStatus; cursor: string | null; limit: number },
): Promise<Result<Paged<ChannelPostView>>> {
  const client = await createSupabaseServerClient();
  const result = await repo.listChannelPostsAdmin(client, filter);
  if (!result.ok) return result;
  return {
    ok: true,
    value: { items: result.value.rows.map(toChannelPostView), next_cursor: result.value.nextCursor },
  };
}

async function retryFailed(postId: string): Promise<Result<void>> {
  const serviceClient = createSupabaseServiceClient();
  const result = await repo.retryFailedToScheduled(serviceClient, postId, new Date().toISOString());
  if (!result.ok) return result;
  if (!result.value) return { ok: false, code: "KMB-E101", detail: "failed 状態の投稿のみ再試行できます" };
  return { ok: true, value: undefined };
}

async function resolveManualRequired(postId: string, action: ManualReconcileAction): Promise<Result<void>> {
  const serviceClient = createSupabaseServiceClient();
  if (action.kind === "mark_published") {
    const result = await repo.resolveManualRequiredToPublished(serviceClient, postId, action.external_url);
    if (!result.ok) return result;
    if (!result.value) return { ok: false, code: "KMB-E101", detail: "manual_required 状態のみ確定できます" };
    return { ok: true, value: undefined };
  }
  const scheduledAt = action.scheduled_at ?? new Date().toISOString();
  const result = await repo.resolveManualRequiredToScheduled(serviceClient, postId, scheduledAt);
  if (!result.ok) return result;
  if (!result.value) {
    return { ok: false, code: "KMB-E101", detail: "manual_required 状態のみ再スケジュールできます" };
  }
  return { ok: true, value: undefined };
}

// ---- 拡張: channel_accounts / style_profiles ----

async function listChannelAccounts(): Promise<Result<ChannelAccountView[]>> {
  const client = await createSupabaseServerClient();
  const result = await repo.listChannelAccounts(client);
  if (!result.ok) return result;
  return { ok: true, value: result.value.map(toChannelAccountView) };
}

async function updateNoteAccount(input: NoteAccountInput): Promise<Result<void>> {
  const client = await createSupabaseServerClient();
  return repo.upsertChannelAccount(client, {
    channel: "note",
    account_label: input.account_label,
    auth_status: input.account_label.length > 0 ? "connected" : "disconnected",
    vault_secret_name: null,
    meta: zNoteAccountMeta.parse({ profile_url: input.profile_url }),
  });
}

async function markChannelExpired(channel: AccountChannel): Promise<Result<void>> {
  const client = await createSupabaseServerClient();
  return repo.markChannelAccountExpired(client, channel);
}

async function getStyleProfile(channel: Channel): Promise<Result<StyleProfileView | null>> {
  const client = await createSupabaseServerClient();
  const result = await repo.getStyleProfile(client, channel);
  if (!result.ok) return result;
  return { ok: true, value: result.value ? toStyleProfileView(result.value) : null };
}

async function updateStyleProfile(channel: Channel, input: StyleProfileInput): Promise<Result<void>> {
  const { supabase, user } = await getSessionAndClient();
  if (!user) return { ok: false, code: "KMB-E201" };
  return repo.upsertStyleProfile(supabase, {
    channel,
    tone_instructions: input.tone_instructions,
    format_rules: input.format_rules,
    example_output: input.example_output,
    updated_by: user.id,
  });
}

// ---- 拡張: OAuth ----

async function completeXOAuthCallback(input: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<Result<{ username: string }>> {
  const env = getEnv();
  if (!env.X_CLIENT_ID) return { ok: false, code: "KMB-E901", detail: "X_CLIENT_ID が未設定です" };

  try {
    const tokenResult = await exchangeXAuthorizationCode({
      clientId: env.X_CLIENT_ID,
      clientSecret: env.X_CLIENT_SECRET,
      code: input.code,
      codeVerifier: input.codeVerifier,
      redirectUri: input.redirectUri,
    });
    if (!tokenResult.refreshToken) {
      return {
        ok: false,
        code: "KMB-E501",
        detail: "refresh_token が発行されませんでした (offline.access スコープを確認してください)",
      };
    }
    const userInfo = await getXUserInfo(tokenResult.accessToken);

    const serviceClient = createSupabaseServiceClient();
    const secret: XVaultSecret = {
      access_token: tokenResult.accessToken,
      refresh_token: tokenResult.refreshToken,
      expires_at: tokenResult.expiresAt,
    };
    const vaultResult = await repo.vaultUpsertSecret(serviceClient, VAULT_SECRET_NAMES.x, JSON.stringify(secret));
    if (!vaultResult.ok) return vaultResult;

    const upsertResult = await repo.upsertChannelAccount(serviceClient, {
      channel: "x",
      account_label: `@${userInfo.username}`,
      auth_status: "connected",
      vault_secret_name: VAULT_SECRET_NAMES.x,
      meta: zXAccountMeta.parse({
        user_id: userInfo.id,
        username: userInfo.username,
        token_expires_at: tokenResult.expiresAt,
      }),
    });
    if (!upsertResult.ok) return upsertResult;

    return { ok: true, value: { username: userInfo.username } };
  } catch (err) {
    if (err instanceof ConfirmedApiError) return { ok: false, code: "KMB-E501", detail: err.message };
    return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
  }
}

async function exchangeMetaCodeAndListPages(input: {
  code: string;
  redirectUri: string;
}): Promise<Result<{ pages: { id: string; name: string; access_token: string }[]; expiresAt: string }>> {
  const env = getEnv();
  if (!env.META_APP_ID || !env.META_APP_SECRET) {
    return { ok: false, code: "KMB-E901", detail: "META_APP_ID / META_APP_SECRET が未設定です" };
  }
  try {
    const shortResult = await exchangeMetaAuthorizationCode({
      appId: env.META_APP_ID,
      appSecret: env.META_APP_SECRET,
      code: input.code,
      redirectUri: input.redirectUri,
    });
    const longResult = await exchangeForLongLivedToken({
      appId: env.META_APP_ID,
      appSecret: env.META_APP_SECRET,
      shortLivedToken: shortResult.shortLivedToken,
    });
    const pages = await listFacebookPages(longResult.accessToken);
    return {
      ok: true,
      value: {
        pages: pages.map((p) => ({ id: p.id, name: p.name, access_token: p.access_token })),
        expiresAt: longResult.expiresAt,
      },
    };
  } catch (err) {
    if (err instanceof ConfirmedApiError) return { ok: false, code: "KMB-E502", detail: err.message };
    return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
  }
}

async function finalizeMetaConnection(input: {
  pageId: string;
  pageAccessToken: string;
  expiresAt: string;
}): Promise<Result<{ username: string }>> {
  try {
    const igAccount = await resolveInstagramBusinessAccount(input.pageId, input.pageAccessToken);

    const serviceClient = createSupabaseServiceClient();
    const secret: InstagramVaultSecret = { access_token: input.pageAccessToken, expires_at: input.expiresAt };
    const vaultResult = await repo.vaultUpsertSecret(
      serviceClient,
      VAULT_SECRET_NAMES.instagram,
      JSON.stringify(secret),
    );
    if (!vaultResult.ok) return vaultResult;

    const upsertResult = await repo.upsertChannelAccount(serviceClient, {
      channel: "instagram",
      account_label: `@${igAccount.username}`,
      auth_status: "connected",
      vault_secret_name: VAULT_SECRET_NAMES.instagram,
      meta: zInstagramAccountMeta.parse({
        ig_business_account_id: igAccount.id,
        facebook_page_id: input.pageId,
        username: igAccount.username,
        token_expires_at: input.expiresAt,
      }),
    });
    if (!upsertResult.ok) return upsertResult;

    return { ok: true, value: { username: igAccount.username } };
  } catch (err) {
    if (err instanceof ConfirmedApiError) return { ok: false, code: "KMB-E502", detail: err.message };
    return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
  }
}

async function getNoteDraftForCopy(
  draftId: string,
): Promise<Result<{ title: string; body_md: string; hashtags: string[] }>> {
  let aiStudio;
  try {
    aiStudio = await resolveAiStudioFacade();
  } catch (err) {
    return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
  }
  const draftResult = await aiStudio.getApprovedDraft(draftId);
  if (!draftResult.ok) return draftResult;
  if (draftResult.value.channel !== "note") {
    return { ok: false, code: "KMB-E101", detail: "note チャネルの draft ではありません" };
  }
  const content = draftResult.value.content as NoteContent;
  return { ok: true, value: { title: content.title, body_md: content.body_md, hashtags: content.hashtags } };
}

export const distributionFacade: DistributionFacadeExtended = {
  schedulePosts,
  cancel,
  markNotePublished,
  getMonthlyXPostCount,
  listChannelPosts,
  retryFailed,
  resolveManualRequired,
  listChannelAccounts,
  updateNoteAccount,
  markChannelExpired,
  getStyleProfile,
  updateStyleProfile,
  completeXOAuthCallback,
  exchangeMetaCodeAndListPages,
  finalizeMetaConnection,
  getNoteDraftForCopy,
};

// 型のみ再エクスポート (admin UI / Route Handler から Pagination 付きで扱うため)
export type { Pagination };
