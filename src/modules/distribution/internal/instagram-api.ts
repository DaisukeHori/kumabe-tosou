import { ConfirmedApiError } from "./publish-error-classify";

/**
 * Instagram Graph API (Content Publishing) の薄い fetch ラッパ (設計書 §8.1 / 契約書 §7.4)。
 * SDK 不使用。画像は JPEG + 公開 URL 必須 (MediaFacade.getJpegRenditionUrl で用意)。
 */

const GRAPH_BASE = "https://graph.facebook.com/v21.0";
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Graph API の確定エラー応答 (JSON ボディ `{ error: { code, type, error_subcode, message } }`)。
 * トークン失効は HTTP 401 ではなく **400 + error.code=190 (OAuthException)** で返ることが多く
 * (Meta の仕様)、status だけを見ていると失効を KMB-E502 (failed) として扱ってしまい
 * channel_accounts.auth_status='expired' への遷移と scheduled 全件へのフラグ付けが行われなかった。
 * error.code / error.type を保持し、isInstagramTokenExpiredError() で判定する。
 */
export class InstagramGraphApiError extends ConfirmedApiError {
  constructor(
    message: string,
    status: number,
    public readonly graphCode: number | null,
    public readonly graphType: string | null,
    public readonly graphSubcode: number | null,
  ) {
    super(message, status);
    this.name = "InstagramGraphApiError";
  }
}

/** トークン失効 (401 と同じ expired 経路に流すべきエラー) の判定。code 190 / type OAuthException / HTTP 401 */
export function isInstagramTokenExpiredError(err: unknown): boolean {
  if (err instanceof InstagramGraphApiError) {
    return err.status === 401 || err.graphCode === 190 || err.graphType === "OAuthException";
  }
  return err instanceof ConfirmedApiError && err.status === 401;
}

function parseGraphErrorBody(text: string): { code: number | null; type: string | null; subcode: number | null } {
  try {
    const json = JSON.parse(text) as { error?: { code?: unknown; type?: unknown; error_subcode?: unknown } };
    const e = json.error ?? {};
    return {
      code: typeof e.code === "number" ? e.code : null,
      type: typeof e.type === "string" ? e.type : null,
      subcode: typeof e.error_subcode === "number" ? e.error_subcode : null,
    };
  } catch {
    return { code: null, type: null, subcode: null };
  }
}

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
    const parsed = parseGraphErrorBody(detail);
    throw new InstagramGraphApiError(
      `Instagram Graph API エラー (status=${res.status}): ${detail}`,
      res.status,
      parsed.code,
      parsed.type,
      parsed.subcode,
    );
  }
  return (await res.json()) as Record<string, unknown>;
}

// ---------------------------------------------------------
// コンテナ状態確認 (publish 前ポーリング)
// ---------------------------------------------------------

/**
 * コンテナが FINISHED にならないまま上限に達した (IN_PROGRESS 継続)。投稿されたか不明ではないが、
 * コンテナは Meta 側に残っており後から publish される可能性があるため worker は manual_required
 * (KMB-E506) に倒す (自動再開で二重投稿しない)。
 */
export class InstagramContainerNotReadyError extends Error {
  constructor(
    public readonly creationId: string,
    public readonly lastStatusCode: string | null,
    public readonly attempts: number,
  ) {
    super(
      `Instagram コンテナ (${creationId}) が ${attempts} 回の確認後も公開可能になりませんでした (status_code=${lastStatusCode ?? "unknown"})`,
    );
    this.name = "InstagramContainerNotReadyError";
  }
}

/** ポーリング上限と短いバックオフ (1s → 2s → 4s → 8s → 8s…、合計 約 50 秒)。 */
export const CONTAINER_STATUS_MAX_ATTEMPTS = 8;
export const CONTAINER_STATUS_BASE_DELAY_MS = 1_000;
export const CONTAINER_STATUS_MAX_DELAY_MS = 8_000;

export function containerStatusDelayMs(attempt: number): number {
  return Math.min(CONTAINER_STATUS_BASE_DELAY_MS * 2 ** attempt, CONTAINER_STATUS_MAX_DELAY_MS);
}

export type ContainerStatusCode = "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED";

/** GET /{creation_id}?fields=status_code,status */
export async function getContainerStatus(
  accessToken: string,
  creationId: string,
): Promise<{ statusCode: ContainerStatusCode | string | null; status: string | null }> {
  const json = await graphFetch(`/${creationId}`, { fields: "status_code,status", access_token: accessToken }, "GET");
  return {
    statusCode: typeof json.status_code === "string" ? json.status_code : null,
    status: typeof json.status === "string" ? json.status : null,
  };
}

/**
 * publishContainer 前にコンテナが FINISHED になるまで待つ (Meta 推奨手順。従来は作成直後に
 * publish しており、非同期処理中 (IN_PROGRESS) のコンテナへ publish して "Media ID is not
 * available" (code 9007) で失敗していた)。
 * - FINISHED / PUBLISHED → 戻る
 * - ERROR / EXPIRED → ConfirmedApiError (確定失敗 → worker は failed)
 * - 上限超過 → InstagramContainerNotReadyError (worker は manual_required)
 */
export async function waitForContainerReady(
  accessToken: string,
  creationId: string,
  opts: { maxAttempts?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const maxAttempts = opts.maxAttempts ?? CONTAINER_STATUS_MAX_ATTEMPTS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let last: string | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { statusCode, status } = await getContainerStatus(accessToken, creationId);
    last = statusCode;
    if (statusCode === "FINISHED" || statusCode === "PUBLISHED") return;
    if (statusCode === "ERROR" || statusCode === "EXPIRED") {
      throw new ConfirmedApiError(
        `Instagram コンテナ (${creationId}) の処理が失敗しました (status_code=${statusCode}${status ? `, status=${status}` : ""})`,
        400,
      );
    }
    if (attempt < maxAttempts - 1) await sleep(containerStatusDelayMs(attempt));
  }
  throw new InstagramContainerNotReadyError(creationId, last, maxAttempts);
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
