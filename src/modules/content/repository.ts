import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Result } from "@/modules/platform/contracts";
import type { KmbErrorCode } from "@/modules/platform/errors";

import { decodeCursor, encodeCursor } from "./internal/pagination";

/**
 * content モジュールの repository。works / work_images / posts / voices への
 * 唯一の直接クエリ経路 (module-contracts.md §1「テーブルへの直接クエリは所有モジュールの
 * repository のみ」)。facade.ts のみがここを import する。
 *
 * client には admin セッション付きの @supabase/ssr server client を渡す (RLS で認可)。
 * work_images への書込のみ、RLS 上ポリシーが一切無く service client 専用のため、
 * 該当関数は serviceClient を別引数で受け取る (cms-ai-pipeline.md §3.2 の work_images 注記)。
 */

// ---- DB 行の生の型 (DDL 1:1。cms-ai-pipeline.md §2.2) ----

export type WorkRow = {
  id: string;
  slug: string;
  title: string;
  category: string;
  body: string;
  process_note: string | null;
  cover_media_id: string | null;
  status: string;
  published_at: string | null;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type PostRow = {
  id: string;
  slug: string;
  kind: string;
  title: string;
  excerpt: string;
  body: string;
  cover_media_id: string | null;
  status: string;
  published_at: string | null;
  source_run_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type VoiceRow = {
  id: string;
  customer_initial: string;
  region: string;
  rating: number;
  body: string;
  item: string | null;
  photo_media_id: string | null;
  status: string;
  published_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type Table = "works" | "posts" | "voices";

type PgError = { code?: string; message: string };

function pgErrorToResult(error: PgError): { ok: false; code: KmbErrorCode; detail: string } {
  if (error.code === "23505") {
    return { ok: false, code: "KMB-E102", detail: error.message };
  }
  if (error.code === "23503") {
    return { ok: false, code: "KMB-E101", detail: `参照先が存在しません: ${error.message}` };
  }
  if (error.code === "42501") {
    return { ok: false, code: "KMB-E202", detail: error.message };
  }
  return { ok: false, code: "KMB-E901", detail: error.message };
}

// ---- 一覧・keyset ページネーション ----

const SEARCH_COLUMNS: Record<Table, string[]> = {
  works: ["title", "slug", "category"],
  posts: ["title", "slug", "excerpt"],
  voices: ["customer_initial", "region", "body"],
};

function escapeIlike(value: string): string {
  // PostgREST の ilike パターン内でワイルドカード解釈されないようエスケープする
  return value.replace(/[%_\\]/g, (c) => `\\${c}`);
}

export type ListFilter = {
  status?: string;
  kind?: string; // posts のみ
  search?: string;
  cursor: string | null;
  limit: number;
};

export type ListResult<Row> = { rows: Row[]; nextCursor: string | null };

async function listRows<Row extends { id: string; created_at: string }>(
  client: SupabaseClient,
  table: Table,
  filter: ListFilter,
): Promise<Result<ListResult<Row>>> {
  let query = client
    .from(table)
    .select("*")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(filter.limit + 1);

  if (filter.status) query = query.eq("status", filter.status);
  if (filter.kind) query = query.eq("kind", filter.kind);
  if (filter.search) {
    const escaped = escapeIlike(filter.search);
    const orExpr = SEARCH_COLUMNS[table].map((col) => `${col}.ilike.%${escaped}%`).join(",");
    query = query.or(orExpr);
  }
  const cursor = decodeCursor(filter.cursor);
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await query;
  if (error) return pgErrorToResult(error);

  const rows = (data ?? []) as unknown as Row[];
  const hasMore = rows.length > filter.limit;
  const page = hasMore ? rows.slice(0, filter.limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null;
  return { ok: true, value: { rows: page, nextCursor } };
}

export async function listWorksAdmin(
  client: SupabaseClient,
  filter: ListFilter,
): Promise<Result<ListResult<WorkRow>>> {
  return listRows<WorkRow>(client, "works", filter);
}

export async function listPostsAdmin(
  client: SupabaseClient,
  filter: ListFilter,
): Promise<Result<ListResult<PostRow>>> {
  return listRows<PostRow>(client, "posts", filter);
}

export async function listVoicesAdmin(
  client: SupabaseClient,
  filter: ListFilter,
): Promise<Result<ListResult<VoiceRow>>> {
  return listRows<VoiceRow>(client, "voices", filter);
}

/** 公開一覧 (site-public も使う read)。status='published' and published_at<=now() は RLS が保証する */
export async function listPublishedRows<Row extends { id: string; created_at: string }>(
  client: SupabaseClient,
  table: Table,
  kind: string | null,
  pagination: { cursor: string | null; limit: number },
): Promise<Result<ListResult<Row>>> {
  return listRows<Row>(client, table, {
    status: "published",
    kind: kind ?? undefined,
    cursor: pagination.cursor,
    limit: pagination.limit,
  });
}

// ---- 単票取得 ----

export async function getByIdAdmin<Row>(
  client: SupabaseClient,
  table: Table,
  id: string,
): Promise<Result<Row | null>> {
  const { data, error } = await client.from(table).select("*").eq("id", id).maybeSingle();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data as Row | null) ?? null };
}

export async function getPublishedBySlug<Row>(
  client: SupabaseClient,
  table: Table,
  kind: string | null,
  slug: string,
): Promise<Result<Row | null>> {
  let query = client
    .from(table)
    .select("*")
    .eq("slug", slug)
    .eq("status", "published")
    .lte("published_at", new Date().toISOString());
  if (kind) query = query.eq("kind", kind);
  const { data, error } = await query.maybeSingle();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data as Row | null) ?? null };
}

