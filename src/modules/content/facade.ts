import "server-only";

import { revalidateTag } from "next/cache";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { Paged, Pagination, Result } from "@/modules/platform/contracts";

import type {
  AdminListParams,
  AdminPost,
  AdminVoice,
  AdminWork,
  BlogPostContent,
  ContentKind,
  ContentStatus,
  PostInput,
  PostKind,
  PublishedItem,
  StatusTransition,
  VoiceInput,
  WorkInput,
} from "./contracts";
import { generateFallbackSlug } from "./internal/slug";
import { guardTransition } from "./internal/state-machine";
import * as repo from "./repository";
import type { PostRow, Table, VoiceRow, WorkRow } from "./repository";

/**
 * content モジュールの公開 facade (契約書 §5)。
 *
 * canonical (module-contracts.md §5): createBlogPostFromDraft / publish / listPublished / getBySlug。
 * それ以外の admin CRUD 系メソッドは Wave1-B での拡張 (contracts.ts の admin 拡張コメント参照。
 * 要 module-contracts.md 追認)。
 */
export interface ContentFacade {
  createBlogPostFromDraft(
    input: BlogPostContent & { source_run_id: string },
  ): Promise<Result<{ post_id: string; slug: string }>>;
  publish(kind: PostKind | "work" | "voice", id: string, publishedAt?: Date): Promise<Result<void>>;
  listPublished<K extends ContentKind>(
    kind: K,
    page: Pagination,
  ): Promise<Result<Paged<PublishedItem<K>>>>;
  getBySlug<K extends ContentKind>(kind: K, slug: string): Promise<Result<PublishedItem<K> | null>>;

  // ---- admin CRUD 拡張 ----
  listWorksAdmin(params: AdminListParams): Promise<Result<Paged<AdminWork>>>;
  getWorkAdmin(id: string): Promise<Result<AdminWork | null>>;
  createWork(input: WorkInput): Promise<Result<{ id: string }>>;
  updateWork(id: string, input: WorkInput, expectedUpdatedAt: string): Promise<Result<{ updated_at: string }>>;
  transitionWork(
    id: string,
    transition: StatusTransition,
    expectedUpdatedAt: string,
  ): Promise<Result<{ updated_at: string }>>;

  listPostsAdmin(kind: PostKind, params: AdminListParams): Promise<Result<Paged<AdminPost>>>;
  getPostAdmin(id: string): Promise<Result<AdminPost | null>>;
  createPost(input: PostInput): Promise<Result<{ id: string }>>;
  updatePost(id: string, input: PostInput, expectedUpdatedAt: string): Promise<Result<{ updated_at: string }>>;
  transitionPost(
    id: string,
    transition: StatusTransition,
    expectedUpdatedAt: string,
  ): Promise<Result<{ updated_at: string }>>;

  listVoicesAdmin(params: AdminListParams): Promise<Result<Paged<AdminVoice>>>;
  getVoiceAdmin(id: string): Promise<Result<AdminVoice | null>>;
  createVoice(input: VoiceInput): Promise<Result<{ id: string }>>;
  updateVoice(id: string, input: VoiceInput, expectedUpdatedAt: string): Promise<Result<{ updated_at: string }>>;
  transitionVoice(
    id: string,
    transition: StatusTransition,
    expectedUpdatedAt: string,
  ): Promise<Result<{ updated_at: string }>>;
}

// ---- kind ↔ table / tag 変換 ----

function tableForKind(kind: ContentKind): Table {
  if (kind === "work") return "works";
  if (kind === "voice") return "voices";
  return "posts";
}

function tagForKind(kind: ContentKind): string {
  if (kind === "work") return "works";
  if (kind === "voice") return "voices";
  return `posts:${kind}`;
}

function postKindOf(kind: ContentKind): string | null {
  if (kind === "work" || kind === "voice") return null;
  return kind;
}

// ---- 行 → ビュー型 mapping ----

function toPublishedWork(row: WorkRow, imageIds: string[]) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    category: row.category,
    body: row.body,
    process_note: row.process_note,
    cover_media_id: row.cover_media_id,
    image_ids: imageIds,
    published_at: row.published_at as string,
  };
}

