"use server";

import { getErrorInfo } from "@/modules/platform/errors";
import { platformFacade } from "@/modules/platform/facade";
import { mediaFacade } from "@/modules/media/facade";

import type { PickerMediaItem } from "./media-picker-data";

export type ListMediaForPickerResult = {
  items: PickerMediaItem[];
  nextCursor: string | null;
  error: string | null;
};

/**
 * media-picker ダイアログの「もっと見る」用。初期一覧は各 admin ページ (Server Component)
 * が MediaFacade (list) を直接呼んで渡すが、追加ページの取得はこの Server Action 経由にする。
 */
export async function listMediaForPickerAction(cursor: string | null): Promise<ListMediaForPickerResult> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { items: [], nextCursor: null, error: getErrorInfo(admin.code).message };

  const result = await mediaFacade.list({ cursor, limit: 60 });
  if (!result.ok) return { items: [], nextCursor: null, error: result.detail ?? getErrorInfo(result.code).message };

  return {
    items: result.value.items.map((item) => ({
      id: item.id,
      url: item.url,
      alt: item.alt,
      is_placeholder: item.is_placeholder,
    })),
    nextCursor: result.value.next_cursor,
    error: null,
  };
}
