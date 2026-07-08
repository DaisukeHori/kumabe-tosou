import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 公開ページ (works/notes/blog/voices) が使う media 解決ヘルパー。
 *
 * media.storage_path は media-originals バケット内パス (原本) を指すが、
 * scripts/seed-from-legacy.ts の実装コメント通り、公開レンディション (WebP/JPEG) 生成は
 * Wave 1 の media モジュールでまだ実装されていないため、当面は同一 storage_path を
 * 公開 `media` バケットへコピーする代用実装になっている (seed-from-legacy.ts 参照)。
 * 本ヘルパーもこの規約 (同一パスを media バケットから配信) にあわせて公開 URL を組み立てる。
 * media モジュールが正式なレンディション命名規則を持つに至った場合はここを追随させる。
 */
export type PublicMediaRef = {
  id: string;
  url: string;
  alt: string;
  isPlaceholder: boolean;
};

type MediaRow = {
  id: string;
  storage_path: string;
  alt: string;
  is_placeholder: boolean;
};

export function toPublicMediaRef(
  client: SupabaseClient,
  row: MediaRow | null | undefined,
): PublicMediaRef | null {
  if (!row) return null;
  const { data } = client.storage.from("media").getPublicUrl(row.storage_path);
  return {
    id: row.id,
    url: data.publicUrl,
    alt: row.alt,
    isPlaceholder: row.is_placeholder,
  };
}
