import type { Paged, Pagination, Result } from "@/modules/platform/contracts";

import type { BlogPostContent, ContentKind, PostKind, PublishedItem } from "./contracts";

/**
 * content モジュールの公開 facade (契約書 §5)。
 * インターフェース型定義のみ。実装は Wave 1 以降。
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
}
