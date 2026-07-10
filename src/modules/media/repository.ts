import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Pagination } from "@/modules/platform/contracts";

export type MediaRow = {
  id: string;
  storage_path: string;
  alt: string;
  width: number;
  height: number;
  mime_type: string;
  credit: string | null;
  is_placeholder: boolean;
  tags: string[];
  created_by: string | null;
  created_at: string;
};

type Supa = Awaited<ReturnType<typeof createSupabaseServerClient>>;

const MEDIA_SELECT = "id, storage_path, alt, width, height, mime_type, credit, is_placeholder, tags, created_by, created_at";

/** keyset ページネーション (created_at desc, id desc)。admin 一覧 50 件/頁 (設計書 §2.4) */
export async function listMediaRows(
  supabase: Supa,
  pagination: Pagination,
): Promise<{ items: MediaRow[]; nextCursor: string | null }> {
  const limit = pagination.limit;
  let query = supabase
    .from("media")
    .select(MEDIA_SELECT)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (pagination.cursor) {
    const decoded = decodeCursor(pagination.cursor);
    if (decoded) {
      query = query.or(
        `created_at.lt.${decoded.createdAt},and(created_at.eq.${decoded.createdAt},id.lt.${decoded.id})`,
      );
    }
  }

  const { data, error } = await query;
  if (error) throw new Error(`media 一覧取得に失敗しました: ${error.message}`);

  const rows = (data ?? []) as MediaRow[];
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.created_at, last.id) : null;

  return { items, nextCursor };
}

