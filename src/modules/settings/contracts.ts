import { z } from "zod";

import {
  zDateOnly,
  zInvoiceRegistrationNumber,
  zMediaId,
  zShortText,
  zTaxRounding,
  zTelE164,
} from "@/modules/platform/contracts";

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
    // ai-studio-v2.md §1/§2 (module-contracts.md v2.5 §4.2)。µUSD 整数で統一 (USD 小数は使わない)。
    ai_monthly_budget_micro_usd: z.number().int().min(0), // AI 従量課金の月次上限。既定 50_000_000 = $50
    ai_monthly_image_limit: z.number().int().min(0).max(10_000), // 画像生成の月次枚数上限。既定 200
    /**
     * 判断点 (オーケストレーターへ報告): ai-studio-v2.md §2 の ai_provider_keys.default_model
     * コメント「画像の既定は ops 設定」を実装したもの。契約書 v2.5 §4.2 の抜粋には明記されて
     * いないが、設計書の同コメントから導かれる必然のフィールドとして追加した。
     * 画像生成モデルは複数プロバイダを横断しうるため per-key ではなく ops 設定 (グローバル 1 つ)
     * に置く。null = 未設定 (設定画面で選択されるまで)。
     */
    ai_default_image_model: z.string().max(200).nullable(),
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

/** GA4 計測 (05-site-settings.md、裁定 J12)。measurement_id は秘匿でないため site_settings 可。
 *  null = 計測無効。タグ注入は (site)/layout.tsx のみ (admin/edit 除外) */
export const zAnalyticsSettings = z.object({
  ga4_measurement_id: z.string().regex(/^G-[A-Z0-9]{4,16}$/).nullable(),
}).strict();

/** ブランディング (favicon)。media 参照 3 点セット (media_admin_delete /
 *  media_reference_summary / ai_draft_cleanup_run) への追記は migration 0035 (05-site-settings.md) */
export const zBrandingSettings = z.object({
  favicon_media_id: zMediaId.nullable(), // null = 既定 favicon (public/favicon.ico — 05 §5.3 の移設後パス) にフォールバック
}).strict();

/** 適格請求書発行者情報 (02-sales.md、裁定 J5)。registration_number null = 免税モード
 *  (帳票は区分記載様式 + 「消費税相当額」表記に自動分岐 — どちらでも壊れない設計)。
 *  本キーは anon 不可読 (下記「anon 可読キーの許可リスト」— 銀行口座を含むため) */
export const zInvoiceIssuerSettings = z.object({
  issuer_name: zShortText(80),                       // 屋号/法人名 (帳票の発行者欄)
  registration_number: zInvoiceRegistrationNumber.nullable(),
  tax_rounding: zTaxRounding,                        // 既定 'floor'
  bank_account: z.object({
    bank_name: zShortText(40),
    branch_name: zShortText(40),
    account_type: z.enum(["ordinary", "checking"]),  // 普通/当座
    account_number: z.string().regex(/^\d{4,8}$/),
    account_holder_kana: zShortText(60),
  }).strict().nullable(),                            // null = 振込先欄を印字しない
  transfer_fee_note: z.string().max(100).nullable(), // 振込手数料負担文言 (請求書のみ印字)
  seal_storage_path: z.string().max(300).nullable(), // 角印画像 (任意。社名右に重ね合成)。
    // v1.2 是正 (旧 seal_media_id: zMediaId を廃止): media テーブルは anon 全行 SELECT +
    // media バケットは public (migration 0002/0003 実測) のため、media 参照だと社印画像が
    // 匿名取得可能になる (書類偽造の材料)。private バケット 'branding-assets' (public=false、
    // migration 0028 で作成 — 旧「media 参照 3 点セット追記」は不要となり 0028 の内容を置換) に
    // 保存し、PDF 生成 (/print) は server 側で署名 URL を解決する (02-sales §10.6 の
    // 「media の公開 URL を <img>」は本是正へ追随すること)
  quote_valid_days: z.number().int().min(1).max(180), // 見積有効期限の既定日数 (既定 30)
}).strict();

/** 構造化営業時間 (04-telephony.md の着信分岐 + 公開表示。裁定 J3/J12)。
 *  JST 前提。open/close は "HH:MM"。null = 終日休み。
 *  v1 制約: 1 日 1 窓のみ (昼休み等の複数窓分割は拡張章送り — 04-telephony §16 と同期)。
 *  v1.2: open < close の refine を追加 — close < open が保存できると 04 §6.2 の JST 判定
 *  (open <= now < close) で恒久的に時間外となり全通話が留守電へ落ちる静かな degrade になる */
const zDayHours = z.object({
  open: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  close: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
}).strict().refine((h) => h.open < h.close, "open は close より前 (HH:MM 文字列比較で順序付く)").nullable();
export const zBusinessHoursSettings = z.object({
  mon: zDayHours, tue: zDayHours, wed: zDayHours, thu: zDayHours,
  fri: zDayHours, sat: zDayHours, sun: zDayHours,
  holidays: z.array(zDateOnly).max(200),             // 臨時休業日 (JST)
}).strict();

/** 週間稼働キャパシティ (03-scheduling.md、裁定 J8)。
 *  キャパ残 = weekly_hours − 配置済み拘束ブロック合計 */
export const zWorkCapacitySettings = z.object({
  weekly_hours: z.number().min(0).max(168),
}).strict();

/** 電話まわりの運用設定 (04-telephony.md §1.4 番号非依存設計 / 裁定 J3 ★確認 1・4。v1.1: Δ2 採用)。
 *  全フィールド null/既定で「未設定でも壊れない」: 番号未購入でも保存可、
 *  forward_to null = 全通話留守電、announcement text null = コード内既定文言 */
export const zTelephonySettings = z.object({
  phone_number_e164: zTelE164.nullable(),        // 購入した 050 番号 (表示・Phase 2 発信用)
  twilio_number_sid: z.string().max(64).nullable(), // 番号リソース SID (PN...)。運用記録用
  forward_to_e164: zTelE164.nullable(),          // 営業時間内の転送先 (熊部さん携帯)。null = 転送なし→留守電
  consent_announcement_enabled: z.boolean(),     // 録音同意アナウンス (既定 true — 裁定 J3)
  consent_announcement_text: z.string().max(300).nullable(), // null = 既定文言 (telephony/internal/twiml.ts の定数)
  in_hours_greeting_text: z.string().max(300).nullable(),    // 営業時間内・転送なし時の留守電導入文言
  after_hours_greeting_text: z.string().max(300).nullable(), // 時間外アナウンス文言
  voicemail_max_seconds: z.number().int().min(30).max(600),  // <Record maxLength>。既定 120
  delete_twilio_recording_after_download: z.boolean(),       // 既定 true (ストレージ課金停止 — ext-twilio §2.2)
  max_processing_minutes: z.number().int().min(1).max(60),   // AI 処理する録音長の上限。既定 30。超過は KMB-E822
}).strict();

export const SETTINGS_SCHEMAS = {
  company: zCompanySettings,
  hero: zHeroSettings,
  seo_defaults: zSeoDefaults,
  ops_limits: zOpsLimits,
  notifications: zNotificationSettings,
  analytics: zAnalyticsSettings,
  branding: zBrandingSettings,
  invoice_issuer: zInvoiceIssuerSettings,
  business_hours: zBusinessHoursSettings,
  work_capacity: zWorkCapacitySettings,
  telephony: zTelephonySettings,
} as const;
export type SettingsKey = keyof typeof SETTINGS_SCHEMAS;
export type SettingsValue<K extends SettingsKey> = z.infer<(typeof SETTINGS_SCHEMAS)[K]>;
