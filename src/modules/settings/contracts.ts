import { z } from "zod";

import { zMediaId, zShortText } from "@/modules/platform/contracts";

/**
 * canonical: docs/module-contracts.md §4.2 (settings.value)
 * site_settings.key ごとにスキーマを固定する discriminated map。
 */

export const zCompanySettings = z
  .object({
    name: zShortText(50),
    representative: zShortText(30),
    address: zShortText(120),
    tel: z
      .string()
      .regex(/^0\d{1,4}-\d{1,4}-\d{3,4}$/)
      .nullable(),
    email: z.string().email().max(120).nullable(),
    founded: z
      .string()
      .regex(/^\d{4}(-(0[1-9]|1[0-2]))?$/)
      .nullable(), // 'YYYY' or 'YYYY-MM'
    business_hours: z.string().max(100).nullable(),
  })
  .strict();

/**
 * BLOCKER-1 (docs/design/visual-media-editor.md §1): hero 画像は page_media.home.hero に
 * 一本化する。hero.media_id は 0013 migration で site_settings 行からも除去済みのため、
 * ここでも削除する (見出し・CTA テキストのみに縮退)。
 */
export const zHeroSettings = z
  .object({
    heading: zShortText(40),
    subheading: z.string().max(80),
    cta_label: zShortText(20),
    cta_href: z.string().regex(/^\/[a-z0-9\-/]*$/), // 内部パスのみ (外部 URL 禁止)
  })
  .strict();

export const zSeoDefaults = z
  .object({
    title_template: z
      .string()
      .max(60)
      .refine((s) => s.includes("%s"), "%s 必須"),
    description: z.string().min(50).max(160),
    og_media_id: zMediaId,
  })
  .strict();

export const zOpsLimits = z
  .object({
    x_monthly_post_limit: z.number().int().min(0).max(1000), // 課金ガード (設計書 §8.2)。初期値 100
  })
  .strict();

export const zNotificationSettings = z
  .object({
    inquiry_to: z.string().email().max(120), // 問い合わせ通知メールの宛先。/admin/settings で変更可。
    // bootstrap-admin が管理者メールで初期化 (設計書 §6.3)。
    // キー不存在時は送信スキップ + E902 ログ (問い合わせ保存は成功)
    on_publish_failure: z.boolean(), // 2d〜: 配信失敗・トークン失効もメール通知するか
  })
  .strict();

export const SETTINGS_SCHEMAS = {
  company: zCompanySettings,
  hero: zHeroSettings,
  seo_defaults: zSeoDefaults,
  ops_limits: zOpsLimits,
  notifications: zNotificationSettings,
} as const;
export type SettingsKey = keyof typeof SETTINGS_SCHEMAS;
export type SettingsValue<K extends SettingsKey> = z.infer<(typeof SETTINGS_SCHEMAS)[K]>;
