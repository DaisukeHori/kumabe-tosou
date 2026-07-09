import { unstable_cache } from "next/cache";

import { createSupabasePublicClient } from "@/lib/supabase/public";

import { toPublicMediaRef, type PublicMediaRef } from "./media";

/**
 * 公開サイト (site-public) の DB 読み取り。
 *
 * canonical: docs/design/cms-ai-pipeline.md §6.1 (unstable_cache + タグ方式)、
 * §2.3 (全データパターン。0 件・エラー時はダミーではなく「空」として扱い、公開ページを
 * 落とさない)。
 *
 * (契約との既知の乖離 — オーケストレーターへ報告)
 * module-contracts.md §2 の理想形は「site-public → content facade (read facade のみ)」だが、
 * ContentFacade / MediaFacade はまだ実装が無い (インターフェース定義のみ、Wave 1 以降)。
 * Wave1-D の指示 (「公開一覧の DB 化: Supabase (anon client) の published fetch に置換」) に
 * 明示的に従い、本ファイルは ContentFacade を介さず直接 Supabase (anon) へクエリする。
 * ContentFacade 実装が揃った時点で、本ファイルの中身を facade 呼び出しへ差し替えるのが
 * 望ましい (repository 直叩きのロジックをここに閉じ込めているのはその置換を容易にするため)。
 */

export type PublicWorkListItem = {
  id: string;
  slug: string;
  title: string;
  category: string;
  processNote: string | null;
  cover: PublicMediaRef | null;
  publishedAt: string;
};

export type PublicWorkDetail = PublicWorkListItem & {
  body: string;
  images: PublicMediaRef[];
};

export type PublicPostKind = "reading" | "news" | "blog";

export type PublicPostListItem = {
  id: string;
  slug: string;
  kind: PublicPostKind;
  title: string;
  excerpt: string;
  cover: PublicMediaRef | null;
  publishedAt: string;
};

export type PublicPostDetail = PublicPostListItem & { body: string };

export type PublicVoiceListItem = {
  id: string;
  customerInitial: string;
  region: string;
  rating: number;
  body: string;
  item: string | null;
  photo: PublicMediaRef | null;
  publishedAt: string;
};

/**
 * DB / ネットワーク障害時も公開ページを落とさないためのフォールバック実行。
 * 「0 件」と「取得失敗」を公開側の見た目としては同じ (空状態) に倒す
 * (§2.3: 0 件はエラー表示にしない、の精神を障害時にも拡張適用)。
 */
