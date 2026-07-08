import { z } from "zod";

import {
  zExcerpt,
  zIsoDatetime,
  zMarkdown,
  zMediaId,
  zShortText,
  zSlug,
  zTitle,
} from "@/modules/platform/contracts";

/**
 * canonical: docs/module-contracts.md §4.8 (CRUD エンティティ入力契約) の content 分
 * + §4.9 (facade 補助型) の content 分。
 */

/**
 * works / posts / voices 共通の公開状態 enum (DDL の status check 制約と 1:1)。
 * contracts-ddl-parity.test.ts の比較対象にするため named export にしている
 * (契約書 §4.8 では zStatusTransition.to にインライン定義されているのと同一の値集合)。
 */
export const zContentStatus = z.enum(["draft", "review", "published", "archived"]);

/** posts.kind (DDL の check 制約と 1:1)。同上の理由で named export */
export const zPostKind = z.enum(["reading", "news", "blog"]);

export const zWorkInput = z
  .object({
    slug: zSlug,
    title: zTitle,
    category: zShortText(30),
    body: zMarkdown,
    process_note: z.string().max(200).nullable(),
    cover_media_id: zMediaId.nullable(),
    image_ids: z.array(zMediaId).max(20), // work_images へ展開。配列順 = sort_order
    sort_order: z.number().int().min(0).max(9999),
  })
  .strict();
export type WorkInput = z.infer<typeof zWorkInput>;

export const zPostInput = z
  .object({
    slug: zSlug,
    kind: zPostKind,
    title: zTitle,
    excerpt: zExcerpt,
    body: zMarkdown,
    cover_media_id: zMediaId.nullable(),
  })
  .strict();
export type PostInput = z.infer<typeof zPostInput>;

export const zVoiceInput = z
  .object({
    customer_initial: z.string().regex(/^[A-Z]\.[A-Z]$/, "例: K.T"),
    region: zShortText(20),
    rating: z.number().int().min(1).max(5),
    body: zShortText(2000),
    item: z.string().max(100).nullable(),
    photo_media_id: zMediaId.nullable(),
    sort_order: z.number().int().min(0).max(9999),
  })
  .strict();
export type VoiceInput = z.infer<typeof zVoiceInput>;

/** 公開/アーカイブ等の状態遷移操作 (§4.1 の遷移図のガードは repository 側で二重検証) */
export const zStatusTransition = z
  .object({
    to: zContentStatus,
    published_at: zIsoDatetime.nullable(), // published への遷移時のみ指定可 (未来 = 予約公開)
  })
  .strict();
export type StatusTransition = z.infer<typeof zStatusTransition>;

// ---- §4.9 facade 補助型 (content 分) ----

export type PostKind = "reading" | "news" | "blog";
export type ContentKind = "work" | "voice" | PostKind;

/**
 * 読み取りビュー型 (DB 出力の正しさは repository + DDL (cms-ai-pipeline.md §2.2) が保証)。
 * module-contracts.md §4.9 の `PublishedItem<K> = … kind 別の公開表示用射影` は
 * プレースホルダのため、DDL の works/posts/voices カラム定義から 1:1 で具体化した。
 */
export type PublishedWork = {
  id: string;
  slug: string;
  title: string;
  category: string;
  body: string;
  process_note: string | null;
  cover_media_id: string | null;
  image_ids: string[];
  published_at: string;
};

export type PublishedPost = {
  id: string;
  slug: string;
  kind: PostKind;
  title: string;
  excerpt: string;
  body: string;
  cover_media_id: string | null;
  published_at: string;
};

export type PublishedVoice = {
  id: string;
  customer_initial: string;
  region: string;
  rating: number;
  body: string;
  item: string | null;
  photo_media_id: string | null;
  sort_order: number;
  published_at: string;
};

export type PublishedItem<K extends ContentKind> = K extends "work"
  ? PublishedWork
  : K extends "voice"
    ? PublishedVoice
    : PublishedPost;

/**
 * ContentFacade.createBlogPostFromDraft (§5) の入力型。
 * ai-studio の zSiteBlogContent (§4.4) と同一フィールド形だが、依存方向規則
 * (§2: `content → ai-studio` への逆流禁止) を守るため content 側で独立定義する。
 * TS の構造的型付けにより、ai-studio 側で zSiteBlogContent から得た値を
 * そのままこの型の引数として渡せる (import 不要)。
 */
export type BlogPostContent = {
  title: string;
  excerpt: string;
  body_md: string;
  suggested_slug: string;
  cover_media_id: string | null;
};
