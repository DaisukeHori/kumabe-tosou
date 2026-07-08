import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getEnv } from "@/lib/env";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { contentFacade } from "@/modules/content/facade";
import { mediaFacade } from "@/modules/media/facade";
import { settingsFacade } from "@/modules/settings/facade";
import type {
  ApprovedDraft,
  InstagramContent,
  SiteBlogContent,
  XContent,
} from "@/modules/ai-studio/contracts";

import { resolveAiStudioFacade, tryResolveAiStudioWatchdogSweep } from "./ai-studio-bridge";
import { exceedsMonthlyBillingGuard } from "./billing";
import {
  createCarouselContainer,
  createMediaContainer,
  publishContainer,
} from "./instagram-api";
import { currentJstMonthRangeUtc } from "./month-window";
import { classifyPublishFailure, ConfirmedApiError } from "./publish-error-classify";
import { appendCompletedTweet, nextThreadIndex, previousTweetId } from "./thread";
import type { InstagramVaultSecret, XVaultSecret } from "./vault-names";
import { VAULT_SECRET_NAMES } from "./vault-names";
import { postTweet, refreshXToken, uploadImageToX } from "./x-api";
import { zInstagramAccountMeta, zXAccountMeta } from "../contracts";
import * as repo from "../repository";
import type { ChannelAccountRow, ChannelPostRow } from "../repository";

const WATCHDOG_STALE_MS = 10 * 60 * 1000; // publishing 10 分超停滞 (設計書 §4.3)
const X_TOKEN_REFRESH_MARGIN_MS = 10 * 60 * 1000; // 期限 10 分前で refresh (設計書 §7.7)
const X_REFRESH_LEASE_TTL_MS = 30_000;
const MAX_BATCH_SIZE = 5; // X rate limit 保護 (設計書 §7.5)

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadBytes(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`画像のダウンロードに失敗しました (status=${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * ai-studio の ApprovedDraft (契約書 §4.9) は run_id を含まない。site_blog 配信
 * (ContentFacade.createBlogPostFromDraft) には source_run_id が必須のため、
 * ai-studio 実装が channel_drafts.run_id を追加フィールドとして実行時に含めていることを
 * 期待し、防御的に読み取る (型上は保証されない拡張フィールド。
 * 未対応の場合は manual_required に倒し、オーケストレーターへ契約ギャップとして報告済み)。
 */
function extractRunId(draft: ApprovedDraft): string | null {
  const withRunId = draft as unknown as { run_id?: unknown };
  return typeof withRunId.run_id === "string" ? withRunId.run_id : null;
}

async function checkXBillingGuardExceeded(client: SupabaseClient): Promise<boolean> {
  const opsLimitsResult = await settingsFacade.get("ops_limits");
  const limitCents = opsLimitsResult.ok ? opsLimitsResult.value.x_monthly_post_limit : Number.POSITIVE_INFINITY;
  const range = currentJstMonthRangeUtc();
  const sumResult = await repo.getMonthlyXCostCentsSum(client, range);
  const currentSum = sumResult.ok ? sumResult.value : 0;
  // 対象の post 自身の estimated_cost_cents は既に status='publishing' として合算に含まれるため
  // additionalCents=0 で「現在の合算が上限を超えていないか」だけを再確認する。
  return exceedsMonthlyBillingGuard({ currentMonthCentsSum: currentSum, additionalCents: 0, limitCents });
}

async function getValidXAccessToken(
  serviceClient: SupabaseClient,
  account: ChannelAccountRow,
): Promise<string> {
  const secretName = account.vault_secret_name ?? VAULT_SECRET_NAMES.x;
  const secretResult = await repo.vaultReadSecret(serviceClient, secretName);
  if (!secretResult.ok || !secretResult.value) {
    throw new Error("X の Vault シークレットが読み取れません (未接続の可能性があります)");
  }
  const secret = JSON.parse(secretResult.value) as XVaultSecret;

  const msUntilExpiry = new Date(secret.expires_at).getTime() - Date.now();
  if (msUntilExpiry > X_TOKEN_REFRESH_MARGIN_MS) {
    return secret.access_token;
  }

  const env = getEnv();
  if (!env.X_CLIENT_ID) {
    // refresh できないが、まだ厳密には失効していないなら現行トークンで試行を続ける
    return secret.access_token;
  }

  // 複数 worker 起動の同時実行を CAS リースで直列化 (§7.7「advisory lock で単一実行」の代替実装。
  // migration 20260708000009 のコメント参照)。
  const leaseResult = await repo.claimTokenRefreshLease(serviceClient, "x", X_REFRESH_LEASE_TTL_MS);
  if (!leaseResult.ok || !leaseResult.value) {
    // 他プロセスが refresh 中。少し待って Vault の更新後の値を読み直す。
    await sleep(1500);
    const retryResult = await repo.vaultReadSecret(serviceClient, secretName);
    if (retryResult.ok && retryResult.value) {
      return (JSON.parse(retryResult.value) as XVaultSecret).access_token;
    }
    return secret.access_token;
  }

  try {
    const refreshed = await refreshXToken(env.X_CLIENT_ID, env.X_CLIENT_SECRET, secret.refresh_token);
    const nextSecret: XVaultSecret = {
      access_token: refreshed.accessToken,
      refresh_token: refreshed.refreshToken,
      expires_at: refreshed.expiresAt,
    };
    await repo.vaultUpsertSecret(serviceClient, secretName, JSON.stringify(nextSecret));
    return refreshed.accessToken;
  } finally {
    await repo.releaseTokenRefreshLease(serviceClient, "x");
  }
}

function buildTweetUrl(username: string | undefined, tweetId: string | undefined): string | null {
  if (!username || !tweetId) return null;
  return `https://x.com/${username}/status/${tweetId}`;
}

