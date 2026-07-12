import { randomUUID } from "node:crypto";

import { getEnv } from "@/lib/env";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionAndClient } from "@/lib/supabase/session";
import type { Paged, Pagination, Result } from "@/modules/platform/contracts";

import { zMediaPatch, type MediaItem, type MediaPatch } from "./contracts";
import { processImageToJpeg } from "./internal/image-processing";
import { ingestMediaBuffer } from "./internal/media-ingest";
import {
  buildPublicRenditionUrl,
  countMediaByPlaceholder,
  createSignedUploadUrl,
  deleteMediaRow,
  downloadOriginal,
  getMediaRow,
  getReferenceCount,
  getReferenceCounts,
  listMediaByTags,
  listMediaRows,
  patchMediaRow,
  removeOriginalAndRenditions,
  removeOriginalBytes,
  renditionExists,
  uploadOriginalBytes,
  uploadRendition,
  type MediaRow,
} from "./repository";

/**
 * media モジュールの公開 facade (契約書 §5)。
 */
export interface MediaFacade {
  getPublicUrl(mediaId: string): Result<string>;
  /**
   * 公開 "media" バケットの JPEG レンディション決定論 URL ({mediaId}.jpg、契約外拡張。
   * 05-site-settings.md §4.2)。getPublicUrl (webp) と完全に同型の同期・DB 非依存メソッド。
   * 実体の存在保証はこの関数の責務ではない (呼び出し側 = updateSeoDefaultsAction が保存時に
   * getJpegRenditionUrl で ensure する。§4.2 注記どおり、既存の非同期 ensure 版とは別メソッドとして共存)。
   */
  getPublicJpegUrl(mediaId: string): Result<string>;
  /** IG 用。未生成なら生成 */
  getJpegRenditionUrl(mediaId: string): Promise<Result<string>>;
  /** ai-studio の画像候補提案用 */
  listByTags(tags: string[]): Promise<Result<MediaItem[]>>;
  /** 参照ゼロ検証 (E301) */
  assertDeletable(mediaId: string): Promise<Result<void>>;
}

export type MediaListItem = MediaItem & {
  credit: string | null;
  mimeType: string;
  createdAt: string;
  referenceCount: number;
};

export type CreateMediaUploadUrlInput = {
  filename: string;
  contentType: string;
  sizeBytes: number;
};

export type CompleteMediaUploadInput = {
  storagePath: string;
  alt: string;
  credit: string | null;
  tags: string[];
  isPlaceholder: boolean;
};

export type CreateMediaFromBytesInput = {
  bytes: Uint8Array;
  contentType: string;
  alt?: string;
  credit?: string;
  tags: string[];
  isPlaceholder?: boolean;
};

/**
 * §5 に明記の無い admin メディアライブラリ画面向けの拡張
 * (一覧・作成・編集・削除。module-contracts.md 未更新分 — オーケストレーターへ報告済み)。
 */
export interface MediaFacadeExtended extends MediaFacade {
  list(pagination: Pagination): Promise<Result<Paged<MediaListItem>>>;
  getById(id: string): Promise<Result<MediaListItem>>;
  createUploadUrl(
    input: CreateMediaUploadUrlInput,
  ): Promise<Result<{ uploadUrl: string; storagePath: string; token: string }>>;
  /** 署名付き URL への PUT 完了後に呼ぶ。原本 DL → sharp でレンディション生成 → DB 行作成 */
  completeUpload(input: CompleteMediaUploadInput): Promise<Result<MediaListItem>>;
  /**
   * 契約外拡張 (2026-07-10、ai-studio-v2.md P3 判断点・オーケストレーター指示。
   * 2026-07-10 Codex MAJOR 指摘反映: docs/module-contracts.md §MediaFacade / §4 の
   * canonical 定義に合わせ Result 返却に統一):
   * サーバ内で生成したバイト列 (AI 生成画像等) を直接 media として保存する。
   * completeUpload の「署名付き URL アップロード → クライアント PUT」を経由できない
   * サーバ内生成専用の経路。service role client で Storage 直アップロード + media 行
   * INSERT までを行う (呼び出し元にブラウザセッションが無い自動化コンテキストからも
   * 使えるようにするため)。他 facade メソッド同様 Result<T> で失敗を返す
   * (例外はモジュール境界を越えない)。Storage upload 成功後に DB insert が失敗した
   * 場合はアップロード済みの Storage オブジェクトを削除してから err を返す (orphan 防止)。
   */
  createFromBytes(
    input: CreateMediaFromBytesInput,
  ): Promise<Result<{ id: string; storagePath: string }>>;
  patch(id: string, patch: MediaPatch): Promise<Result<void>>;
  /** 参照ゼロなら実削除 (Storage 含む)。参照ありは E301 */
  remove(id: string): Promise<Result<void>>;
  /** ダッシュボードの仮素材残数バッジ用 (設計書 §5.2 ダッシュボード) */
  countPlaceholders(): Promise<Result<number>>;
}

