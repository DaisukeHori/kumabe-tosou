import { ConfirmedApiError } from "./publish-error-classify";

/**
 * X (Twitter) media upload v2 クライアント (canonical: docs/research/ai-studio-v2/sns-image-posting.md §2.2)。
 *
 * INIT (`POST /2/media/upload/initialize`) → APPEND (`POST /2/media/upload/{id}/append`、
 * チャンク分割) → FINALIZE (`POST /2/media/upload/{id}/finalize`) → (processing_info が
 * 返れば) STATUS ポーリングの一連を実行する。
 *
 * 旧 v1.1 (`upload.twitter.com/1.1/media/upload.json`、base64 の `media_data` パラメータ) は
 * 2025-06-09 に sunset 済みで必ず失敗する (research §2.1) ため、本モジュールに置き換える。
 *
 * 実装メモ (research に明記が無く、本実装で判断した点。実 API 疎通確認までの前提として
 * オーケストレーターへ報告する):
 * - research は JPEG レンディション (≤5MB) であれば simple upload (単発 `POST /2/media/upload`、
 *   multipart binary) で十分でチャンク実装は「動画対応まで不要」としているが、設計書
 *   §7/§12 P0 の指示により汎用チャンクアップロードとして実装する (画像は 1 チャンクで完結し、
 *   将来の動画対応 (`tweet_gif`/`tweet_video`) にもそのまま流用できる)。
 * - INIT/APPEND は research が明記するとおり multipart/form-data。FINALIZE は本文不要の
 *   POST (research にパラメータ記載なし)。STATUS ポーリングの URL は research に明記が無いため、
 *   v1.1 時代から存続する `GET /2/media/upload?command=STATUS&media_id=<id>` 形式を踏襲する
 *   (research 出典の "Chunked Media Upload quickstart" が STATUS を read 専用の据え置き
 *   エンドポイントとして扱っている前提の推測。実 API での確認が必要)。
 */

const X_MEDIA_UPLOAD_BASE = "https://api.x.com/2/media/upload";
const REQUEST_TIMEOUT_MS = 30_000;

/** 画像 5MB 上限 (research §2.2) に対し 1 チャンクで収まるデフォルトサイズ。動画等の将来対応で複数チャンクになる */
export const DEFAULT_CHUNK_SIZE_BYTES = 4 * 1024 * 1024;

/** STATUS ポーリングの試行上限 (無限ループ防止。画像は通常このポーリングに入らない) */
export const STATUS_POLL_MAX_ATTEMPTS = 10;

export type XMediaCategory = "tweet_image" | "tweet_gif" | "tweet_video";

export type UploadMediaToXInput = {
  accessToken: string;
  bytes: Buffer;
  /** 例: "image/jpeg" (media/facade.getJpegRenditionUrl は常に JPEG レンディションを返す) */
  mediaType: string;
  mediaCategory: XMediaCategory;
  /** テスト/将来のサイズ調整用 (既定 DEFAULT_CHUNK_SIZE_BYTES) */
  chunkSizeBytes?: number;
};

type ProcessingInfo = {
  state?: string;
  check_after_secs?: number;
  error?: { code?: number; name?: string; message?: string };
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postForm(url: string, accessToken: string, form: FormData): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function initializeMediaUpload(input: {
  accessToken: string;
  totalBytes: number;
  mediaType: string;
  mediaCategory: XMediaCategory;
}): Promise<string> {
  const form = new FormData();
  form.set("media_type", input.mediaType);
  form.set("total_bytes", String(input.totalBytes));
  form.set("media_category", input.mediaCategory);

  const res = await postForm(`${X_MEDIA_UPLOAD_BASE}/initialize`, input.accessToken, form);
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ConfirmedApiError(`X media upload initialize エラー (status=${res.status}): ${detail}`, res.status);
  }
  const json = (await res.json().catch(() => ({}))) as { data?: { id?: string } };
  const mediaId = json.data?.id;
  if (!mediaId) {
    throw new ConfirmedApiError("X media upload initialize 応答に media id がありません", res.status);
  }
  return mediaId;
}

async function appendMediaChunk(input: {
  accessToken: string;
  mediaId: string;
  segmentIndex: number;
  chunk: Buffer;
}): Promise<void> {
  const form = new FormData();
  form.set("segment_index", String(input.segmentIndex));
  form.set(
    "media",
    new Blob([new Uint8Array(input.chunk)]),
    `chunk-${input.segmentIndex}`,
  );

  const res = await postForm(`${X_MEDIA_UPLOAD_BASE}/${input.mediaId}/append`, input.accessToken, form);
  // append 成功時は 202/204 (本文なし) を想定。エラー時のみ本文を読む。
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ConfirmedApiError(
      `X media upload append エラー (segment_index=${input.segmentIndex}, status=${res.status}): ${detail}`,
      res.status,
    );
  }
}