async function safeQuery<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[public-content] ${label} の取得に失敗しました (空として扱います):`, err);
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// works
// ---------------------------------------------------------------------------

const WORK_LIST_SELECT =
  "id, slug, title, category, process_note, published_at, cover_media:media!works_cover_media_id_fkey(id, storage_path, alt, is_placeholder)";

type WorkListRow = {
  id: string;
  slug: string;
  title: string;
  category: string;
  process_note: string | null;
  published_at: string;
  cover_media: {
    id: string;
    storage_path: string;
    alt: string;
    is_placeholder: boolean;
  } | null;
};

async function fetchPublishedWorks(): Promise<PublicWorkListItem[]> {
  const client = createSupabasePublicClient();
  const { data, error } = await client
    .from("works")
    .select(WORK_LIST_SELECT)
    .order("sort_order", { ascending: true })
    .order("published_at", { ascending: false })
    .returns<WorkListRow[]>();
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    category: row.category,
    processNote: row.process_note,
    cover: toPublicMediaRef(row.cover_media),
    publishedAt: row.published_at,
  }));
}

async function fetchPublishedWorkBySlug(slug: string): Promise<PublicWorkDetail | null> {
  const client = createSupabasePublicClient();
  const { data, error } = await client
    .from("works")
    .select(
      `${WORK_LIST_SELECT}, body, work_images(sort_order, media(id, storage_path, alt, is_placeholder))`,
    )
    .eq("slug", slug)
    .maybeSingle<
      WorkListRow & {
        body: string;
        work_images: {
          sort_order: number;
          media: { id: string; storage_path: string; alt: string; is_placeholder: boolean } | null;
        }[];
      }
    >();
  if (error) throw error;
  if (!data) return null;

  const images = [...data.work_images]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((wi) => toPublicMediaRef(wi.media))
    .filter((m): m is PublicMediaRef => m !== null);

  return {
    id: data.id,
    slug: data.slug,
    title: data.title,
    category: data.category,
    processNote: data.process_note,
    cover: toPublicMediaRef(data.cover_media),
    publishedAt: data.published_at,
    body: data.body,
    images,
  };
}

async function fetchPublishedWorkSlugs(): Promise<string[]> {
  const client = createSupabasePublicClient();
  const { data, error } = await client.from("works").select("slug").returns<{ slug: string }[]>();
  if (error) throw error;
  return (data ?? []).map((r) => r.slug);
}

const cachedWorksList = unstable_cache(
  () => fetchPublishedWorks(),
  ["public-content", "works", "list"],
  { tags: ["works"] },
);

const cachedWorkBySlug = unstable_cache(
  (slug: string) => fetchPublishedWorkBySlug(slug),
  ["public-content", "works", "detail"],
  { tags: ["works"] },
);

const cachedWorkSlugs = unstable_cache(
  () => fetchPublishedWorkSlugs(),
  ["public-content", "works", "slugs"],
  { tags: ["works"] },
);

export const getPublishedWorks = (): Promise<PublicWorkListItem[]> =>
  safeQuery("works 一覧", cachedWorksList, []);

export const getPublishedWorkBySlug = (slug: string): Promise<PublicWorkDetail | null> =>
  safeQuery(`works 詳細 (${slug})`, () => cachedWorkBySlug(slug), null);

export const listPublishedWorkSlugs = (): Promise<string[]> =>
  safeQuery("works slug 一覧", cachedWorkSlugs, []);

// ---------------------------------------------------------------------------
// posts (reading / news / blog)
// ---------------------------------------------------------------------------

const POST_LIST_SELECT =
  "id, slug, kind, title, excerpt, published_at, cover_media:media!posts_cover_media_id_fkey(id, storage_path, alt, is_placeholder)";

type PostListRow = {
  id: string;
  slug: string;
  kind: PublicPostKind;
  title: string;
  excerpt: string;
  published_at: string;
  cover_media: {
    id: string;
    storage_path: string;
    alt: string;
    is_placeholder: boolean;
  } | null;
};

async function fetchPublishedPosts(kind: PublicPostKind): Promise<PublicPostListItem[]> {
  const client = createSupabasePublicClient();
  const { data, error } = await client
    .from("posts")
    .select(POST_LIST_SELECT)
    .eq("kind", kind)
    .order("published_at", { ascending: false })
    .returns<PostListRow[]>();
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    title: row.title,
    excerpt: row.excerpt,
    cover: toPublicMediaRef(row.cover_media),
    publishedAt: row.published_at,
  }));
}

async function fetchPublishedPostBySlug(
  kind: PublicPostKind,
  slug: string,
): Promise<PublicPostDetail | null> {
  const client = createSupabasePublicClient();
  const { data, error } = await client
    .from("posts")
    .select(`${POST_LIST_SELECT}, body`)
    .eq("kind", kind)
    .eq("slug", slug)
    .maybeSingle<PostListRow & { body: string }>();
  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    slug: data.slug,
    kind: data.kind,
    title: data.title,
    excerpt: data.excerpt,
    cover: toPublicMediaRef(data.cover_media),
    publishedAt: data.published_at,
    body: data.body,
  };
}

async function fetchPublishedPostSlugs(kind: PublicPostKind): Promise<string[]> {
  const client = createSupabasePublicClient();
  const { data, error } = await client
    .from("posts")
    .select("slug")
    .eq("kind", kind)
    .returns<{ slug: string }[]>();
  if (error) throw error;
  return (data ?? []).map((r) => r.slug);
}

/** kind ごとに tag (`posts:${kind}`) を固定した cache インスタンスを作る (§6.1) */
function definePostQueries(kind: PublicPostKind) {
  const tags = [`posts:${kind}`];
  const list = unstable_cache(() => fetchPublishedPosts(kind), ["public-content", "posts", kind, "list"], {
    tags,
  });
  const detail = unstable_cache(
    (slug: string) => fetchPublishedPostBySlug(kind, slug),
    ["public-content", "posts", kind, "detail"],
    { tags },
  );
  const slugs = unstable_cache(
    () => fetchPublishedPostSlugs(kind),
    ["public-content", "posts", kind, "slugs"],
    { tags },
  );
  return { list, detail, slugs };
}

const readingQueries = definePostQueries("reading");
const blogQueries = definePostQueries("blog");
const newsQueries = definePostQueries("news");

export const getPublishedReadingPosts = (): Promise<PublicPostListItem[]> =>
  safeQuery("読みもの一覧", readingQueries.list, []);
export const getPublishedReadingPostBySlug = (slug: string): Promise<PublicPostDetail | null> =>
  safeQuery(`読みもの詳細 (${slug})`, () => readingQueries.detail(slug), null);
export const listPublishedReadingSlugs = (): Promise<string[]> =>
  safeQuery("読みもの slug 一覧", readingQueries.slugs, []);

export const getPublishedBlogPosts = (): Promise<PublicPostListItem[]> =>
  safeQuery("ブログ一覧", blogQueries.list, []);
export const getPublishedBlogPostBySlug = (slug: string): Promise<PublicPostDetail | null> =>
  safeQuery(`ブログ詳細 (${slug})`, () => blogQueries.detail(slug), null);
export const listPublishedBlogSlugs = (): Promise<string[]> =>
  safeQuery("ブログ slug 一覧", blogQueries.slugs, []);

/** お知らせ (news) は Wave1-D のスコープ外 (トップページ新設セクション。所有はホームページ担当) だが、
 *  タグ体系・キャッシュ実装は posts 共通のため定義だけ揃えておく (未使用エクスポートによる
 *  ビルドエラーを避けるため、他ページから使えるよう公開しておく)。*/
export const getPublishedNewsPosts = (): Promise<PublicPostListItem[]> =>
  safeQuery("お知らせ一覧", newsQueries.list, []);

// ---------------------------------------------------------------------------
// voices
// ---------------------------------------------------------------------------

type VoiceRow = {
  id: string;
  customer_initial: string;
  region: string;
  rating: number;
  body: string;
  item: string | null;
  published_at: string;
  photo_media: { id: string; storage_path: string; alt: string; is_placeholder: boolean } | null;
};

async function fetchPublishedVoices(): Promise<PublicVoiceListItem[]> {
  const client = createSupabasePublicClient();
  const { data, error } = await client
    .from("voices")
    .select(
      "id, customer_initial, region, rating, body, item, published_at, photo_media:media!voices_photo_media_id_fkey(id, storage_path, alt, is_placeholder)",
    )
    .order("sort_order", { ascending: true })
    .order("published_at", { ascending: false })
    .returns<VoiceRow[]>();
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    customerInitial: row.customer_initial,
    region: row.region,
    rating: row.rating,
    body: row.body,
    item: row.item,
    photo: toPublicMediaRef(row.photo_media),
    publishedAt: row.published_at,
  }));
}

const cachedVoicesList = unstable_cache(
  () => fetchPublishedVoices(),
  ["public-content", "voices", "list"],
  { tags: ["voices"] },
);

export const getPublishedVoices = (): Promise<PublicVoiceListItem[]> =>
  safeQuery("お客様の声一覧", cachedVoicesList, []);
