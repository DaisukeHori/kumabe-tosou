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

import { resolveAiStudioFacade } from "./internal/ai-studio-bridge";
import { estimateXCostCents, exceedsMonthlyBillingGuard } from "./internal/billing";
import {
  exchangeMetaAuthorizationCode,
  exchangeForLongLivedToken,
  listFacebookPages,
  resolveInstagramBusinessAccount,
} from "./internal/instagram-api";
import { currentJstMonthRangeUtc } from "./internal/month-window";
import {
  createNoteDraft as callNoteCreateDraftApi,
  reconcileDraftByTitle as reconcileNoteDraftByTitle,
} from "./internal/note-draft-client";
import { notifyNoteSessionExpired } from "./internal/note-notify";
import { getOpsLimitsForService } from "./internal/ops-limits";
import { ConfirmedApiError } from "./internal/publish-error-classify";
import { resolveInitialSchedule } from "./internal/schedule-policy";
import type { InstagramVaultSecret, XVaultSecret } from "./internal/vault-names";
import { VAULT_SECRET_NAMES } from "./internal/vault-names";
import { runPublishWorkerBatch, runWatchdogSweep } from "./internal/worker";
import { exchangeXAuthorizationCode, getXUserInfo } from "./internal/x-api";
import {
  zInstagramAccountMeta,
  zNoteAccountMeta,
  zNoteSessionCookieInput,
  zXAccountMeta,
  type AccountChannel,
  type ChannelAccountView,
  type ChannelAuthStatus,
  type ChannelPostStatus,
  type ChannelPostView,
  type ManualReconcileAction,
  type NoteAccountInput,
  type NoteDraftStatus,
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
  /** note セッション Cookie の登録 (Vault 保存。§8。module-contracts.md 未更新分 — オーケストレーターへ報告済み) */
  saveNoteSessionCookie(input: { cookie: string }): Promise<Result<void>>;
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

  /** note 下書き自動作成 (設計書 §8 MAJOR-3 の状態遷移込み。module-contracts.md 未更新分) */
  createNoteDraft(postId: string): Promise<Result<{ status: NoteDraftStatus; url: string | null }>>;
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
    note_draft_status: row.note_draft_status as NoteDraftStatus,
    note_draft_url: row.note_draft_url,
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
      const mediaCount = content.thread.filter((t) => t.media_id !== null).length;
      costCents = estimateXCostCents({ tweetCount, urlCount, mediaCount });
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
    // worker.ts (distribution/internal/ops-limits.ts) と同一の共通 helper で service client
    // 直読に統一する (敵対レビュー MAJOR#2)。従来は settingsFacade.get() が失敗すると
    // Number.POSITIVE_INFINITY (無制限) へ静かにフォールバックしており、ops_limits 行が
    // 読めない状態でも X 予約が事実上無制限に通ってしまう fail-open だった。
    // 行不在/破損時は Infinity に倒さず fail-closed (KMB-E901) にする。真の上限超過のみ
    // 引き続き KMB-E505。
    const opsLimitsResult = await getOpsLimitsForService(serviceClient);
    if (opsLimitsResult.status !== "ok") {
      return {
        ok: false,
        code: "KMB-E901",
        detail: "ops_limits が読めません。/admin/settings で再保存してください",
      };
    }
    const range = currentJstMonthRangeUtc();
    const sumResult = await repo.getMonthlyXCostCentsSum(serviceClient, range);
    const currentSum = sumResult.ok ? sumResult.value : 0;
    if (
      exceedsMonthlyBillingGuard({
        currentMonthCentsSum: currentSum,
        additionalCents: totalNewXCents,
        limitCents: opsLimitsResult.limits.x_monthly_post_limit,
      })
    ) {
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
  // 既存の cookie_saved_at / vault_secret_name (§8 の Cookie 登録) を保持したまま
  // account_label / profile_url だけを更新する (saveNoteSessionCookie と独立に呼ばれうるため)。
  const existingResult = await repo.getChannelAccount(client, "note");
  const existing = existingResult.ok ? existingResult.value : null;
  const existingMetaParsed = existing ? zNoteAccountMeta.safeParse(existing.meta) : null;
  const cookieSavedAt = existingMetaParsed?.success ? existingMetaParsed.data.cookie_saved_at : null;
  const hasCookie = Boolean(existing?.vault_secret_name);

  return repo.upsertChannelAccount(client, {
    channel: "note",
    account_label: input.account_label,
    auth_status: input.account_label.length > 0 || hasCookie ? "connected" : "disconnected",
    vault_secret_name: existing?.vault_secret_name ?? null,
    meta: zNoteAccountMeta.parse({ profile_url: input.profile_url, cookie_saved_at: cookieSavedAt }),
  });
}

/**
 * note セッション Cookie の登録 (§8)。Vault 保存 (service client 専用) + channel_accounts.meta に
 * cookie_saved_at を記録する (UI の「あと約 N 日」表示用。有効期限は note 側の実測値 ~30 日の目安であり
 * 保証ではない — research/ai-studio-v2/note-posting.md 参照)。
 */
async function saveNoteSessionCookie(input: { cookie: string }): Promise<Result<void>> {
  const parsed = zNoteSessionCookieInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "KMB-E101",
      detail: parsed.error.issues[0]?.message ?? "入力内容を確認してください。",
    };
  }

  const serviceClient = createSupabaseServiceClient();
  const vaultResult = await repo.vaultUpsertSecret(serviceClient, VAULT_SECRET_NAMES.note, parsed.data.cookie);
  if (!vaultResult.ok) return vaultResult;

  const existingResult = await repo.getChannelAccount(serviceClient, "note");
  const existing = existingResult.ok ? existingResult.value : null;
  const existingMetaParsed = existing ? zNoteAccountMeta.safeParse(existing.meta) : null;
  const profileUrl = existingMetaParsed?.success ? existingMetaParsed.data.profile_url : null;

  return repo.upsertChannelAccount(serviceClient, {
    channel: "note",
    account_label: existing && existing.account_label.length > 0 ? existing.account_label : "note",
    auth_status: "connected",
    vault_secret_name: VAULT_SECRET_NAMES.note,
    meta: zNoteAccountMeta.parse({ profile_url: profileUrl, cookie_saved_at: new Date().toISOString() }),
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

/**
 * note 下書き自動作成 (§8 MAJOR-3 の状態遷移込み)。channel_posts.status (manual_required) は
 * 変更しない — 失敗時は呼び出し元 UI (channel-posts-queue.tsx) が既存の半自動 (コピー+新規タブ)
 * にフォールバックする前提。
 */
async function createNoteDraft(
  postId: string,
): Promise<Result<{ status: NoteDraftStatus; url: string | null }>> {
  const serviceClient = createSupabaseServiceClient();

  const postResult = await repo.getChannelPostById(serviceClient, postId);
  if (!postResult.ok) return postResult;
  const post = postResult.value;
  if (!post) return { ok: false, code: "KMB-E901", detail: "対象の投稿が見つかりません" };
  if (post.channel !== "note") {
    return { ok: false, code: "KMB-E101", detail: "note チャネル以外では下書き作成できません" };
  }
  if (post.note_draft_status === "created") {
    // 二重作成防止 (既に作成済みならそのまま返す)
    return { ok: true, value: { status: "created", url: post.note_draft_url } };
  }

  const cookieResult = await repo.vaultReadSecret(serviceClient, VAULT_SECRET_NAMES.note);
  if (!cookieResult.ok) return cookieResult;
  if (!cookieResult.value) {
    return {
      ok: false,
      code: "KMB-E409",
      detail: "note セッション Cookie が未登録です。設定画面 (/admin/channels) から登録してください。",
    };
  }
  const cookie = cookieResult.value;

  let aiStudio;
  try {
    aiStudio = await resolveAiStudioFacade();
  } catch (err) {
    return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
  }
  const draftResult = await aiStudio.getApprovedDraft(post.draft_id);
  if (!draftResult.ok) return draftResult;
  if (draftResult.value.channel !== "note") {
    return { ok: false, code: "KMB-E101", detail: "note チャネルの draft ではありません" };
  }
  const content = draftResult.value.content as NoteContent;

  // 'creating' への遷移は CAS (条件付き UPDATE: none/failed/unknown → creating) で行う
  // (§8 MAJOR-3。実装レビューで発見・修正: 従来は CAS 無しで creating へ更新してから note API を
  // 呼んでいたため、並列呼び出しが両方とも下書き一覧照合 [reconcile] に失敗した場合、
  // 同じ post の下書きを二重作成しうる不具合があった)。
  //
  // 影響行数 0 (claim 失敗) は「既に他プロセスが creating に遷移済み」を意味する。これは
  // post.note_draft_status が (この関数に入ってきた時点で既に) 'creating' だった場合を含む —
  // 別プロセスが今まさに作成中か、前回プロセスがクラッシュし成否未確定のいずれかであり、
  // どちらであっても外部 API を呼ばずここで早期リターンする (二重作成しない)。
  const claimResult = await repo.claimNoteDraftCreating(serviceClient, postId);
  if (!claimResult.ok) return claimResult;
  if (!claimResult.value) {
    return { ok: true, value: { status: "creating", url: null } };
  }

  // CAS で creating を勝ち取った側のみ reconcile する。前回 unknown (タイムアウト/応答不明)
  // だった場合、新規作成の前にまず下書き一覧と照合する (§8 MAJOR-3: 重複下書きの防止)。
  // 照合自体が失敗してもベストエフォートで通常フローへ進む。
  // ('creating' からの CAS 遷移は上で常に失敗し早期リターンするため、ここに来る時点で
  // post.note_draft_status は 'none' | 'failed' | 'unknown' のいずれかであることが保証される。)
  if (post.note_draft_status === "unknown") {
    try {
      const found = await reconcileNoteDraftByTitle(cookie, content.title);
      if (found) {
        await repo.updateNoteDraftStatus(serviceClient, postId, "created", found.url);
        return { ok: true, value: { status: "created", url: found.url } };
      }
    } catch {
      // 照合失敗は無視し、以降の新規作成試行を続ける
    }
  }

  const outcome = await callNoteCreateDraftApi(cookie, {
    title: content.title,
    bodyMd: content.body_md,
    hashtags: content.hashtags,
    // NoteContent (module-contracts.md §4.4) に画像フィールドが無いため現状常に null
    // (判断点: §7 の SNS 画像生成拡張で note にも見出し画像を持たせる場合はここに配線する。
    // オーケストレーターへ報告済み)。
    headerImageUrl: null,
  });

  if (outcome.kind === "created") {
    await repo.updateNoteDraftStatus(serviceClient, postId, "created", outcome.url);
    return { ok: true, value: { status: "created", url: outcome.url } };
  }

  if (outcome.kind === "failed") {
    await repo.updateNoteDraftStatus(serviceClient, postId, "failed", null);
    if (outcome.reason === "session_invalid") {
      await repo.markChannelAccountExpired(serviceClient, "note");
      await notifyNoteSessionExpired(outcome.detail);
      return { ok: false, code: "KMB-E409", detail: outcome.detail };
    }
    return { ok: false, code: "KMB-E901", detail: outcome.detail };
  }

  // unknown: タイムアウト/応答不明。次回実行時に上の reconcile 分岐で照合される
  await repo.updateNoteDraftStatus(serviceClient, postId, "unknown", null);
  return {
    ok: false,
    code: "KMB-E901",
    detail: `note の応答が確認できませんでした (${outcome.detail})。しばらくしてから再度お試しください (下書き一覧と自動照合します)。`,
  };
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
  saveNoteSessionCookie,
  markChannelExpired,
  getStyleProfile,
  updateStyleProfile,
  completeXOAuthCallback,
  exchangeMetaCodeAndListPages,
  finalizeMetaConnection,
  getNoteDraftForCopy,
  createNoteDraft,
};

// 型のみ再エクスポート (admin UI / Route Handler から Pagination 付きで扱うため)
export type { Pagination };
