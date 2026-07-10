import { ConfirmedApiError } from "./publish-error-classify";

/**
 * note 下書き自動化クライアント (非公式 API。canonical: docs/design/ai-studio-v2.md §8 /
 * docs/research/ai-studio-v2/note-posting.md — 実測仕様の正。厳密に従う)。
 *
 * 2 段階フロー (research §2 の DevTools 観測ベース):
 *   1) `POST /api/v1/text_notes` (title/body の最小ペイロード) → 記事 (下書き) の id を得る
 *   2) `POST /api/v1/text_notes/draft_save?id={id}&is_temp_saved=true` → 下書き保存を確定
 * 認証は Cookie セッション (`_note_session_v5` + `note_gql_auth_token`)。書き込み系は
 * `XSRF-TOKEN` cookie を URL デコードして `X-XSRF-TOKEN` ヘッダに載せる (research 実測)。
 * 見出し画像は `POST /api/v1/upload_image` (multipart) を試行し、失敗しても本文のみで
 * 下書き作成を続行する (§8: 「見出し画像のアップロードは試行し失敗したら本文のみで続行+警告」)。
 *
 * **公開はしない** — draft_save までで停止する (§8 の裁定通り。公開 API は本ファイルに実装しない)。
 *
 * 判断点 (research に確定仕様が無く、本実装で補った箇所。実運用開始前に DevTools での
 * 一次観測による検証が必須 — オーケストレーターへ報告済み):
 *   - 下書き編集 URL: `https://note.com/notes/{id}/edit` と仮定した (note の一般的な URL 体系
 *     からの推測。text_notes 作成応答の id/key のどちらを使うべきかは research に明記が無い)。
 *   - 下書き一覧 (unknown 時の同タイトル照合用) API: research に確定エンドポイントの記載が
 *     無いため、research が「別観測系統」として言及する `/api/v3/drafts` を用い、
 *     レスポンス形状は実測前提で防御的にパースする (想定と異なる形でも例外を投げず [] を返す)。
 *   - `X-Note-Client-Code` ヘッダ: research に「必須の系統あり」とあるが仕様不明のため未送信
 *     (無くても動く観測系統を前提とする。403 が頻発するようなら追加実装を検討すること)。
 */

const NOTE_BASE_URL = "https://note.com";
const REQUEST_TIMEOUT_MS = 15_000;

// research の note-mcp DISCLAIMER 準拠: 「10 req/分以下・自動連続投稿回避」。
// admin の手動クリック起点の単発下書き作成 (2〜4 リクエスト/回) を想定した自主規律であり、
// Vercel serverless の warm インスタンス内でのみ有効 (コールドスタートを跨いだ保証はない)。
const RATE_LIMIT_MAX_PER_WINDOW = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

export class NoteRateLimitError extends Error {
  constructor() {
    super("note API のレート制限 (10 req/分) を超えるため、しばらく待ってから再試行してください");
    this.name = "NoteRateLimitError";
  }
}

/** モジュールスコープの簡易スライディングウィンドウ (§8 レート規律) */
const requestTimestamps: number[] = [];

function assertRateLimit(): void {
  const now = Date.now();
  while (requestTimestamps.length > 0 && now - requestTimestamps[0] > RATE_LIMIT_WINDOW_MS) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= RATE_LIMIT_MAX_PER_WINDOW) {
    throw new NoteRateLimitError();
  }
  requestTimestamps.push(now);
}

/** テスト用: レート制限カウンタをリセットする (テスト間の汚染防止) */
export function resetNoteRateLimitForTest(): void {
  requestTimestamps.length = 0;
}

/** `XSRF-TOKEN` cookie の値を URL デコードして返す (research 実測: 書き込み系は X-XSRF-TOKEN ヘッダ必須) */
export function parseXsrfTokenFromCookie(cookieHeader: string): string | null {
  const match = cookieHeader.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function buildHeaders(cookieHeader: string, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    Cookie: cookieHeader,
    Accept: "application/json",
    ...extra,
  };
  const xsrf = parseXsrfTokenFromCookie(cookieHeader);
  if (xsrf) headers["X-XSRF-TOKEN"] = xsrf;
  return headers;
}

/** 判断点 (ファイル冒頭コメント参照): 下書き編集 URL の組み立て */
export function buildNoteDraftEditUrl(id: string): string {
  return `${NOTE_BASE_URL}/notes/${id}/edit`;
}

