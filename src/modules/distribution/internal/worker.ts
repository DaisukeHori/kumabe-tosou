import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getEnv } from "@/lib/env";
import { resolveIntegrationCredentials } from "@/lib/integration-credentials";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { contentFacade } from "@/modules/content/facade";
import { mediaFacade } from "@/modules/media/facade";
import type {
  ApprovedDraft,
  InstagramContent,
  SiteBlogContent,
  XContent,
} from "@/modules/ai-studio/contracts";
import type { ExecutionContext } from "@/modules/platform/contracts";

import { resolveAiStudioFacade, tryResolveAiStudioWatchdogSweep } from "./ai-studio-bridge";
import { exceedsMonthlyBillingGuard } from "./billing";
import {
  createCarouselContainer,
  createMediaContainer,
  InstagramContainerNotReadyError,
  isInstagramTokenExpiredError,
  publishContainer,
  waitForContainerReady,
} from "./instagram-api";
import { currentJstMonthRangeUtc } from "./month-window";
import { getOpsLimitsForService } from "./ops-limits";
import { classifyPublishFailure, ConfirmedApiError } from "./publish-error-classify";
import { appendCompletedTweet, nextThreadIndex, previousTweetId } from "./thread";
import type { InstagramVaultSecret, XVaultSecret } from "./vault-names";
import { VAULT_SECRET_NAMES } from "./vault-names";
import { postTweet, refreshXToken } from "./x-api";
import { uploadMediaToX } from "./x-media";
import { zInstagramAccountMeta, zXAccountMeta } from "../contracts";
import * as repo from "../repository";
import type { ChannelAccountRow, ChannelPostRow } from "../repository";

const WATCHDOG_STALE_MS = 10 * 60 * 1000; // publishing 10 分超停滞 (設計書 §4.3)
const X_TOKEN_REFRESH_MARGIN_MS = 10 * 60 * 1000; // 期限 10 分前で refresh (設計書 §7.7)
const X_REFRESH_LEASE_TTL_MS = 30_000;
/** リースが取れなかった側が「リース解放 / Vault 更新」をポーリングする間隔と上限 (合計 ≒ TTL 相当) */
export const X_REFRESH_WAIT_POLL_MS = 1_000;
export const X_REFRESH_WAIT_MAX_ATTEMPTS = 30;
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
 * worker は pg_cron (/api/jobs/publish) から起動され cookie セッションを持たない。
 * ai-studio / media / content の facade を cookie 前提 (createSupabaseServerClient) のまま呼ぶと
 * RLS で行が見えず全件 KMB-E101 になるため、service 文脈 (ExecutionContext) を明示して呼ぶ
 * (ai-providers / crm の resolveExecutionClient と同じ流儀。module-contracts.md §3 の 1 の形)。
 */
function serviceCtx(serviceClient: SupabaseClient): ExecutionContext {
  return { mode: "service", client: serviceClient };
}

/**
 * X 課金ガードの判定結果 (敵対レビュー MAJOR#1)。
 * - { blocked: false }: 上限内。投稿してよい。
 * - { blocked: true, reason: "exceeded" }: ops_limits は正常に読めたが、真に月間上限を超過している
 *   (KMB-E505 として顕在化させる)。
 * - { blocked: true, reason: "unreadable" }: ops_limits 行が読めない (missing/invalid)。
 *   上限を確認できないため安全側 (投稿ブロック) に倒すが、真の上限超過ではないため
 *   KMB-E505 ではなく KMB-E901 (システムエラー) として区別して顕在化させる。
 * - { blocked: true, reason: "sum_unreadable" }: 当月合算 (channel_posts) が読めない。
 *   従来は 0 とみなして通していた (fail-open) が、ops_limits 不読と同じく KMB-E901 で拒否する。
 */
type XBillingGuardResult =
  | { blocked: false }
  | { blocked: true; reason: "exceeded" | "unreadable" | "sum_unreadable"; detail?: string };