// ---- work_images (junction table。RLS ポリシー無し。読み取りは server client、書込は service client 専用) ----

export type WorkImageRow = { work_id: string; media_id: string; sort_order: number };

export async function listWorkImages(
  client: SupabaseClient,
  workId: string,
): Promise<Result<string[]>> {
  const { data, error } = await client
    .from("work_images")
    .select("media_id, sort_order")
    .eq("work_id", workId)
    .order("sort_order", { ascending: true });
  if (error) return pgErrorToResult(error);
  return { ok: true, value: (data ?? []).map((r) => r.media_id as string) };
}

/**
 * work_images を丸ごと入れ替える (削除→挿入)。RLS 上 admin/anon 双方に書込ポリシーが無いため
 * 必ず service client を渡す (cms-ai-pipeline.md §3.2 の work_images 注記、Wave1-B 実装指示)。
 */
export async function replaceWorkImages(
  serviceClient: SupabaseClient,
  workId: string,
  mediaIds: string[],
): Promise<Result<void>> {
  const { error: delError } = await serviceClient.from("work_images").delete().eq("work_id", workId);
  if (delError) return pgErrorToResult(delError);

  if (mediaIds.length === 0) return { ok: true, value: undefined };

  const rows: WorkImageRow[] = mediaIds.map((mediaId, index) => ({
    work_id: workId,
    media_id: mediaId,
    sort_order: index,
  }));
  const { error: insError } = await serviceClient.from("work_images").insert(rows);
  if (insError) return pgErrorToResult(insError);
  return { ok: true, value: undefined };
}

// ---- works ----

export type WorkWriteInput = {
  slug: string;
  title: string;
  category: string;
  body: string;
  process_note: string | null;
  cover_media_id: string | null;
  sort_order: number;
};

export async function insertWork(
  client: SupabaseClient,
  input: WorkWriteInput,
): Promise<Result<WorkRow>> {
  const { data, error } = await client.from("works").insert(input).select("*").single();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: data as WorkRow };
}

export async function updateWorkFields(
  client: SupabaseClient,
  id: string,
  input: WorkWriteInput,
  expectedUpdatedAt: string,
): Promise<Result<WorkRow>> {
  return updateWithOptimisticLock<WorkRow>(client, "works", id, input, expectedUpdatedAt);
}

// ---- posts ----