async function finalizeMediaUpload(input: {
  accessToken: string;
  mediaId: string;
}): Promise<ProcessingInfo | null> {
  const res = await fetch(`${X_MEDIA_UPLOAD_BASE}/${input.mediaId}/finalize`, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ConfirmedApiError(`X media upload finalize エラー (status=${res.status}): ${detail}`, res.status);
  }
  const json = (await res.json().catch(() => ({}))) as { data?: { processing_info?: ProcessingInfo } };
  return json.data?.processing_info ?? null;
}

async function getMediaUploadStatus(input: { accessToken: string; mediaId: string }): Promise<ProcessingInfo | null> {
  const url = new URL(X_MEDIA_UPLOAD_BASE);
  url.searchParams.set("command", "STATUS");
  url.searchParams.set("media_id", input.mediaId);

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${input.accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ConfirmedApiError(`X media upload STATUS エラー (status=${res.status}): ${detail}`, res.status);
  }
  const json = (await res.json().catch(() => ({}))) as { data?: { processing_info?: ProcessingInfo } };
  return json.data?.processing_info ?? null;
}

/**
 * FINALIZE が返した processing_info が succeeded になるまで STATUS をポーリングする。
 * 画像 (tweet_image) は通常 processing_info 自体が返らず、この関数は呼ばれない
 * (finalize が同期的に完了する)。GIF/動画等、将来の非同期処理向け。
 */
async function waitForProcessingSucceeded(input: {
  accessToken: string;
  mediaId: string;
  initial: ProcessingInfo;
}): Promise<void> {
  let info = input.initial;
  let attempts = 0;

  while (info.state && info.state !== "succeeded") {
    if (info.state === "failed") {
      throw new ConfirmedApiError(
        `X media upload の処理が失敗しました (state=failed): ${info.error?.message ?? "詳細不明"}`,
        422,
      );
    }
    attempts += 1;
    if (attempts > STATUS_POLL_MAX_ATTEMPTS) {
      throw new ConfirmedApiError(
        "X media upload の処理状況確認がタイムアウトしました (STATUS ポーリング上限到達)",
        408,
      );
    }
    const waitMs = (info.check_after_secs ?? 0) * 1000;
    if (waitMs > 0) await sleep(waitMs);

    const next = await getMediaUploadStatus(input);
    if (!next) return; // STATUS 応答に processing_info が無ければ完了とみなす
    info = next;
  }
}

/**
 * INIT → APPEND (チャンク) → FINALIZE (+processing_info があれば STATUS ポーリング) を実行し、
 * 成功時は X 側の media id (tweet payload の `media.media_ids` に渡す文字列) を返す。
 * 途中のいずれかの HTTP エラーは ConfirmedApiError (確定エラー) として送出する
 * (呼び出し元は画像アップロード失敗として manual_required に倒す。§8.1 R1 の方針転換:
 * 画像なしで勝手に投稿しない)。
 */
export async function uploadMediaToX(input: UploadMediaToXInput): Promise<string> {
  const mediaId = await initializeMediaUpload({
    accessToken: input.accessToken,
    totalBytes: input.bytes.length,
    mediaType: input.mediaType,
    mediaCategory: input.mediaCategory,
  });

  const chunkSize = input.chunkSizeBytes ?? DEFAULT_CHUNK_SIZE_BYTES;
  const chunkCount = Math.max(1, Math.ceil(input.bytes.length / chunkSize));
  for (let segmentIndex = 0; segmentIndex < chunkCount; segmentIndex++) {
    const start = segmentIndex * chunkSize;
    const end = Math.min(start + chunkSize, input.bytes.length);
    await appendMediaChunk({
      accessToken: input.accessToken,
      mediaId,
      segmentIndex,
      chunk: input.bytes.subarray(start, end),
    });
  }

  const processingInfo = await finalizeMediaUpload({ accessToken: input.accessToken, mediaId });
  if (processingInfo?.state && processingInfo.state !== "succeeded") {
    await waitForProcessingSucceeded({ accessToken: input.accessToken, mediaId, initial: processingInfo });
  }

  return mediaId;
}
