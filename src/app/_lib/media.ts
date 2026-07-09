import { mediaFacade } from "@/modules/media/facade";

/**
 * 公開ページ (works/notes/blog/voices) が使う media 解決ヘルパー。
 *
 * media バケットの公開レンディションは常に `{media_id}.webp` (決定論 URL)。
 * これは `src/modules/media/facade.ts` の getPublicUrl() と同一規約であり、
 * 本ヘルパーも同じ規約で URL を組み立てる (mediaFacade 経由、_lib → facade の import は
 * モジュール境界上 OK)。
 *
 * (V0 hotfix — 2026-07-09 本番実測に基づく訂正)
 * 旧実装は `media.storage_path` を使って Supabase Storage クライアントの
 * `getPublicUrl(storage_path)` で URL を組み立てていたが、"media" バケットには
 * storage_path 名のオブジェクトは存在せず (`{id}.webp` / `{id}.jpg` のみ存在)、
 * 本番 HTTP 実測でも storage_path 直の URL は 400 だった (実バグ)。
 * `{id}.webp` は全 media 行に存在するため、決定論 URL への統一で解消する
 * (docs/design/visual-media-editor.md §2.3)。
 */
export type PublicMediaRef = {
  id: string;
  url: string;
  alt: string;
  isPlaceholder: boolean;
};

type MediaRow = {
  id: string;
  alt: string;
  is_placeholder: boolean;
};

export function toPublicMediaRef(row: MediaRow | null | undefined): PublicMediaRef | null {
  if (!row) return null;
  const result = mediaFacade.getPublicUrl(row.id);
  if (!result.ok) {
    throw new Error(
      `[toPublicMediaRef] media (${row.id}) の公開 URL 生成に失敗しました: ${result.detail ?? result.code}`,
    );
  }
  return {
    id: row.id,
    url: result.value,
    alt: row.alt,
    isPlaceholder: row.is_placeholder,
  };
}