async function publishXPost(
  serviceClient: SupabaseClient,
  post: ChannelPostRow,
  draft: ApprovedDraft,
): Promise<void> {
  const content = draft.content as XContent;
  const thread = content.thread;

  const accountResult = await repo.getChannelAccount(serviceClient, "x");
  const account = accountResult.ok ? accountResult.value : null;
  if (!account || account.auth_status !== "connected") {
    await repo.markManualRequired(serviceClient, post.id, {
      code: "KMB-E503",
      detail: "X チャネルが接続されていません",
    });
    return;
  }

  let accessToken: string;
  try {
    accessToken = await getValidXAccessToken(serviceClient, account);
  } catch (err) {
    await repo.markManualRequired(serviceClient, post.id, {
      code: "KMB-E503",
      detail: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  let ref = repo.parseXExternalRef(post.external_id);
  const startIndex = nextThreadIndex(ref);
  const usernameMeta = zXAccountMeta.safeParse(account.meta);

  for (let i = startIndex; i < thread.length; i++) {
    const tweet = thread[i];
    const mediaIds: string[] = [];
    if (tweet.media_id) {
      try {
        const urlResult = await mediaFacade.getJpegRenditionUrl(tweet.media_id);
        if (urlResult.ok) {
          const bytes = await downloadBytes(urlResult.value);
          mediaIds.push(await uploadImageToX(accessToken, bytes));
        }
      } catch {
        // 画像アップロードの失敗はテキスト投稿を止めない (画像添付は §8.1 R1 のとおり未確定要件のためベストエフォート)
      }
    }

    try {
      const result = await postTweet({
        accessToken,
        text: tweet.text,
        inReplyToTweetId: previousTweetId(ref, i),
        mediaIds,
      });
      ref = appendCompletedTweet(ref, result.id);
      await repo.updateXThreadProgress(serviceClient, post.id, ref);
    } catch (err) {
      if (err instanceof ConfirmedApiError && err.status === 401) {
        await repo.markChannelAccountExpired(serviceClient, "x");
        await repo.flagScheduledPostsForExpiredChannel(serviceClient, "x");
        await repo.markFailed(serviceClient, post.id, {
          code: "KMB-E503",
          detail: "X トークンが失効しました (401)",
          externalId: JSON.stringify(ref),
        });
        return;
      }
      const kind = classifyPublishFailure(err);
      const detail = err instanceof Error ? err.message : String(err);
      if (kind === "failed") {
        await repo.markFailed(serviceClient, post.id, { code: "KMB-E504", detail, externalId: JSON.stringify(ref) });
      } else {
        await repo.markManualRequired(serviceClient, post.id, {
          code: "KMB-E506",
          detail,
          externalId: JSON.stringify(ref),
        });
      }
      return;
    }
  }

  const externalUrl = buildTweetUrl(
    usernameMeta.success ? usernameMeta.data.username : undefined,
    ref.tweet_ids[ref.tweet_ids.length - 1],
  );
  await repo.markPublished(serviceClient, post.id, { externalId: JSON.stringify(ref), externalUrl });
}

async function publishInstagramPost(
  serviceClient: SupabaseClient,
  post: ChannelPostRow,
  draft: ApprovedDraft,
): Promise<void> {
  const content = draft.content as InstagramContent;

  const accountResult = await repo.getChannelAccount(serviceClient, "instagram");
  const account = accountResult.ok ? accountResult.value : null;
  if (!account || account.auth_status !== "connected") {
    await repo.markManualRequired(serviceClient, post.id, {
      code: "KMB-E503",
      detail: "Instagram チャネルが接続されていません",
    });
    return;
  }

  const metaResult = zInstagramAccountMeta.safeParse(account.meta);
  if (!metaResult.success) {
    await repo.markFailed(serviceClient, post.id, {
      code: "KMB-E901",
      detail: "channel_accounts.meta (instagram) が契約と一致しません",
    });
    return;
  }
  const igUserId = metaResult.data.ig_business_account_id;

  const secretResult = await repo.vaultReadSecret(
    serviceClient,
    account.vault_secret_name ?? VAULT_SECRET_NAMES.instagram,
  );
  if (!secretResult.ok || !secretResult.value) {
    await repo.markManualRequired(serviceClient, post.id, {
      code: "KMB-E503",
      detail: "Instagram の Vault シークレットが読み取れません",
    });
    return;
  }
  const secret = JSON.parse(secretResult.value) as InstagramVaultSecret;

  try {
    const imageUrls: string[] = [];
    for (const mediaId of content.media_ids) {
      const urlResult = await mediaFacade.getJpegRenditionUrl(mediaId);
      if (!urlResult.ok) throw new Error(`media ${mediaId} の JPEG レンディション取得に失敗しました`);
      imageUrls.push(urlResult.value);
    }

    const caption = [content.caption, content.hashtags.map((h) => `#${h}`).join(" ")]
      .filter((s) => s.length > 0)
      .join("\n\n");

    let creationId: string;
    if (imageUrls.length === 1) {
      creationId = await createMediaContainer(igUserId, secret.access_token, {
        imageUrl: imageUrls[0],
        caption,
      });
    } else {
      const childIds: string[] = [];
      for (const url of imageUrls) {
        childIds.push(
          await createMediaContainer(igUserId, secret.access_token, { imageUrl: url, isCarouselItem: true }),
        );
      }
      creationId = await createCarouselContainer(igUserId, secret.access_token, childIds, caption);
    }

    const mediaId = await publishContainer(igUserId, secret.access_token, creationId);
    await repo.markPublished(serviceClient, post.id, { externalId: mediaId, externalUrl: null });
  } catch (err) {
    if (err instanceof ConfirmedApiError && err.status === 401) {
      await repo.markChannelAccountExpired(serviceClient, "instagram");
      await repo.flagScheduledPostsForExpiredChannel(serviceClient, "instagram");
      await repo.markFailed(serviceClient, post.id, { code: "KMB-E503", detail: "Instagram トークンが失効しました" });
      return;
    }
    const kind = classifyPublishFailure(err);
    const detail = err instanceof Error ? err.message : String(err);
    if (kind === "failed") {
      await repo.markFailed(serviceClient, post.id, { code: "KMB-E502", detail });
    } else {
      await repo.markManualRequired(serviceClient, post.id, { code: "KMB-E506", detail });
    }
  }
}

async function publishSiteBlogPost(
  serviceClient: SupabaseClient,
  post: ChannelPostRow,
  draft: ApprovedDraft,
): Promise<void> {
  const content = draft.content as SiteBlogContent;
  const runId = extractRunId(draft);
  if (!runId) {
    await repo.markManualRequired(serviceClient, post.id, {
      code: "KMB-E901",
      detail:
        "ApprovedDraft に run_id が含まれていないため site_blog 配信を実行できません " +
        "(ai-studio 側の ApprovedDraft 拡張待ち。オーケストレーターへ契約ギャップとして報告済み)",
    });
    return;
  }

  const result = await contentFacade.createBlogPostFromDraft({ ...content, source_run_id: runId });
  if (!result.ok) {
    await repo.markFailed(serviceClient, post.id, { code: result.code, detail: result.detail ?? result.code });
    return;
  }
  const url = `${getEnv().NEXT_PUBLIC_SITE_URL}/blog/${result.value.slug}`;
  await repo.markPublished(serviceClient, post.id, { externalId: result.value.post_id, externalUrl: url });
}

async function publishSingleChannelPost(serviceClient: SupabaseClient, post: ChannelPostRow): Promise<void> {
  if (post.channel === "x") {
    const exceeded = await checkXBillingGuardExceeded(serviceClient);
    if (exceeded) {
      await repo.markFailed(serviceClient, post.id, {
        code: "KMB-E505",
        detail: "X の月間コスト上限 (ops_limits.x_monthly_post_limit) を超過しています",
      });
      return;
    }
  }

  let aiStudio;
  try {
    aiStudio = await resolveAiStudioFacade();
  } catch (err) {
    await repo.markFailed(serviceClient, post.id, {
      code: "KMB-E901",
      detail: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  const draftResult = await aiStudio.getApprovedDraft(post.draft_id);
  if (!draftResult.ok) {
    await repo.markFailed(serviceClient, post.id, {
      code: draftResult.code,
      detail: draftResult.detail ?? draftResult.code,
    });
    return;
  }
  const draft = draftResult.value;

  try {
    if (post.channel === "x") {
      await publishXPost(serviceClient, post, draft);
    } else if (post.channel === "instagram") {
      await publishInstagramPost(serviceClient, post, draft);
    } else if (post.channel === "site_blog") {
      await publishSiteBlogPost(serviceClient, post, draft);
    } else {
      // note は §8.3 のとおり scheduled を経由せず即 manual_required で作られるため、
      // ここに到達するのは不整合ケースのみ (安全側にログを残して停止)
      await repo.markManualRequired(serviceClient, post.id, {
        code: "KMB-E901",
        detail: `想定外のチャネルが worker に到達しました: ${post.channel}`,
      });
    }
  } catch (err) {
    // 各 publishXxx 内で例外は分類済みのはずだが、二重の安全網として拾う
    const kind = classifyPublishFailure(err);
    const detail = err instanceof Error ? err.message : String(err);
    if (kind === "failed") {
      await repo.markFailed(serviceClient, post.id, { code: "KMB-E901", detail });
    } else {
      await repo.markManualRequired(serviceClient, post.id, { code: "KMB-E506", detail });
    }
  }
}

/**
 * /api/jobs/publish の本体 (契約書 §7.2)。ルートハンドラは 202 を返した後、
 * next/server の after() からこれを呼ぶ (pg_net の timeout に依存しないため)。
 */
export async function runPublishWorkerBatch(): Promise<{ processed: number }> {
  const serviceClient = createSupabaseServiceClient();
  const claimResult = await repo.claimDueScheduledPosts(serviceClient, MAX_BATCH_SIZE);
  if (!claimResult.ok) return { processed: 0 };

  let processed = 0;
  for (const post of claimResult.value) {
    await publishSingleChannelPost(serviceClient, post);
    processed += 1;
  }
  return { processed };
}

/**
 * /api/jobs/watchdog の本体 (設計書 §4.3 / §7.6)。
 * channel_posts.publishing の 10 分超停滞を manual_required (E506) に倒す (distribution 所有領域)。
 * ai_runs のリース失効スイープは ai-studio の所有領域のため、facade にメソッドが実装されていれば
 * best-effort で呼ぶ (未実装なら no-op。§7.6 は「watchdog は保険」と位置付けているため必須ではない)。
 */
export async function runWatchdogSweep(): Promise<{ manualRequiredCount: number }> {
  const serviceClient = createSupabaseServiceClient();
  const staleBefore = new Date(Date.now() - WATCHDOG_STALE_MS).toISOString();
  const staleResult = await repo.listStalePublishing(serviceClient, staleBefore);

  let manualRequiredCount = 0;
  if (staleResult.ok) {
    for (const row of staleResult.value) {
      const result = await repo.markManualRequired(serviceClient, row.id, {
        code: "KMB-E506",
        detail: "publishing のまま 10 分以上停滞したため、実際に投稿されたか確認してください",
      });
      if (result.ok) manualRequiredCount += 1;
    }
  }

  const sweep = await tryResolveAiStudioWatchdogSweep();
  if (sweep) {
    try {
      await sweep();
    } catch {
      // ai-studio 側のスイープ失敗はベストエフォート (§7.6: 次の advance が本来の回収経路)
    }
  }

  return { manualRequiredCount };
}