export async function getMediaRow(supabase: Supa, id: string): Promise<MediaRow | null> {
  const { data, error } = await supabase.from("media").select(MEDIA_SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(`media 取得に失敗しました (${id}): ${error.message}`);
  return data ?? null;
}

export async function countMediaByPlaceholder(supabase: Supa, isPlaceholder: boolean): Promise<number> {
  const { count, error } = await supabase
    .from("media")
    .select("id", { count: "exact", head: true })
    .eq("is_placeholder", isPlaceholder);
  if (error) throw new Error(`media 件数取得に失敗しました: ${error.message}`);
  return count ?? 0;
}

export async function listMediaByTags(supabase: Supa, tags: string[]): Promise<MediaRow[]> {
  const { data, error } = await supabase.from("media").select(MEDIA_SELECT).overlaps("tags", tags);
  if (error) throw new Error(`media タグ検索に失敗しました: ${error.message}`);
  return (data ?? []) as MediaRow[];
}

export async function insertMediaRow(
  supabase: Supa,
  row: {
    id: string;
    storagePath: string;
    alt: string;
    width: number;
    height: number;
    mimeType: string;
    credit: string | null;
    isPlaceholder: boolean;
    tags: string[];
    createdBy: string | null;
  },
): Promise<void> {
  const { error } = await supabase.from("media").insert({
    id: row.id,
    storage_path: row.storagePath,
    alt: row.alt,
    width: row.width,
    height: row.height,
    mime_type: row.mimeType,
    credit: row.credit,
    is_placeholder: row.isPlaceholder,
    tags: row.tags,
    created_by: row.createdBy,
  });
  if (error) throw new Error(`media INSERT に失敗しました (${row.storagePath}): ${error.message}`);
}

export async function patchMediaRow(
  supabase: Supa,
  id: string,
  patch: Partial<{ alt: string; tags: string[]; is_placeholder: boolean }>,
): Promise<boolean> {
  const { data, error } = await supabase.from("media").update(patch).eq("id", id).select("id").maybeSingle();
  if (error) throw new Error(`media 更新に失敗しました (${id}): ${error.message}`);
  return Boolean(data);
}

/**
 * RLS (media_admin_delete) が参照ゼロ (work_images/works.cover/posts.cover/voices.photo/
 * site_settings) を USING 句で検証するため、削除の可否そのものは DB が判定する。
 * ここでは「削除試行 → 実際に消えたか」を報告するのみ。
 */
export async function deleteMediaRow(
  supabase: Supa,
  id: string,
): Promise<{ deleted: boolean; existedBefore: boolean; storagePath: string | null }> {
  const existing = await getMediaRow(supabase, id);
  if (!existing) return { deleted: false, existedBefore: false, storagePath: null };

  const { data, error } = await supabase.from("media").delete().eq("id", id).select("id").maybeSingle();
  if (error) throw new Error(`media 削除に失敗しました (${id}): ${error.message}`);

  return { deleted: Boolean(data), existedBefore: true, storagePath: existing.storage_path };
}

/** media_reference_summary view (migration 20260708000008) から参照件数を取得 */
export async function getReferenceCount(supabase: Supa, mediaId: string): Promise<number> {
  const { data, error } = await supabase
    .from("media_reference_summary")
    .select("reference_count")
    .eq("media_id", mediaId)
    .maybeSingle();
  if (error) throw new Error(`media_reference_summary 取得に失敗しました (${mediaId}): ${error.message}`);
  return data?.reference_count ?? 0;
}

export async function getReferenceCounts(
  supabase: Supa,
  mediaIds: string[],
): Promise<Record<string, number>> {
  if (mediaIds.length === 0) return {};
  const { data, error } = await supabase
    .from("media_reference_summary")
    .select("media_id, reference_count")
    .in("media_id", mediaIds);
  if (error) throw new Error(`media_reference_summary 一括取得に失敗しました: ${error.message}`);
  const map: Record<string, number> = {};
  for (const row of data ?? []) {
    map[row.media_id as string] = row.reference_count as number;
  }
  return map;
}

// ---------------------------------------------------------
// Storage
// ---------------------------------------------------------

const MEDIA_ORIGINALS_BUCKET = "media-originals";
const MEDIA_PUBLIC_BUCKET = "media";

export async function createSignedUploadUrl(
  supabase: Supa,
  storagePath: string,
): Promise<{ uploadUrl: string; token: string }> {
  const { data, error } = await supabase.storage
    .from(MEDIA_ORIGINALS_BUCKET)
    .createSignedUploadUrl(storagePath);
  if (error || !data) {
    throw new Error(`署名付きアップロード URL の発行に失敗しました (${storagePath}): ${error?.message}`);
  }
  return { uploadUrl: data.signedUrl, token: data.token };
}

export async function downloadOriginal(supabase: Supa, storagePath: string): Promise<Buffer> {
  const { data, error } = await supabase.storage.from(MEDIA_ORIGINALS_BUCKET).download(storagePath);
  if (error || !data) {
    throw new Error(`原本のダウンロードに失敗しました (${storagePath}): ${error?.message}`);
  }
  return Buffer.from(await data.arrayBuffer());
}

/**
 * サーバ内で生成したバイト列を原本として直接アップロードする (createFromBytes 用)。
 * 通常のクライアントアップロードは createSignedUploadUrl → クライアント PUT の 2 段だが、
 * AI 生成画像等サーバ内で完結する経路はこちらを使う (署名付き URL を経由しない)。
 */
export async function uploadOriginalBytes(
  supabase: Supa,
  storagePath: string,
  bytes: Buffer,
  contentType: string,
): Promise<void> {
  const { error } = await supabase.storage
    .from(MEDIA_ORIGINALS_BUCKET)
    .upload(storagePath, bytes, { contentType, upsert: false });
  if (error) throw new Error(`原本のアップロードに失敗しました (${storagePath}): ${error.message}`);
}

export async function uploadRendition(
  supabase: Supa,
  renditionPath: string,
  bytes: Buffer,
  contentType: string,
): Promise<void> {
  const { error } = await supabase.storage
    .from(MEDIA_PUBLIC_BUCKET)
    .upload(renditionPath, bytes, { contentType, upsert: true });
  if (error) throw new Error(`レンディションのアップロードに失敗しました (${renditionPath}): ${error.message}`);
}

export function buildPublicRenditionUrl(supabase: Supa, renditionPath: string): string {
  const { data } = supabase.storage.from(MEDIA_PUBLIC_BUCKET).getPublicUrl(renditionPath);
  return data.publicUrl;
}

/**
 * "media" バケットは公開 URL 配信専用であり、一覧列挙 (`.list()`) を防ぐため
 * anon/admin いずれの SELECT RLS ポリシーも意図的に外されている
 * (migration 20260708000006_security_advisor_fixes.sql、設計書 §3.4「一覧不可」)。
 * そのため存在確認は `.list()` (RLS 経由の SELECT) ではなく、公開バケットの
 * 直接ダウンロードエンドポイントへの HEAD リクエストで行う (RLS を経由しない)。
 */
export async function renditionExists(supabase: Supa, renditionPath: string): Promise<boolean> {
  const url = buildPublicRenditionUrl(supabase, renditionPath);
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

export async function removeOriginalAndRenditions(
  supabase: Supa,
  storagePath: string,
  mediaId: string,
): Promise<void> {
  await supabase.storage.from(MEDIA_ORIGINALS_BUCKET).remove([storagePath]);
  await supabase.storage.from(MEDIA_PUBLIC_BUCKET).remove([`${mediaId}.webp`, `${mediaId}.jpg`]);
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt, id }), "utf-8").toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf-8");
    const parsed = JSON.parse(json) as { createdAt?: string; id?: string };
    if (!parsed.createdAt || !parsed.id) return null;
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return null;
  }
}
