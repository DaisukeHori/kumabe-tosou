import { ConfirmedApiError } from "./publish-error-classify";

/**
 * X (Twitter) API v2/v1.1 の薄い fetch ラッパ (設計書 §8.1: SDK 不使用)。
 * fetch 自身が投げる例外 (AbortError/TypeError) はそのまま再 throw し、
 * classifyPublishFailure が「応答不明」と判定できるようにする。
 * HTTP 応答を受信できた 4xx/5xx は ConfirmedApiError に包んで「確定エラー」として扱う。
 */

const X_API_BASE = "https://api.twitter.com/2";
const X_UPLOAD_URL = "https://upload.twitter.com/1.1/media/upload.json";
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

/**
 * v1.1 media/upload (chunked/resumable ではない単発アップロード。画像 <5MB 想定)。
 * media_category="tweet_image" 固定のため mimeType 引数は取らない (JPEG レンディション前提)。
 */
export async function uploadImageToX(accessToken: string, imageBytes: Buffer): Promise<string> {
  const form = new URLSearchParams();
  form.set("media_data", imageBytes.toString("base64"));
  form.set("media_category", "tweet_image");

  const res = await fetch(X_UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ConfirmedApiError(`X media upload エラー (status=${res.status}): ${detail}`, res.status);
  }
  const json = (await res.json()) as { media_id_string?: string };
  if (!json.media_id_string) {
    throw new ConfirmedApiError("X media upload 応答に media_id が含まれていません", res.status);
  }
  return json.media_id_string;
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
