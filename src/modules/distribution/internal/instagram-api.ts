import { ConfirmedApiError } from "./publish-error-classify";

/**
 * Instagram Graph API (Content Publishing) の薄い fetch ラッパ (設計書 §8.1 / 契約書 §7.4)。
 * SDK 不使用。画像は JPEG + 公開 URL 必須 (MediaFacade.getJpegRenditionUrl で用意)。
 */

const GRAPH_BASE = "https://graph.facebook.com/v21.0";
const REQUEST_TIMEOUT_MS = 20_000;

async function graphFetch(path: string, params: Record<string, string>, method: "GET" | "POST" = "POST") {
  const url = new URL(`${GRAPH_BASE}${path}`);
  if (method === "GET") {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    method,
    ...(method === "POST"
      ? {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(params).toString(),
        }
      : {}),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ConfirmedApiError(`Instagram Graph API エラー (status=${res.status}): ${detail}`, res.status);
  }
  return (await res.json()) as Record<string, unknown>;
}

/** 単一画像 (or カルーセル子要素) のコンテナ作成。戻り値はコンテナ (creation) id */
export async function createMediaContainer(
  igUserId: string,
  accessToken: string,
  input: { imageUrl: string; caption?: string; isCarouselItem?: boolean },
): Promise<string> {
  const params: Record<string, string> = { access_token: accessToken, image_url: input.imageUrl };
  if (input.caption) params.caption = input.caption;
  if (input.isCarouselItem) params.is_carousel_item = "true";
  const json = await graphFetch(`/${igUserId}/media`, params);
  const id = json.id as string | undefined;
  if (!id) throw new ConfirmedApiError("Instagram コンテナ作成応答に id がありません", 502);
  return id;
}

/** カルーセル (複数画像) コンテナ作成 */
export async function createCarouselContainer(
  igUserId: string,
  accessToken: string,
  childContainerIds: string[],
  caption?: string,
): Promise<string> {
  const params: Record<string, string> = {
    access_token: accessToken,
    media_type: "CAROUSEL",
    children: childContainerIds.join(","),
  };
  if (caption) params.caption = caption;
  const json = await graphFetch(`/${igUserId}/media`, params);
  const id = json.id as string | undefined;
  if (!id) throw new ConfirmedApiError("Instagram カルーセルコンテナ作成応答に id がありません", 502);
  return id;
}

/** コンテナの publish (実際の投稿)。戻り値は公開された IG media id */
export async function publishContainer(
  igUserId: string,
  accessToken: string,
  creationId: string,
): Promise<string> {
  const json = await graphFetch(`/${igUserId}/media_publish`, {
    access_token: accessToken,
    creation_id: creationId,
  });
  const id = json.id as string | undefined;
  if (!id) throw new ConfirmedApiError("Instagram publish 応答に id がありません", 502);
  return id;
}

export type ExchangeMetaCodeResult = { shortLivedToken: string };

export async function exchangeMetaAuthorizationCode(input: {
  appId: string;
  appSecret: string;
  code: string;
  redirectUri: string;
}): Promise<ExchangeMetaCodeResult> {
  const json = await graphFetch(
    "/oauth/access_token",
    {
      client_id: input.appId,
      client_secret: input.appSecret,
      redirect_uri: input.redirectUri,
      code: input.code,
    },
    "GET",
  );
  const token = json.access_token as string | undefined;
  if (!token) throw new ConfirmedApiError("Meta token 交換応答に access_token がありません", 502);
  return { shortLivedToken: token };
}

export type LongLivedTokenResult = { accessToken: string; expiresAt: string };

export async function exchangeForLongLivedToken(input: {
  appId: string;
  appSecret: string;
  shortLivedToken: string;
}): Promise<LongLivedTokenResult> {
  const json = await graphFetch(
    "/oauth/access_token",
    {
      grant_type: "fb_exchange_token",
      client_id: input.appId,
      client_secret: input.appSecret,
      fb_exchange_token: input.shortLivedToken,
    },
    "GET",
  );
  const token = json.access_token as string | undefined;
  const expiresIn = (json.expires_in as number | undefined) ?? 60 * 24 * 60 * 60; // 既定 60 日
  if (!token) throw new ConfirmedApiError("Meta 長期トークン交換応答に access_token がありません", 502);
  return { accessToken: token, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
}

/** 期限 7 日前の自動延長 (設計書 §7.7) */
export async function refreshLongLivedToken(
  appId: string,
  appSecret: string,
  currentToken: string,
): Promise<LongLivedTokenResult> {
  return exchangeForLongLivedToken({ appId, appSecret, shortLivedToken: currentToken });
}

export type FacebookPage = { id: string; name: string; access_token: string };

export async function listFacebookPages(accessToken: string): Promise<FacebookPage[]> {
  const json = await graphFetch("/me/accounts", { access_token: accessToken }, "GET");
  const data = (json.data as FacebookPage[] | undefined) ?? [];
  return data;
}

export type InstagramBusinessAccount = { id: string; username: string };

export async function resolveInstagramBusinessAccount(
  pageId: string,
  pageAccessToken: string,
): Promise<InstagramBusinessAccount> {
  const json = await graphFetch(
    `/${pageId}`,
    { fields: "instagram_business_account{id,username}", access_token: pageAccessToken },
    "GET",
  );
  const account = json.instagram_business_account as { id?: string; username?: string } | undefined;
  if (!account?.id) {
    throw new ConfirmedApiError("この Facebook ページに Instagram ビジネスアカウントが紐付いていません", 400);
  }
  return { id: account.id, username: account.username ?? "" };
}
