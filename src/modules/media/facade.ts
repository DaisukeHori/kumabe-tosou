import { randomUUID } from "node:crypto";

import { getEnv } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionAndClient } from "@/lib/supabase/session";
import type { Paged, Pagination, Result } from "@/modules/platform/contracts";

import { zMediaPatch, type MediaItem, type MediaPatch } from "./contracts";
import { processImageForRenditions, processImageToJpeg } from "./internal/image-processing";
import {
  buildPublicRenditionUrl,
  countMediaByPlaceholder,
  createSignedUploadUrl,
  deleteMediaRow,
  downloadOriginal,
  getMediaRow,
  getReferenceCount,
  getReferenceCounts,
  insertMediaRow,
  listMediaByTags,
  listMediaRows,
  patchMediaRow,
  removeOriginalAndRenditions,
  renditionExists,
  uploadRendition,
  type MediaRow,
} from "./repository";

/**
 * media モジュールの公開 facade (契約書 §5)。
 */
export interface MediaFacade {
  getPublicUrl(mediaId: string): Result<string>;
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
  patch(id: string, patch: MediaPatch): Promise<Result<void>>;
  /** 参照ゼロなら実削除 (Storage 含む)。参照ありは E301 */
  remove(id: string): Promise<Result<void>>;
  /** ダッシュボードの仮素材残数バッジ用 (設計書 §5.2 ダッシュボード) */
  countPlaceholders(): Promise<Result<number>>;
}

/**
 * public な "media" バケットのレンディションパス規約 (Wave 1-A で採用):
 * 常に `{mediaId}.webp` / `{mediaId}.jpg`。getPublicUrl(mediaId) が非同期 DB 参照
 * 無しで URL を構築できるようにするための決め (契約書 §5 の getPublicUrl が
 * 同期シグネチャのため)。
 *
 * (既知の乖離— オーケストレーターへ報告済み)
 * Wave 0 の scripts/seed-from-legacy.ts は暫定措置として元ファイル名をそのまま
 * "media" バケットにコピーしており、この規約に従っていない。そのため
 * legacy seed 由来の media 行に対して getPublicUrl() を呼ぶと 404 になる。
 * 本規約に合わせるには seed スクリプトの再実行 (レンディション再生成) が必要。
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
      const { webp, jpeg, width, height } = await processImageForRenditions(original);

      const mediaId = randomUUID();
      await uploadRendition(supabase, renditionPathFor(mediaId, "webp"), webp, "image/webp");
      await uploadRendition(supabase, renditionPathFor(mediaId, "jpg"), jpeg, "image/jpeg");

      await insertMediaRow(supabase, {
        id: mediaId,
        storagePath: input.storagePath,
        alt: input.alt,
        width,
        height,
        mimeType: "image/webp",
        credit: input.credit,
        isPlaceholder: input.isPlaceholder,
        tags: input.tags,
        createdBy: user.id,
      });

      const row = await getMediaRow(supabase, mediaId);
      if (!row) return { ok: false, code: "KMB-E901", detail: "作成直後の media 取得に失敗しました" };
      return { ok: true, value: toMediaItem(row, 0) };
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
