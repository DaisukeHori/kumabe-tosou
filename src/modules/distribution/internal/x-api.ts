import { ConfirmedApiError } from "./publish-error-classify";

/**
 * X (Twitter) API v2 の薄い fetch ラッパ (設計書 §8.1: SDK 不使用)。
 * fetch 自身が投げる例外 (AbortError/TypeError) はそのまま再 throw し、
 * classifyPublishFailure が「応答不明」と判定できるようにする。
 * HTTP 応答を受信できた 4xx/5xx は ConfirmedApiError に包んで「確定エラー」として扱う。
 *
 * 画像アップロードは v1.1 (`upload.twitter.com/1.1/media/upload.json`、base64 の
 * `media_data`) が 2025-06-09 に sunset 済みで必ず失敗するため本ファイルから撤去した
 * (research/ai-studio-v2/sns-image-posting.md §2.1)。v2 media upload (INIT/APPEND/FINALIZE)
 * は ./x-media.ts の uploadMediaToX() を使う。
 */

const X_API_BASE = "https://api.twitter.com/2";
const X_TOKEN_URL = "https://api.twitter.com/2/oauth2/token";
const REQUEST_TIMEOUT_MS = 20_000;

export type PostTweetInput = {
  accessToken: string;
  text: string;
  inReplyToTweetId: string | null;
  mediaIds: string[]; // X 側の media_id_string (v1.1 アップロード済み)
};

export async function postTweet(input: PostTweetInput): Promise<{ id: string }> {
  const body: Record<string, unknown> = { text: input.text };
  if (input.inReplyToTweetId) body.reply = { in_reply_to_tweet_id: input.inReplyToTweetId };
  if (input.mediaIds.length > 0) body.media = { media_ids: input.mediaIds };

  const res = await fetch(`${X_API_BASE}/tweets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ConfirmedApiError(`X API エラー (status=${res.status}): ${detail}`, res.status);
  }

  const json = (await res.json()) as { data?: { id?: string } };
  const id = json.data?.id;
  if (!id) throw new ConfirmedApiError("X API 応答に tweet id がありません", res.status);
  return { id };
}

export type RefreshXTokenResult = { accessToken: string; refreshToken: string; expiresAt: string };

/**
 * X の refresh token は使い捨て (ローテーション式。設計書 §7.7)。
 * 応答の refresh_token を必ず新しい値として Vault に上書きする。
 */
export async function refreshXToken(
  clientId: string,
  clientSecret: string | undefined,
  refreshToken: string,
): Promise<RefreshXTokenResult> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  }

  const res = await fetch(X_TOKEN_URL, {
    method: "POST",
    headers,
    body: body.toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ConfirmedApiError(`X token refresh エラー (status=${res.status}): ${detail}`, res.status);
  }
  const json = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + json.expires_in * 1000).toISOString(),
  };
}

export type ExchangeXCodeResult = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string;
};

/** PKCE code + code_verifier → token 交換 (設計書 §7.7 / 契約書 §7.3) */
export async function exchangeXAuthorizationCode(input: {
  clientId: string;
  clientSecret: string | undefined;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<ExchangeXCodeResult> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
    client_id: input.clientId,
  });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (input.clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString("base64")}`;
  }

  const res = await fetch(X_TOKEN_URL, {
    method: "POST",
    headers,
    body: body.toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ConfirmedApiError(`X token 交換エラー (status=${res.status}): ${detail}`, res.status);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: new Date(Date.now() + json.expires_in * 1000).toISOString(),
  };
}

export type XUserInfo = { id: string; username: string };

export async function getXUserInfo(accessToken: string): Promise<XUserInfo> {
  const res = await fetch(`${X_API_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ConfirmedApiError(`X ユーザー情報取得エラー (status=${res.status}): ${detail}`, res.status);
  }
  const json = (await res.json()) as { data?: { id?: string; username?: string } };
  if (!json.data?.id || !json.data.username) {
    throw new ConfirmedApiError("X ユーザー情報応答が不正です", res.status);
  }
  return { id: json.data.id, username: json.data.username };
}