/** image/jpeg → jpg 等、AI プロバイダの contentType から Storage 拡張子を推定する */
function extensionForContentType(contentType: string): string {
  const subtype = contentType.split("/")[1]?.split(";")[0]?.toLowerCase() ?? "bin";
  if (subtype === "jpeg") return "jpg";
  const safe = subtype.replace(/[^a-z0-9]/g, "");
  return safe || "bin";
}

/**
 * public な "media" バケットのレンディションパス規約 (Wave 1-A で採用):
 * 常に `{mediaId}.webp` / `{mediaId}.jpg`。getPublicUrl(mediaId) が非同期 DB 参照
 * 無しで URL を構築できるようにするための決め (契約書 §5 の getPublicUrl が
 * 同期シグネチャのため)。
 *
 * scripts/seed-from-legacy.ts もこの規約に従い `{id}.webp` / `{id}.jpg` を生成する
 * (seed-from-legacy.ts の seedMedia() 参照)。公開サイト側 (src/app/_lib/media.ts) の
 * toPublicMediaRef() もこの getPublicUrl() 経由の決定論 URL に統一済み
 * (docs/design/visual-media-editor.md §2.3、V0 hotfix)。
 */
function renditionPathFor(mediaId: string, ext: "webp" | "jpg"): string {
  return `${mediaId}.${ext}`;
}

function toMediaItem(row: MediaRow, referenceCount: number): MediaListItem {
  return {
    id: row.id,
    url: buildDeterministicPublicUrl(row.id),
    alt: row.alt,
    width: row.width,
    height: row.height,
    tags: row.tags,
    is_placeholder: row.is_placeholder,
    credit: row.credit,
    mimeType: row.mime_type,
    createdAt: row.created_at,
    referenceCount,
  };
}

function buildDeterministicPublicUrl(mediaId: string): string {
  const env = getEnv();
  const base = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
  return `${base}/storage/v1/object/public/media/${renditionPathFor(mediaId, "webp")}`;
}

/** getPublicUrl (webp) の JPEG 版。挙動を 1 文字も変えずに拡張子だけ差し替える (§4.2) */
function buildDeterministicPublicJpegUrl(mediaId: string): string {
  const env = getEnv();
  const base = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
  return `${base}/storage/v1/object/public/media/${renditionPathFor(mediaId, "jpg")}`;
}

function sanitizeFilenamePrefix(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "upload";
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100);
}

