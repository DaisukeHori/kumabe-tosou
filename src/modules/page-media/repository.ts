import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Result } from "@/modules/platform/contracts";
import type { KmbErrorCode } from "@/modules/platform/errors";

/**
 * page-media モジュールの repository (契約書 module-contracts.md §1「テーブルへの直接クエリは
 * 所有モジュールの repository のみ」に準じる — page_media は新モジュールとして同じ規律に従う)。
 * facade.ts のみがここを import する。
 *
 * client には用途に応じて anon client (公開/edit 読み取り。RLS: page_media_anon_select
 * using(true)) または admin セッション付きの server client (書き込み。RLS: is_admin()) を渡す。
 */

export type PageMediaResolvedRow = {
  slot_key: string;
  media_id: string | null;
  alt_override: string | null;
  media_alt: string | null;
};

type PgError = { code?: string; message: string };

function pgErrorToResult(error: PgError): { ok: false; code: KmbErrorCode; detail: string } {
  if (error.code === "42501") {
    return { ok: false, code: "KMB-E202", detail: error.message };
  }
  return { ok: false, code: "KMB-E901", detail: error.message };
}

/** page_media_resolved view (migration 20260709000013) を 1 SELECT で全行取得する */
export async function fetchResolvedRows(
  client: SupabaseClient,
): Promise<Result<PageMediaResolvedRow[]>> {
  const { data, error } = await client
    .from("page_media_resolved")
    .select("slot_key, media_id, alt_override, media_alt");
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data ?? []) as PageMediaResolvedRow[] };
}

/**
 * slot の画像を差し替える (media_id のみ upsert。既存の alt_override は保持する —
 * supabase-js の upsert は指定した列だけを ON CONFLICT DO UPDATE SET する)。
 */
export async function upsertSlot(
  client: SupabaseClient,
  slotKey: string,
  mediaId: string,
): Promise<Result<void>> {
  const { error } = await client
    .from("page_media")
    .upsert({ slot_key: slotKey, media_id: mediaId }, { onConflict: "slot_key" });
  if (error) return pgErrorToResult(error);
  return { ok: true, value: undefined };
}

/**
 * slot の alt_override を更新する (alt_override のみ upsert。既存の media_id は保持する)。
 * alt=null は「alt を自動決定 (media.alt / registry.altDefault) に戻す」を意味する。
 */
export async function updateSlotAlt(
  client: SupabaseClient,
  slotKey: string,
  alt: string | null,
): Promise<Result<void>> {
  const { error } = await client
    .from("page_media")
    .upsert({ slot_key: slotKey, alt_override: alt }, { onConflict: "slot_key" });
  if (error) return pgErrorToResult(error);
  return { ok: true, value: undefined };
}

/** slot を完全に既定へ戻す (page_media 行を削除。media_id/alt_override とも既定に復帰) */
export async function deleteSlot(client: SupabaseClient, slotKey: string): Promise<Result<void>> {
  const { error } = await client.from("page_media").delete().eq("slot_key", slotKey);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: undefined };
}

/**
 * page-text (ビジュアルテキストエディタ) の repository (canonical:
 * docs/design/visual-text-editor.md §1)。page_media と同じ規律 (facade.ts のみが
 * ここを import する) に従う。page_text は media との join が無いため view を経由せず
 * base table を直接 SELECT する (§1: 「view は作らない」)。
 */

export type PageTextRow = {
  slot_key: string;
  text_override: string;
};

/** page_text を 1 SELECT で全行取得する */
export async function fetchTextRows(client: SupabaseClient): Promise<Result<PageTextRow[]>> {
  const { data, error } = await client.from("page_text").select("slot_key, text_override");
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data ?? []) as PageTextRow[] };
}

/** slot のテキストを upsert する (差分のみ保持) */
export async function upsertText(
  client: SupabaseClient,
  slotKey: string,
  text: string,
): Promise<Result<void>> {
  const { error } = await client
    .from("page_text")
    .upsert({ slot_key: slotKey, text_override: text }, { onConflict: "slot_key" });
  if (error) return pgErrorToResult(error);
  return { ok: true, value: undefined };
}

/** slot を既定へ戻す (page_text 行を削除) */
export async function deleteText(client: SupabaseClient, slotKey: string): Promise<Result<void>> {
  const { error } = await client.from("page_text").delete().eq("slot_key", slotKey);
  if (error) return pgErrorToResult(error);
  return { ok: true, value: undefined };
}