function toAdminWork(row: WorkRow, imageIds: string[]): AdminWork {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    category: row.category,
    body: row.body,
    process_note: row.process_note,
    cover_media_id: row.cover_media_id,
    image_ids: imageIds,
    status: row.status as ContentStatus,
    published_at: row.published_at,
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toPublishedPost(row: PostRow) {
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind as PostKind,
    title: row.title,
    excerpt: row.excerpt,
    body: row.body,
    cover_media_id: row.cover_media_id,
    published_at: row.published_at as string,
  };
}

function toAdminPost(row: PostRow): AdminPost {
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind as PostKind,
    title: row.title,
    excerpt: row.excerpt,
    body: row.body,
    cover_media_id: row.cover_media_id,
    status: row.status as ContentStatus,
    published_at: row.published_at,
    source_run_id: row.source_run_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toPublishedVoice(row: VoiceRow) {
  return {
    id: row.id,
    customer_initial: row.customer_initial,
    region: row.region,
    rating: row.rating,
    body: row.body,
    item: row.item,
    photo_media_id: row.photo_media_id,
    sort_order: row.sort_order,
    published_at: row.published_at as string,
  };
}

function toAdminVoice(row: VoiceRow): AdminVoice {
  return {
    id: row.id,
    customer_initial: row.customer_initial,
    region: row.region,
    rating: row.rating,
    body: row.body,
    item: row.item,
    photo_media_id: row.photo_media_id,
    status: row.status as ContentStatus,
    published_at: row.published_at,
    sort_order: row.sort_order,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function attachWorkImages(
  client: SupabaseClient,
  rows: WorkRow[],
): Promise<Result<Map<string, string[]>>> {
  if (rows.length === 0) return { ok: true, value: new Map() };
  const ids = rows.map((r) => r.id);
  const { data, error } = await client
    .from("work_images")
    .select("work_id, media_id, sort_order")
    .in("work_id", ids)
    .order("sort_order", { ascending: true });
  if (error) return { ok: false, code: "KMB-E901", detail: error.message };
  const map = new Map<string, string[]>();
  for (const row of (data ?? []) as { work_id: string; media_id: string }[]) {
    const arr = map.get(row.work_id) ?? [];
    arr.push(row.media_id);
    map.set(row.work_id, arr);
  }
  return { ok: true, value: map };
}

// ---- canonical (§5) ----

async function createBlogPostFromDraft(
  input: BlogPostContent & { source_run_id: string },
): Promise<Result<{ post_id: string; slug: string }>> {
  const client = await createSupabaseServerClient();
  let slug = input.suggested_slug;
  let insertResult = await repo.insertPublishedBlogPost(client, {
    slug,
    title: input.title,
    excerpt: input.excerpt,
    body: input.body_md,
    cover_media_id: input.cover_media_id,
    source_run_id: input.source_run_id,
  });
  if (!insertResult.ok && insertResult.code === "KMB-E102") {
    // AI パイプライン産のため対話的な提案はできない。設計書 §2.4 の規約通り
    // {kind}-{nanoid(8)} へ 1 回だけフォールバックする。
    slug = generateFallbackSlug("blog");
    insertResult = await repo.insertPublishedBlogPost(client, {
      slug,
      title: input.title,
      excerpt: input.excerpt,
      body: input.body_md,
      cover_media_id: input.cover_media_id,
      source_run_id: input.source_run_id,
    });
  }
  if (!insertResult.ok) return insertResult;
  revalidateTag("posts:blog");
  return { ok: true, value: { post_id: insertResult.value.id, slug } };
}

async function publish(
  kind: PostKind | "work" | "voice",
  id: string,
  publishedAt?: Date,
): Promise<Result<void>> {
  const client = await createSupabaseServerClient();
  const table = tableForKind(kind as ContentKind);
  const currentResult = await repo.getByIdAdmin<WorkRow | PostRow | VoiceRow>(client, table, id);
  if (!currentResult.ok) return currentResult;
  if (!currentResult.value) {
    return { ok: false, code: "KMB-E901", detail: "対象が見つかりません" };
  }
  const current = currentResult.value;
  const guard = guardTransition({
    currentStatus: current.status as ContentStatus,
    currentPublishedAt: current.published_at,
    to: "published",
    requestedPublishedAt: publishedAt ? publishedAt.toISOString() : null,
  });
  if (!guard.ok) return guard;

  // canonical シグネチャに expectedUpdatedAt が無いため、直前に取得した updated_at を
  // 排他ロックの参照値として使う (システム内部呼び出し向けの簡易メソッド。
  // admin UI からの編集は楽観排他つきの transitionWork/Post/Voice を使う)。
  const updateResult = await repo.updateStatusFields(
    client,
    table,
    id,
    guard.value.status,
    guard.value.publishedAt,
    current.updated_at,
  );
  if (!updateResult.ok) return updateResult;
  revalidateTag(tagForKind(kind as ContentKind));
  return { ok: true, value: undefined };
}

async function listPublished<K extends ContentKind>(
  kind: K,
  page: Pagination,
): Promise<Result<Paged<PublishedItem<K>>>> {
  const client = await createSupabaseServerClient();
  const table = tableForKind(kind);
  const postKind = postKindOf(kind);
  const listResult = await repo.listPublishedRows<WorkRow | PostRow | VoiceRow>(client, table, postKind, {
    cursor: page.cursor,
    limit: page.limit,
  });
  if (!listResult.ok) return listResult;

  let items: unknown[];
  if (kind === "work") {
    const rows = listResult.value.rows as WorkRow[];
    const imagesResult = await attachWorkImages(client, rows);
    if (!imagesResult.ok) return imagesResult;
    items = rows.map((r) => toPublishedWork(r, imagesResult.value.get(r.id) ?? []));
  } else if (kind === "voice") {
    items = (listResult.value.rows as VoiceRow[]).map(toPublishedVoice);
  } else {
    items = (listResult.value.rows as PostRow[]).map(toPublishedPost);
  }

  return {
    ok: true,
    value: { items: items as PublishedItem<K>[], next_cursor: listResult.value.nextCursor },
  };
}

async function getBySlug<K extends ContentKind>(
  kind: K,
  slug: string,
): Promise<Result<PublishedItem<K> | null>> {
  const client = await createSupabaseServerClient();
  const table = tableForKind(kind);
  const postKind = postKindOf(kind);

  if (kind === "work") {
    const result = await repo.getPublishedBySlug<WorkRow>(client, table, postKind, slug);
    if (!result.ok) return result;
    if (!result.value) return { ok: true, value: null };
    const imagesResult = await repo.listWorkImages(client, result.value.id);
    if (!imagesResult.ok) return imagesResult;
    return { ok: true, value: toPublishedWork(result.value, imagesResult.value) as PublishedItem<K> };
  }
  if (kind === "voice") {
    const result = await repo.getPublishedBySlug<VoiceRow>(client, table, postKind, slug);
    if (!result.ok) return result;
    return {
      ok: true,
      value: (result.value ? toPublishedVoice(result.value) : null) as PublishedItem<K> | null,
    };
  }
  const result = await repo.getPublishedBySlug<PostRow>(client, table, postKind, slug);
  if (!result.ok) return result;
  return {
    ok: true,
    value: (result.value ? toPublishedPost(result.value) : null) as PublishedItem<K> | null,
  };
}

// ---- admin: works ----

async function listWorksAdmin(params: AdminListParams): Promise<Result<Paged<AdminWork>>> {
  const client = await createSupabaseServerClient();
  const listResult = await repo.listWorksAdmin(client, {
    status: params.status,
    search: params.search,
    cursor: params.cursor,
    limit: params.limit ?? 50,
  });
  if (!listResult.ok) return listResult;
  const imagesResult = await attachWorkImages(client, listResult.value.rows);
  if (!imagesResult.ok) return imagesResult;
  const items = listResult.value.rows.map((r) => toAdminWork(r, imagesResult.value.get(r.id) ?? []));
  return { ok: true, value: { items, next_cursor: listResult.value.nextCursor } };
}

async function getWorkAdmin(id: string): Promise<Result<AdminWork | null>> {
  const client = await createSupabaseServerClient();
  const result = await repo.getByIdAdmin<WorkRow>(client, "works", id);
  if (!result.ok) return result;
  if (!result.value) return { ok: true, value: null };
  const imagesResult = await repo.listWorkImages(client, id);
  if (!imagesResult.ok) return imagesResult;
  return { ok: true, value: toAdminWork(result.value, imagesResult.value) };
}

async function createWork(input: WorkInput): Promise<Result<{ id: string }>> {
  const client = await createSupabaseServerClient();
  const serviceClient = createSupabaseServiceClient();
  const insertResult = await repo.insertWork(client, {
    slug: input.slug,
    title: input.title,
    category: input.category,
    body: input.body,
    process_note: input.process_note,
    cover_media_id: input.cover_media_id,
    sort_order: input.sort_order,
  });
  if (!insertResult.ok) {
    if (insertResult.code === "KMB-E102") {
      return { ok: false, code: "KMB-E102", detail: generateFallbackSlug("work") };
    }
    return insertResult;
  }
  const imagesResult = await repo.replaceWorkImages(serviceClient, insertResult.value.id, input.image_ids);
  if (!imagesResult.ok) return imagesResult;
  // 新規作成は常に status='draft' (DDL 既定) のため未公開。revalidate 不要。
  return { ok: true, value: { id: insertResult.value.id } };
}

async function updateWork(
  id: string,
  input: WorkInput,
  expectedUpdatedAt: string,
): Promise<Result<{ updated_at: string }>> {
  const client = await createSupabaseServerClient();
  const serviceClient = createSupabaseServiceClient();
  const updateResult = await repo.updateWorkFields(
    client,
    id,
    {
      slug: input.slug,
      title: input.title,
      category: input.category,
      body: input.body,
      process_note: input.process_note,
      cover_media_id: input.cover_media_id,
      sort_order: input.sort_order,
    },
    expectedUpdatedAt,
  );
  if (!updateResult.ok) {
    if (updateResult.code === "KMB-E102") {
      return { ok: false, code: "KMB-E102", detail: generateFallbackSlug("work") };
    }
    return updateResult;
  }
  const imagesResult = await repo.replaceWorkImages(serviceClient, id, input.image_ids);
  if (!imagesResult.ok) return imagesResult;
  revalidateTag("works");
  return { ok: true, value: { updated_at: updateResult.value.updated_at } };
}

async function transitionWork(
  id: string,
  transition: StatusTransition,
  expectedUpdatedAt: string,
): Promise<Result<{ updated_at: string }>> {
  const client = await createSupabaseServerClient();
  const currentResult = await repo.getByIdAdmin<WorkRow>(client, "works", id);
  if (!currentResult.ok) return currentResult;
  if (!currentResult.value) return { ok: false, code: "KMB-E901", detail: "対象が見つかりません" };
  const guard = guardTransition({
    currentStatus: currentResult.value.status as ContentStatus,
    currentPublishedAt: currentResult.value.published_at,
    to: transition.to,
    requestedPublishedAt: transition.published_at,
  });
  if (!guard.ok) return guard;
  const updateResult = await repo.updateStatusFields(
    client,
    "works",
    id,
    guard.value.status,
    guard.value.publishedAt,
    expectedUpdatedAt,
  );
  if (!updateResult.ok) return updateResult;
  revalidateTag("works");
  return { ok: true, value: { updated_at: updateResult.value.updated_at } };
}

// ---- admin: posts ----

async function listPostsAdmin(kind: PostKind, params: AdminListParams): Promise<Result<Paged<AdminPost>>> {
  const client = await createSupabaseServerClient();
  const listResult = await repo.listPostsAdmin(client, {
    status: params.status,
    kind,
    search: params.search,
    cursor: params.cursor,
    limit: params.limit ?? 50,
  });
  if (!listResult.ok) return listResult;
  return {
    ok: true,
    value: { items: listResult.value.rows.map(toAdminPost), next_cursor: listResult.value.nextCursor },
  };
}

async function getPostAdmin(id: string): Promise<Result<AdminPost | null>> {
  const client = await createSupabaseServerClient();
  const result = await repo.getByIdAdmin<PostRow>(client, "posts", id);
  if (!result.ok) return result;
  return { ok: true, value: result.value ? toAdminPost(result.value) : null };
}

async function createPost(input: PostInput): Promise<Result<{ id: string }>> {
  const client = await createSupabaseServerClient();
  const insertResult = await repo.insertPost(client, input);
  if (!insertResult.ok) {
    if (insertResult.code === "KMB-E102") {
      return { ok: false, code: "KMB-E102", detail: generateFallbackSlug(input.kind) };
    }
    return insertResult;
  }
  return { ok: true, value: { id: insertResult.value.id } };
}

async function updatePost(
  id: string,
  input: PostInput,
  expectedUpdatedAt: string,
): Promise<Result<{ updated_at: string }>> {
  const client = await createSupabaseServerClient();
  const updateResult = await repo.updatePostFields(client, id, input, expectedUpdatedAt);
  if (!updateResult.ok) {
    if (updateResult.code === "KMB-E102") {
      return { ok: false, code: "KMB-E102", detail: generateFallbackSlug(input.kind) };
    }
    return updateResult;
  }
  revalidateTag(`posts:${input.kind}`);
  return { ok: true, value: { updated_at: updateResult.value.updated_at } };
}

async function transitionPost(
  id: string,
  transition: StatusTransition,
  expectedUpdatedAt: string,
): Promise<Result<{ updated_at: string }>> {
  const client = await createSupabaseServerClient();
  const currentResult = await repo.getByIdAdmin<PostRow>(client, "posts", id);
  if (!currentResult.ok) return currentResult;
  if (!currentResult.value) return { ok: false, code: "KMB-E901", detail: "対象が見つかりません" };
  const current = currentResult.value;
  const guard = guardTransition({
    currentStatus: current.status as ContentStatus,
    currentPublishedAt: current.published_at,
    to: transition.to,
    requestedPublishedAt: transition.published_at,
  });
  if (!guard.ok) return guard;
  const updateResult = await repo.updateStatusFields(
    client,
    "posts",
    id,
    guard.value.status,
    guard.value.publishedAt,
    expectedUpdatedAt,
  );
  if (!updateResult.ok) return updateResult;
  revalidateTag(`posts:${current.kind}`);
  return { ok: true, value: { updated_at: updateResult.value.updated_at } };
}

// ---- admin: voices ----

async function listVoicesAdmin(params: AdminListParams): Promise<Result<Paged<AdminVoice>>> {
  const client = await createSupabaseServerClient();
  const listResult = await repo.listVoicesAdmin(client, {
    status: params.status,
    search: params.search,
    cursor: params.cursor,
    limit: params.limit ?? 50,
  });
  if (!listResult.ok) return listResult;
  return {
    ok: true,
    value: { items: listResult.value.rows.map(toAdminVoice), next_cursor: listResult.value.nextCursor },
  };
}

async function getVoiceAdmin(id: string): Promise<Result<AdminVoice | null>> {
  const client = await createSupabaseServerClient();
  const result = await repo.getByIdAdmin<VoiceRow>(client, "voices", id);
  if (!result.ok) return result;
  return { ok: true, value: result.value ? toAdminVoice(result.value) : null };
}

async function createVoice(input: VoiceInput): Promise<Result<{ id: string }>> {
  const client = await createSupabaseServerClient();
  const insertResult = await repo.insertVoice(client, input);
  if (!insertResult.ok) return insertResult;
  return { ok: true, value: { id: insertResult.value.id } };
}

async function updateVoice(
  id: string,
  input: VoiceInput,
  expectedUpdatedAt: string,
): Promise<Result<{ updated_at: string }>> {
  const client = await createSupabaseServerClient();
  const updateResult = await repo.updateVoiceFields(client, id, input, expectedUpdatedAt);
  if (!updateResult.ok) return updateResult;
  revalidateTag("voices");
  return { ok: true, value: { updated_at: updateResult.value.updated_at } };
}

async function transitionVoice(
  id: string,
  transition: StatusTransition,
  expectedUpdatedAt: string,
): Promise<Result<{ updated_at: string }>> {
  const client = await createSupabaseServerClient();
  const currentResult = await repo.getByIdAdmin<VoiceRow>(client, "voices", id);
  if (!currentResult.ok) return currentResult;
  if (!currentResult.value) return { ok: false, code: "KMB-E901", detail: "対象が見つかりません" };
  const guard = guardTransition({
    currentStatus: currentResult.value.status as ContentStatus,
    currentPublishedAt: currentResult.value.published_at,
    to: transition.to,
    requestedPublishedAt: transition.published_at,
  });
  if (!guard.ok) return guard;
  const updateResult = await repo.updateStatusFields(
    client,
    "voices",
    id,
    guard.value.status,
    guard.value.publishedAt,
    expectedUpdatedAt,
  );
  if (!updateResult.ok) return updateResult;
  revalidateTag("voices");
  return { ok: true, value: { updated_at: updateResult.value.updated_at } };
}

export const contentFacade: ContentFacade = {
  createBlogPostFromDraft,
  publish,
  listPublished,
  getBySlug,
  listWorksAdmin,
  getWorkAdmin,
  createWork,
  updateWork,
  transitionWork,
  listPostsAdmin,
  getPostAdmin,
  createPost,
  updatePost,
  transitionPost,
  listVoicesAdmin,
  getVoiceAdmin,
  createVoice,
  updateVoice,
  transitionVoice,
};