export const mediaFacade: MediaFacadeExtended = {
  getPublicUrl(mediaId) {
    try {
      return { ok: true, value: buildDeterministicPublicUrl(mediaId) };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  getPublicJpegUrl(mediaId) {
    try {
      return { ok: true, value: buildDeterministicPublicJpegUrl(mediaId) };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async getJpegRenditionUrl(mediaId) {
    try {
      const supabase = await createSupabaseServerClient();
      const path = renditionPathFor(mediaId, "jpg");
      const exists = await renditionExists(supabase, path);
      if (!exists) {
        const row = await getMediaRow(supabase, mediaId);
        if (!row) return { ok: false, code: "KMB-E901", detail: "media が見つかりません" };
        const original = await downloadOriginal(supabase, row.storage_path);
        const jpeg = await processImageToJpeg(original);
        await uploadRendition(supabase, path, jpeg, "image/jpeg");
      }
      return { ok: true, value: buildPublicRenditionUrl(supabase, path) };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async listByTags(tags) {
    try {
      const supabase = await createSupabaseServerClient();
      const rows = await listMediaByTags(supabase, tags);
      const counts = await getReferenceCounts(supabase, rows.map((r) => r.id));
      return { ok: true, value: rows.map((r) => toMediaItem(r, counts[r.id] ?? 0)) };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async assertDeletable(mediaId) {
    try {
      const supabase = await createSupabaseServerClient();
      const count = await getReferenceCount(supabase, mediaId);
      if (count > 0) return { ok: false, code: "KMB-E301", detail: `参照件数: ${count}` };
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async list(pagination) {
    try {
      const supabase = await createSupabaseServerClient();
      const { items, nextCursor } = await listMediaRows(supabase, pagination);
      const counts = await getReferenceCounts(supabase, items.map((r) => r.id));
      return {
        ok: true,
        value: {
          items: items.map((r) => toMediaItem(r, counts[r.id] ?? 0)),
          next_cursor: nextCursor,
        },
      };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async getById(id) {
    try {
      const supabase = await createSupabaseServerClient();
      const row = await getMediaRow(supabase, id);
      if (!row) return { ok: false, code: "KMB-E901", detail: "media が見つかりません" };
      const count = await getReferenceCount(supabase, id);
      return { ok: true, value: toMediaItem(row, count) };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async createUploadUrl(input) {
    try {
      // クライアント側の事前検証 (src/app/admin/media/media-grid.tsx の MAX_UPLOAD_BYTES) と同基準。
      // 変更する場合は両方を更新すること。
      if (input.sizeBytes > 10 * 1024 * 1024) {
        return { ok: false, code: "KMB-E302", detail: "10MB を超えています" };
      }
      if (!input.contentType.startsWith("image/")) {
        return { ok: false, code: "KMB-E302", detail: "画像形式のみアップロードできます" };
      }

      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const storagePath = `${randomUUID()}-${sanitizeFilenamePrefix(input.filename)}`;
      const { uploadUrl, token } = await createSignedUploadUrl(supabase, storagePath);
      return { ok: true, value: { uploadUrl, storagePath, token } };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async completeUpload(input) {
    try {
      const parsedPatch = zMediaPatch.safeParse({
        alt: input.alt,
        tags: input.tags,
        is_placeholder: input.isPlaceholder,
      });
      if (!parsedPatch.success) {
        return { ok: false, code: "KMB-E101", detail: parsedPatch.error.message };
      }

      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const original = await downloadOriginal(supabase, input.storagePath);
      const { id: mediaId } = await ingestMediaBuffer(supabase, original, {
        storagePath: input.storagePath,
        alt: input.alt,
        credit: input.credit,
        tags: input.tags,
        isPlaceholder: input.isPlaceholder,
        createdBy: user.id,
      });

      const row = await getMediaRow(supabase, mediaId);
      if (!row) return { ok: false, code: "KMB-E901", detail: "作成直後の media 取得に失敗しました" };
      return { ok: true, value: toMediaItem(row, 0) };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async createFromBytes(input) {
    try {
      const serviceClient = createSupabaseServiceClient();
      const buffer = Buffer.from(input.bytes);
      const ext = extensionForContentType(input.contentType);
      const storagePath = `ai-generated/${randomUUID()}.${ext}`;

      try {
        await uploadOriginalBytes(serviceClient, storagePath, buffer, input.contentType);
      } catch (err) {
        return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
      }

      try {
        const { id } = await ingestMediaBuffer(serviceClient, buffer, {
          storagePath,
          alt: input.alt ?? "",
          credit: input.credit ?? null,
          tags: input.tags,
          isPlaceholder: input.isPlaceholder ?? false,
          createdBy: null,
        });
        return { ok: true, value: { id, storagePath } };
      } catch (err) {
        // DB insert (またはレンディションアップロード) 失敗。レンディションは
        // ingestMediaBuffer 内で自己クリーンアップ済みのため、ここでは既に
        // アップロード済みの原本のみ削除して orphan を残さない。
        await removeOriginalBytes(serviceClient, storagePath);
        return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
      }
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async patch(id, patch) {
    try {
      const parsed = zMediaPatch.safeParse(patch);
      if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const updated = await patchMediaRow(supabase, id, parsed.data);
      if (!updated) return { ok: false, code: "KMB-E901", detail: "media が見つかりません" };
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async remove(id) {
    try {
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const before = await getReferenceCount(supabase, id);
      if (before > 0) return { ok: false, code: "KMB-E301", detail: `参照件数: ${before}` };

      const result = await deleteMediaRow(supabase, id);
      if (!result.existedBefore) {
        return { ok: false, code: "KMB-E901", detail: "media が見つかりません" };
      }
      if (!result.deleted) {
        // RLS (media_admin_delete) が参照ありと判定してブロックしたケース
        // (before チェックと DELETE の間の競合を含む)
        return { ok: false, code: "KMB-E301" };
      }
      if (result.storagePath) {
        await removeOriginalAndRenditions(supabase, result.storagePath, id);
      }
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async countPlaceholders() {
    try {
      const supabase = await createSupabaseServerClient();
      const count = await countMediaByPlaceholder(supabase, true);
      return { ok: true, value: count };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },
};