async function fetchNote(url: string, init: RequestInit): Promise<Response> {
  assertRateLimit();
  return fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

// ---------------------------------------------------------
// stage 1: 記事作成 (POST /api/v1/text_notes)
// ---------------------------------------------------------
async function createTextNote(cookieHeader: string, input: { title: string; bodyMd: string }): Promise<string> {
  const res = await fetchNote(`${NOTE_BASE_URL}/api/v1/text_notes`, {
    method: "POST",
    headers: buildHeaders(cookieHeader, { "Content-Type": "application/json" }),
    body: JSON.stringify({ name: input.title, body: input.bodyMd }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ConfirmedApiError(`note text_notes 作成エラー (status=${res.status}): ${detail}`, res.status);
  }
  const json = (await res.json().catch(() => ({}))) as {
    data?: { id?: number | string };
    id?: number | string;
  };
  const id = json.data?.id ?? json.id;
  if (id === undefined || id === null) {
    throw new ConfirmedApiError("note text_notes 作成応答に id がありません", res.status);
  }
  return String(id);
}

// ---------------------------------------------------------
// stage 2: 下書き保存確定 (POST /api/v1/text_notes/draft_save?id=&is_temp_saved=true)
// ---------------------------------------------------------
async function saveDraft(
  cookieHeader: string,
  id: string,
  input: { title: string; bodyMd: string; hashtags: string[] },
): Promise<void> {
  const url = new URL(`${NOTE_BASE_URL}/api/v1/text_notes/draft_save`);
  url.searchParams.set("id", id);
  url.searchParams.set("is_temp_saved", "true");

  const res = await fetchNote(url.toString(), {
    method: "POST",
    headers: buildHeaders(cookieHeader, { "Content-Type": "application/json" }),
    body: JSON.stringify({ name: input.title, body: input.bodyMd, hashtags: input.hashtags }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ConfirmedApiError(`note draft_save エラー (status=${res.status}): ${detail}`, res.status);
  }
}

// ---------------------------------------------------------
// 見出し画像アップロード (best effort。失敗しても呼び出し元は本文のみで続行する)
// ---------------------------------------------------------
async function uploadHeaderImage(cookieHeader: string, id: string, imageUrl: string): Promise<void> {
  // 画像の取得元は自サイト Storage (note.com ではない) のためレート制限の対象外・fetchNote は使わない
  const imageRes = await fetch(imageUrl, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!imageRes.ok) throw new Error(`見出し画像のダウンロードに失敗しました (status=${imageRes.status})`);
  const bytes = new Uint8Array(await imageRes.arrayBuffer());

  const form = new FormData();
  form.set("note_id", id);
  form.set("file", new Blob([bytes], { type: "image/jpeg" }), "eyecatch.jpg");

  const res = await fetchNote(`${NOTE_BASE_URL}/api/v1/upload_image`, {
    method: "POST",
    headers: buildHeaders(cookieHeader),
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ConfirmedApiError(`note upload_image エラー (status=${res.status}): ${detail}`, res.status);
  }
}

export type NoteDraftCreateInput = {
  title: string;
  bodyMd: string;
  hashtags: string[];
  /** 現状は常に null で呼ばれる (呼び出し元コメント参照)。将来 note に画像を持たせる拡張のための口 */
  headerImageUrl?: string | null;
};

/**
 * §8 MAJOR-3 の状態意味論そのものの表現:
 * - created: 成功 (draftId/url 確定)。headerImageWarning は見出し画像アップロードが
 *   失敗した場合のみ非 null (本文のみでの作成自体は成功扱い)
 * - failed: 明示的失敗。reason='session_invalid' (401/403 = Cookie 失効) と
 *   reason='api_error' (その他の確定エラー応答) を区別する
 * - unknown: タイムアウト/ネットワーク断等、note 側で実際に作成されたか判別不能
 */
export type NoteDraftOutcome =
  | { kind: "created"; draftId: string; url: string; headerImageWarning: string | null }
  | { kind: "failed"; reason: "session_invalid" | "api_error"; detail: string }
  | { kind: "unknown"; detail: string };

type ThrownClassification = { reason: "session_invalid" | "api_error" } | "unknown";

/**
 * ConfirmedApiError (HTTP 応答を受信できた確定エラー) は failed。
 * 401/403 は Cookie 失効として session_invalid に区別する (§8: 「401 (Cookie 失効) → failed」)。
 * fetch 自身が投げる例外 (AbortError=timeout, TypeError=ネットワーク断) や NoteRateLimitError
 * 以外の未知の例外は安全側 (unknown) — 「作成されたかもしれない」前提で下書き一覧照合に回す
 * (x-api.ts / publish-error-classify.ts と同じ流儀)。
 */
function classifyThrown(err: unknown): ThrownClassification {
  if (err instanceof ConfirmedApiError) {
    if (err.status === 401 || err.status === 403) return { reason: "session_invalid" };
    return { reason: "api_error" };
  }
  if (typeof DOMException !== "undefined" && err instanceof DOMException && err.name === "AbortError") {
    return "unknown"; // timeout
  }
  return "unknown"; // TypeError (ネットワーク断) 含む未知の例外全般
}

export async function createNoteDraft(cookieHeader: string, input: NoteDraftCreateInput): Promise<NoteDraftOutcome> {
  let id: string;
  try {
    id = await createTextNote(cookieHeader, { title: input.title, bodyMd: input.bodyMd });
  } catch (err) {
    if (err instanceof NoteRateLimitError) {
      return { kind: "failed", reason: "api_error", detail: err.message };
    }
    const detail = err instanceof Error ? err.message : String(err);
    const classified = classifyThrown(err);
    if (classified === "unknown") return { kind: "unknown", detail };
    return { kind: "failed", reason: classified.reason, detail };
  }

  try {
    await saveDraft(cookieHeader, id, { title: input.title, bodyMd: input.bodyMd, hashtags: input.hashtags });
  } catch (err) {
    if (err instanceof NoteRateLimitError) {
      return { kind: "failed", reason: "api_error", detail: err.message };
    }
    const detail = err instanceof Error ? err.message : String(err);
    // stage1 は成功済み (id 発行済み) のため、stage2 の応答不明は「作成されたかもしれない」
    // unknown として扱い、reconcileDraftByTitle での照合に委ねる (§8 MAJOR-3)。
    const classified = classifyThrown(err);
    if (classified === "unknown") return { kind: "unknown", detail };
    return { kind: "failed", reason: classified.reason, detail };
  }

  let headerImageWarning: string | null = null;
  if (input.headerImageUrl) {
    try {
      await uploadHeaderImage(cookieHeader, id, input.headerImageUrl);
    } catch (err) {
      headerImageWarning = `見出し画像のアップロードに失敗したため本文のみで下書きを作成しました: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  }

  return { kind: "created", draftId: id, url: buildNoteDraftEditUrl(id), headerImageWarning };
}

export type NoteDraftListItem = { id: string; title: string; url: string };

/** レスポンス形状が実測未確定のため防御的にパースする (ファイル冒頭コメント参照)。想定外の形は [] を返す */
function parseDraftListResponse(json: unknown): NoteDraftListItem[] {
  const candidates = extractArrayCandidate(json);
  const items: NoteDraftListItem[] = [];
  for (const raw of candidates) {
    if (typeof raw !== "object" || raw === null) continue;
    const record = raw as Record<string, unknown>;
    const idRaw = record.id ?? record.key ?? record.note_id;
    const titleRaw = record.name ?? record.title;
    if (idRaw === undefined || idRaw === null || typeof titleRaw !== "string") continue;
    items.push({ id: String(idRaw), title: titleRaw, url: buildNoteDraftEditUrl(String(idRaw)) });
  }
  return items;
}

function extractArrayCandidate(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json !== null && typeof json === "object") {
    const record = json as Record<string, unknown>;
    for (const key of ["data", "drafts", "notes", "items"]) {
      if (Array.isArray(record[key])) return record[key] as unknown[];
    }
  }
  return [];
}

/** §8 MAJOR-3: unknown 時の同タイトル照合用の下書き一覧取得。ハード失敗は例外を投げる (呼び出し元が best-effort で扱う) */
export async function listNoteDrafts(cookieHeader: string): Promise<NoteDraftListItem[]> {
  const res = await fetchNote(`${NOTE_BASE_URL}/api/v3/drafts`, {
    method: "GET",
    headers: buildHeaders(cookieHeader),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ConfirmedApiError(`note 下書き一覧取得エラー (status=${res.status}): ${detail}`, res.status);
  }
  const json = (await res.json().catch(() => null)) as unknown;
  return parseDraftListResponse(json);
}

/** 同タイトルの直近下書きを照合する (§8 MAJOR-3: unknown → created 昇格・重複防止) */
export async function reconcileDraftByTitle(cookieHeader: string, title: string): Promise<NoteDraftListItem | null> {
  const drafts = await listNoteDrafts(cookieHeader);
  return drafts.find((d) => d.title === title) ?? null;
}
