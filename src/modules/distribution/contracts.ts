import { z } from "zod";

import { zIsoDatetime, zShortText, type Channel } from "@/modules/platform/contracts";

/**
 * canonical: docs/module-contracts.md §4.5 (distribution の外部参照・メタ)
 */

/** channel_posts.external_id (X はスレッド途中失敗の再開情報を含む JSON) */
export const zXExternalRef = z
  .object({
    tweet_ids: z.array(z.string().regex(/^\d+$/)),
    last_completed_index: z.number().int().min(-1), // -1 = 未投稿
  })
  .strict();
export type XExternalRef = z.infer<typeof zXExternalRef>;
// instagram: media id 文字列 / site_blog: posts.id (uuid) / note: 手動入力 URL

/** channel_accounts.meta (トークン本体は含まない — Vault のみ) */
export const zXAccountMeta = z
  .object({
    user_id: z.string(),
    username: z.string().max(50),
    token_expires_at: zIsoDatetime,
  })
  .strict();
export type XAccountMeta = z.infer<typeof zXAccountMeta>;

export const zInstagramAccountMeta = z
  .object({
    ig_business_account_id: z.string(),
    facebook_page_id: z.string(),
    username: z.string().max(50),
    token_expires_at: zIsoDatetime,
  })
  .strict();
export type InstagramAccountMeta = z.infer<typeof zInstagramAccountMeta>;

export const zNoteAccountMeta = z
  .object({
    profile_url: z.string().url().nullable(),
    // §8: note セッション Cookie を Vault に保存した日時 (非秘匿。UI の「あと約 N 日」表示用)。
    // 既存行の非破壊的スキーマ拡張 — migration 20260710000016 の実装報告参照。
    cookie_saved_at: zIsoDatetime.nullable(),
  })
  .strict();
export type NoteAccountMeta = z.infer<typeof zNoteAccountMeta>;

/** channel_posts.note_draft_status (DDL check 制約と 1:1。§8 MAJOR-3 の状態意味論) */
export const zNoteDraftStatus = z.enum(["none", "creating", "created", "unknown", "failed"]);
export type NoteDraftStatus = z.infer<typeof zNoteDraftStatus>;

/** /admin/channels の note セッション Cookie 登録フォーム入力 (§8)。DevTools でコピーした
 * 生の Cookie ヘッダ文字列をそのまま Vault に保存する (module-contracts.md 未更新分 —
 * オーケストレーターへ報告済み) */
export const zNoteSessionCookieInput = z
  .object({
    cookie: z
      .string()
      .trim()
      .min(20, "Cookie の値が短すぎます (DevTools からコピーした値をご確認ください)")
      .max(8000),
  })
  .strict();
export type NoteSessionCookieInput = z.infer<typeof zNoteSessionCookieInput>;

/**
 * canonical: docs/module-contracts.md §4.8 (distribution 分)
 */

export const zScheduleEntry = z
  .object({
    draft_id: z.string().uuid(),
    scheduled_at: zIsoDatetime.nullable(), // §4.7 zScheduleReq と同一要素型 (note は null 必須)
  })
  .strict();
export type ScheduleEntry = z.infer<typeof zScheduleEntry>;

export const zStyleProfileInput = z
  .object({
    tone_instructions: zShortText(2000),
    format_rules: zShortText(2000),
    example_output: z.string().max(10_000).nullable(),
  })
  .strict();
export type StyleProfileInput = z.infer<typeof zStyleProfileInput>;

/**
 * canonical: docs/module-contracts.md §4.7 (distribution が所有する Route Handler 契約)。
 * 1 draft = 1 channel (channel_drafts の unique(run_id, channel)) のため、
 * 予約は channel ではなく draft 単位で指定する。channel は draft から導出し、
 * channel_posts.channel は draft と一致することを trigger で検証。
 */
export const zScheduleReq = z
  .object({
    entries: z.array(zScheduleEntry).min(1).max(8),
  })
  .strict();
export type ScheduleReq = z.infer<typeof zScheduleReq>;

/**
 * channel_posts.status (DDL の check 制約と 1:1。cms-ai-pipeline.md §2.2 / §4.3)。
 * contracts-ddl-parity.test.ts の比較対象として追加 (Wave2-F)。
 */
export const zChannelPostStatus = z.enum([
  "scheduled",
  "publishing",
  "published",
  "failed",
  "cancelled",
  "manual_required",
]);
export type ChannelPostStatus = z.infer<typeof zChannelPostStatus>;

/** channel_accounts.auth_status (DDL の check 制約と 1:1) */
export const zChannelAuthStatus = z.enum(["disconnected", "connected", "expired", "error"]);
export type ChannelAuthStatus = z.infer<typeof zChannelAuthStatus>;

/** channel_accounts.channel (DDL の check 制約と 1:1。platform の zChannel とは値集合が異なる (note を含み site_blog を含まない)) */
export const zAccountChannel = z.enum(["x", "instagram", "note"]);
export type AccountChannel = z.infer<typeof zAccountChannel>;

/**
 * §5 に明記の無い admin 配信キュー画面 (/admin/channels) 向けの人間照合アクション。
 * manual_required からの遷移: 「投稿済み → published (URL 入力)」/「未投稿 → scheduled に戻す」
 * (設計書 §4.3 / §8.2)。module-contracts.md 未更新分 — オーケストレーターへ報告済み。
 */
export const zManualReconcileAction = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("mark_published"), external_url: z.string().url() }),
  z.object({ kind: z.literal("reset_to_scheduled"), scheduled_at: zIsoDatetime.nullable() }),
]);
export type ManualReconcileAction = z.infer<typeof zManualReconcileAction>;

/** /admin/channels の note アカウント管理フォーム入力 (§5 に明記無し。X/Meta は OAuth のため対象外) */
export const zNoteAccountInput = z
  .object({
    account_label: zShortText(50),
    profile_url: z.string().url().nullable(),
  })
  .strict();
export type NoteAccountInput = z.infer<typeof zNoteAccountInput>;

// ---- §4.9 相当の読み取りビュー型 (Zod 化せず type のみ。DB 出力の正しさは repository が保証) ----

export type ChannelPostView = {
  id: string;
  draft_id: string;
  channel: Channel;
  status: ChannelPostStatus;
  scheduled_at: string;
  published_at: string | null;
  external_id: string | null;
  external_url: string | null;
  tweet_count: number | null;
  url_count: number | null;
  estimated_cost_cents: number;
  attempt_count: number;
  last_error_code: string | null;
  last_error_detail: string | null;
  /** §8 MAJOR-3: note チャネルのみ意味を持つ付加情報 (channel_posts.status とは独立) */
  note_draft_status: NoteDraftStatus;
  note_draft_url: string | null;
  created_at: string;
  updated_at: string;
};

export type ChannelAccountView = {
  channel: AccountChannel;
  account_label: string;
  auth_status: ChannelAuthStatus;
  meta: Record<string, unknown>;
  connected_at: string | null;
  updated_at: string;
};

export type StyleProfileView = {
  channel: Channel;
  tone_instructions: string;
  format_rules: string;
  example_output: string | null;
  updated_at: string;
};