async function checkXBillingGuardExceeded(client: SupabaseClient): Promise<XBillingGuardResult> {
  const opsLimitsResult = await getOpsLimitsForService(client);
  if (opsLimitsResult.status !== "ok") {
    // 上限が確認できない場合、無制限 (Infinity) へ静かにフォールバックするとコスト上限ガードが
    // 事実上無効化される (KMB-E505 が二度と発火しなくなる)。安全側に倒し、投稿はブロックする
    // (manual_required ではなく failed として顕在化させ、無言劣化にしない。ただし真の上限超過
    // [KMB-E505] とは呼び出し元で明確に区別できるよう reason:"unreadable" を返す)。
    return { blocked: true, reason: "unreadable" };
  }
  const range = currentJstMonthRangeUtc();
  const sumResult = await repo.getMonthlyXCostCentsSum(client, range);
  if (!sumResult.ok) {
    // 合算が読めないのに 0 とみなすと上限ガードが無効化される (fail-open)。fail-closed にする。
    return { blocked: true, reason: "sum_unreadable", detail: sumResult.detail ?? sumResult.code };
  }
  // 対象の post 自身の estimated_cost_cents は既に status='publishing' として合算に含まれるため
  // additionalCents=0 で「現在の合算が上限を超えていないか」だけを再確認する。
  const exceeded = exceedsMonthlyBillingGuard({
    currentMonthCentsSum: sumResult.value,
    additionalCents: 0,
    limitCents: opsLimitsResult.limits.x_monthly_post_limit,
  });
  return exceeded ? { blocked: true, reason: "exceeded" } : { blocked: false };
}

/**
 * X トークン refresh のリースを他プロセスが保持したまま上限時間内に解放されなかった。
 * まだ何も投稿していないため、呼び出し元は post を scheduled に戻して次回起動に回す。
 */
export class XTokenRefreshBusyError extends Error {
  constructor() {
    super("X トークンの refresh を他プロセスが実行中のため、今回の起動では投稿を見送りました");
    this.name = "XTokenRefreshBusyError";
  }
}

async function readXVaultSecret(serviceClient: SupabaseClient, secretName: string): Promise<XVaultSecret | null> {
  const result = await repo.vaultReadSecret(serviceClient, secretName);
  if (!result.ok || !result.value) return null;
  return JSON.parse(result.value) as XVaultSecret;
}

function isFreshXSecret(secret: XVaultSecret): boolean {
  return new Date(secret.expires_at).getTime() - Date.now() > X_TOKEN_REFRESH_MARGIN_MS;
}

async function isXRefreshLeaseHeld(serviceClient: SupabaseClient): Promise<boolean> {
  const accountResult = await repo.getChannelAccount(serviceClient, "x");
  const leaseUntil = accountResult.ok ? accountResult.value?.token_refresh_lease_expires_at : null;
  return Boolean(leaseUntil && new Date(leaseUntil).getTime() > Date.now());
}