export type PostWriteInput = {
  slug: string;
  kind: string;
  title: string;
  excerpt: string;
  body: string;
  cover_media_id: string | null;
};

export async function insertPost(
  client: SupabaseClient,
  input: PostWriteInput,
): Promise<Result<PostRow>> {
  const { data, error } = await client.from("posts").insert(input).select("*").single();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: data as PostRow };
}

export async function updatePostFields(
  client: SupabaseClient,
  id: string,
  input: PostWriteInput,
  expectedUpdatedAt: string,
): Promise<Result<PostRow>> {
  return updateWithOptimisticLock<PostRow>(client, "posts", id, input, expectedUpdatedAt);
}

/** ContentFacade.createBlogPostFromDraft 用: 承認済み AI 生成物からの公開済み post 作成 */
export async function insertPublishedBlogPost(
  client: SupabaseClient,
  input: {
    slug: string;
    title: string;
    excerpt: string;
    body: string;
    cover_media_id: string | null;
    source_run_id: string;
  },
): Promise<Result<PostRow>> {
  const { data, error } = await client
    .from("posts")
    .insert({
      slug: input.slug,
      kind: "blog",
      title: input.title,
      excerpt: input.excerpt,
      body: input.body,
      cover_media_id: input.cover_media_id,
      source_run_id: input.source_run_id,
      status: "published",
      published_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: data as PostRow };
}

// ---- voices ----

export type VoiceWriteInput = {
  customer_initial: string;
  region: string;
  rating: number;
  body: string;
  item: string | null;
  photo_media_id: string | null;
  sort_order: number;
};

export async function insertVoice(
  client: SupabaseClient,
  input: VoiceWriteInput,
): Promise<Result<VoiceRow>> {
  const { data, error } = await client.from("voices").insert(input).select("*").single();
  if (error) return pgErrorToResult(error);
  return { ok: true, value: data as VoiceRow };
}

export async function updateVoiceFields(
  client: SupabaseClient,
  id: string,
  input: VoiceWriteInput,
  expectedUpdatedAt: string,
): Promise<Result<VoiceRow>> {
  return updateWithOptimisticLock<VoiceRow>(client, "voices", id, input, expectedUpdatedAt);
}

// ---- 楽観的排他つき共通 UPDATE (KMB-E103) ----

async function updateWithOptimisticLock<Row extends { updated_at: string }>(
  client: SupabaseClient,
  table: Table,
  id: string,
  input: Record<string, unknown>,
  expectedUpdatedAt: string,
): Promise<Result<Row>> {
  const { data, error } = await client
    .from(table)
    .update(input)
    .eq("id", id)
    .eq("updated_at", expectedUpdatedAt)
    .select("*")
    .maybeSingle();
  if (error) return pgErrorToResult(error);
  if (data) return { ok: true, value: data as Row };

  // 0 行更新: 対象が存在しない (削除済み) か、他者更新による楽観排他失敗かを判別する
  const { data: current, error: fetchError } = await client
    .from(table)
    .select("updated_at")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) return pgErrorToResult(fetchError);
  if (!current) {
    return { ok: false, code: "KMB-E901", detail: "更新対象が見つかりません (削除された可能性があります)" };
  }
  return {
    ok: false,
    code: "KMB-E103",
    detail: "他の人がこの内容を更新しています。最新の内容を確認してください。",
  };
}

// ---- 状態遷移 ----

export async function updateStatusFields(
  client: SupabaseClient,
  table: Table,
  id: string,
  status: string,
  publishedAt: string | null,
  expectedUpdatedAt: string,
): Promise<Result<{ updated_at: string; published_at: string | null }>> {
  const result = await updateWithOptimisticLock<{ updated_at: string; published_at: string | null }>(
    client,
    table,
    id,
    { status, published_at: publishedAt },
    expectedUpdatedAt,
  );
  if (!result.ok) return result;
  return {
    ok: true,
    value: { updated_at: result.value.updated_at, published_at: result.value.published_at },
  };
}

export { pgErrorToResult };
