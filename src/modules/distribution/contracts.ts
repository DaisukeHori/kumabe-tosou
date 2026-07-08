import { z } from "zod";

import { zIsoDatetime, zShortText } from "@/modules/platform/contracts";

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
  })
  .strict();
export type NoteAccountMeta = z.infer<typeof zNoteAccountMeta>;

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