async function getValidXAccessToken(
  serviceClient: SupabaseClient,
  account: ChannelAccountRow,
): Promise<string> {
  const secretName = account.vault_secret_name ?? VAULT_SECRET_NAMES.x;
  const secret = await readXVaultSecret(serviceClient, secretName);
  if (!secret) {
    throw new Error("X の Vault シークレットが読み取れません (未接続の可能性があります)");
  }

  if (isFreshXSecret(secret)) {
    return secret.access_token;
  }

  // cron 経由 (セッション無し) のため service client で DB (設定 > 外部連携) → env の順に解決する
  const creds = await resolveIntegrationCredentials("x", { client: serviceClient });
  const clientId = creds.publicId;
  if (!clientId) {
    // refresh できないが、まだ厳密には失効していないなら現行トークンで試行を続ける
    return secret.access_token;
  }
  const clientSecret = creds.secret ?? undefined;

  // 複数 worker 起動の同時実行を CAS リースで直列化 (§7.7「advisory lock で単一実行」の代替実装。
  // migration 20260708000009 のコメント参照)。
  // リースが取れなかった側は固定 1.5 秒待ちではなく、リース解放 (または Vault の更新) を
  // ポーリングして待つ。従来は refresh 完了前に古い値を読み直して 401 → 誤って expired 化していた。
  for (let attempt = 0; attempt < X_REFRESH_WAIT_MAX_ATTEMPTS; attempt++) {
    const leaseResult = await repo.claimTokenRefreshLease(serviceClient, "x", X_REFRESH_LEASE_TTL_MS);
    if (leaseResult.ok && leaseResult.value) {
      // 自分がリースを取った。ただし待っている間に他プロセスが refresh 済みなら二重 refresh しない
      // (X の refresh token は使い捨てのため、古い refresh_token での再 refresh は失敗する)。
      try {
        const current = (await readXVaultSecret(serviceClient, secretName)) ?? secret;
        if (isFreshXSecret(current)) return current.access_token;

        const refreshed = await refreshXToken(clientId, clientSecret, current.refresh_token);
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

    // 他プロセスが refresh 中。解放を待ってから再判定する。
    await sleep(X_REFRESH_WAIT_POLL_MS);
    if (await isXRefreshLeaseHeld(serviceClient)) continue;
    const updated = await readXVaultSecret(serviceClient, secretName);
    if (updated && isFreshXSecret(updated)) return updated.access_token;
    // リースは解放されたが Vault が新しくない (他プロセスの refresh 失敗等) → ループ先頭で自分が取りにいく
  }

  throw new XTokenRefreshBusyError();
}

/**
 * 401 を受けた直後に Vault の現在値を読み直し、使用中のトークンと異なれば (=並行プロセスが
 * refresh 済み) その値で 1 回だけ再試行する。同じ値なら本当に失効している。
 */
async function readRotatedXAccessToken(
  serviceClient: SupabaseClient,
  account: ChannelAccountRow,
  usedToken: string,
): Promise<string | null> {
  const secretName = account.vault_secret_name ?? VAULT_SECRET_NAMES.x;
  const current = await readXVaultSecret(serviceClient, secretName);
  if (!current || current.access_token === usedToken) return null;
  return current.access_token;
}

function buildTweetUrl(username: string | undefined, tweetId: string | undefined): string | null {
  if (!username || !tweetId) return null;
  return `https://x.com/${username}/status/${tweetId}`;
}

/**
 * ツイート添付画像の取得 (JPEG レンディション URL) → ダウンロード → X media upload v2 実行。
 * 失敗時はそのまま例外を再送出する (呼び出し元で 401 は channel expired 経路へ、それ以外
 * (403=media.write 未認可 等) はテキスト投稿ごと manual_required に倒すため。
 * §7 P0: 画像なしで勝手に投稿しない — 旧実装はここを catch で握りつぶし「画像なしで投稿される」
 * 形で症状が顕在化していた。research/ai-studio-v2/sns-image-posting.md §2.1 の指摘どおり)。
 */
async function uploadTweetImage(serviceClient: SupabaseClient, accessToken: string, mediaId: string): Promise<string> {
  const urlResult = await mediaFacade.getJpegRenditionUrl(mediaId, serviceCtx(serviceClient));
  if (!urlResult.ok) {
    throw new Error(
      `画像 (media_id=${mediaId}) の JPEG レンディション取得に失敗しました: ${urlResult.detail ?? urlResult.code}`,
    );
  }
  const bytes = await downloadBytes(urlResult.value);
  return uploadMediaToX({ accessToken, bytes, mediaType: "image/jpeg", mediaCategory: "tweet_image" });
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
    if (err instanceof XTokenRefreshBusyError) {
      // まだ何も投稿していない。scheduled に戻して次回起動に回す (manual_required にしない)。
      await repo.revertPublishingToScheduled(serviceClient, post.id, { code: "KMB-E503", detail: err.message });
      return;
    }
    await repo.markManualRequired(serviceClient, post.id, {
      code: "KMB-E503",
      detail: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  let ref = repo.parseXExternalRef(post.external_id);
  const startIndex = nextThreadIndex(ref);
  const usernameMeta = zXAccountMeta.safeParse(account.meta);

  // 401 → expired 化は「Vault の現在値で再試行しても再度 401」のときだけ (並行 refresh 直後の
  // 旧トークン使用を失効と誤判定しないため)。post 全体で再試行は 1 回まで。
  let rotatedRetryUsed = false;
  const tryRotateToken = async (): Promise<boolean> => {
    if (rotatedRetryUsed) return false;
    const rotated = await readRotatedXAccessToken(serviceClient, account, accessToken);
    if (!rotated) return false;
    rotatedRetryUsed = true;
    accessToken = rotated;
    return true;
  };

  for (let i = startIndex; i < thread.length; i++) {
    const tweet = thread[i];
    const mediaIds: string[] = [];
    if (tweet.media_id) {
      try {
        mediaIds.push(await uploadTweetImage(serviceClient, accessToken, tweet.media_id));
      } catch (err) {
        // 401 (invalid_token = トークン失効) は postTweet の 401 分岐と同一の扱いに統一する
        // (チャネル自体が失効しているため、テキスト投稿時の失敗と区別する理由がない)。
        if (err instanceof ConfirmedApiError && err.status === 401) {
          if (await tryRotateToken()) {
            i -= 1; // 同じツイートを新トークンでやり直す
            continue;
          }
          await repo.markChannelAccountExpired(serviceClient, "x");
          await repo.flagScheduledPostsForExpiredChannel(serviceClient, "x");
          await repo.markFailed(serviceClient, post.id, {
            code: "KMB-E503",
            detail: "X トークンが失効しました (401、画像アップロード時に検出)",
            externalId: JSON.stringify(ref),
          });
          return;
        }

        // それ以外 (403 = media.write 未認可、その他の失敗) は投稿を止めて manual_required に
        // 落とす (画像なしで勝手に投稿しない)。403 は再認可が必要な可能性があるためヒントを付与する。
        const detail = err instanceof Error ? err.message : String(err);
        const scopeHint =
          err instanceof ConfirmedApiError && err.status === 403
            ? " (media.write スコープが未認可の可能性があります。X の再接続 (media.write 再認可) をご確認ください)"
            : "";
        await repo.markManualRequired(serviceClient, post.id, {
          code: "KMB-E501",
          detail: `${detail}${scopeHint}`,
          externalId: JSON.stringify(ref),
        });
        return;
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
        if (await tryRotateToken()) {
          i -= 1; // 同じツイートを新トークンでやり直す
          continue;
        }
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
      const urlResult = await mediaFacade.getJpegRenditionUrl(mediaId, serviceCtx(serviceClient));
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

    // コンテナは非同期処理されるため、publish 前に status_code=FINISHED を確認する
    // (ERROR/EXPIRED → ConfirmedApiError → failed、上限超過 → InstagramContainerNotReadyError → manual_required)。
    await waitForContainerReady(secret.access_token, creationId);

    const mediaId = await publishContainer(igUserId, secret.access_token, creationId);
    await repo.markPublished(serviceClient, post.id, { externalId: mediaId, externalUrl: null });
  } catch (err) {
    // 401 だけでなく、Graph API 流儀の失効 (400 + error.code=190 / type=OAuthException) も同じ経路に流す
    if (isInstagramTokenExpiredError(err)) {
      await repo.markChannelAccountExpired(serviceClient, "instagram");
      await repo.flagScheduledPostsForExpiredChannel(serviceClient, "instagram");
      await repo.markFailed(serviceClient, post.id, {
        code: "KMB-E503",
        detail: `Instagram トークンが失効しました (${err instanceof Error ? err.message : String(err)})`,
      });
      return;
    }
    if (err instanceof InstagramContainerNotReadyError) {
      // コンテナは Meta 側に残っており後から publish 可能になりうる。自動再開で二重投稿しないよう人間照合へ
      await repo.markManualRequired(serviceClient, post.id, {
        code: "KMB-E506",
        detail: err.message,
        externalId: err.creationId,
      });
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
  // ApprovedDraft.run_id は契約 (ai-studio/contracts.ts §4.9) に昇格済み (2026-09-06)。
  const result = await contentFacade.createBlogPostFromDraft(
    { ...content, source_run_id: draft.run_id },
    serviceCtx(serviceClient),
  );
  if (!result.ok) {
    await repo.markFailed(serviceClient, post.id, { code: result.code, detail: result.detail ?? result.code });
    return;
  }
  const url = `${getEnv().NEXT_PUBLIC_SITE_URL}/blog/${result.value.slug}`;
  await repo.markPublished(serviceClient, post.id, { externalId: result.value.post_id, externalUrl: url });
}

async function publishSingleChannelPost(serviceClient: SupabaseClient, post: ChannelPostRow): Promise<void> {
  if (post.channel === "x") {
    const guard = await checkXBillingGuardExceeded(serviceClient);
    if (guard.blocked) {
      if (guard.reason === "exceeded") {
        await repo.markFailed(serviceClient, post.id, {
          code: "KMB-E505",
          detail: "X の月間コスト上限 (ops_limits.x_monthly_post_limit) を超過しています",
        });
      } else if (guard.reason === "sum_unreadable") {
        await repo.markFailed(serviceClient, post.id, {
          code: "KMB-E901",
          detail: `当月の X コスト合算が読めないため投稿を見送りました (fail-closed): ${guard.detail ?? ""}`,
        });
      } else {
        // 真の上限超過ではなく、ops_limits 行が読めない (missing/invalid) ケース。
        // KMB-E505 として記録すると「本当に上限超過した」と誤読されるため区別する。
        await repo.markFailed(serviceClient, post.id, {
          code: "KMB-E901",
          detail: "ops_limits が読めません。/admin/settings で再保存してください",
        });
      }
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

  // service 文脈で呼ぶ (cookie セッションが無い worker で従来は全件 KMB-E101 になっていた)
  const draftResult = await aiStudio.getApprovedDraft(post.draft_id, serviceCtx(serviceClient));
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
