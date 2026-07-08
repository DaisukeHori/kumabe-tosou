import "server-only";

import { mediaFacade, type MediaListItem } from "@/modules/media/facade";

/**
 * media-picker (ビジュアルなメディア選択ダイアログ) が使う一覧アイテムの最小形。
 * MediaFacade (Wave1-A で list/getById/getPublicUrl 実装済み) をそのまま利用する。
 */
export type PickerMediaItem = Pick<MediaListItem, "id" | "url" | "alt" | "is_placeholder">;

function toPickerItem(item: MediaListItem): PickerMediaItem {
  return { id: item.id, url: item.url, alt: item.alt, is_placeholder: item.is_placeholder };
}

export async function listMediaForPicker(
  limit = 100,
): Promise<{ items: PickerMediaItem[]; nextCursor: string | null }> {
  const result = await mediaFacade.list({ cursor: null, limit });
  if (!result.ok) return { items: [], nextCursor: null };
  return {
    items: result.value.items.map(toPickerItem),
    nextCursor: result.value.next_cursor,
  };
}

/**
 * 編集画面初期表示時、既に選択済みの media (cover_media_id / image_ids) が
 * 一覧の取得件数 (limit) の外に居ても必ずサムネイル表示できるよう、
 * 一覧に含まれていない選択済み id を個別に取得して補完する。
 */
export async function ensureMediaItems(
  items: PickerMediaItem[],
  ids: Array<string | null | undefined>,
): Promise<PickerMediaItem[]> {
  const known = new Set(items.map((item) => item.id));
  const missing = Array.from(
    new Set(ids.filter((id): id is string => Boolean(id) && !known.has(id as string))),
  );
  if (missing.length === 0) return items;

  const fetched = await Promise.all(missing.map((id) => mediaFacade.getById(id)));
  const extra = fetched
    .filter((result): result is { ok: true; value: MediaListItem } => result.ok)
    .map((result) => toPickerItem(result.value));

  return [...items, ...extra];
}
