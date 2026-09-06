import {
  zCompanySettings,
  zHeroSettings,
  zNotificationSettings,
  zOpsLimits,
  zSeoDefaults,
  type SettingsValue,
} from "@/modules/settings/contracts";

import { findMediaIdBySourceFile } from "./media";

/**
 * src/app/layout.tsx (会社情報 / JSON-LD / SEO 既定値) と src/app/page.tsx (ヒーロー) から転記。
 *
 * (契約との乖離メモ)
 * - address / tel は山岸塗装への屋号変更時に確定した値 (〒879-0614 来縄3036-1 / 090-9478-5028)。
 *   email / founded / business_hours は未確定のため null とする。将来 /admin/settings で
 *   入力する想定。
 * - zHeroSettings.subheading (max 80) は、ホームページのヒーロー段落
 *   (「積層痕を消す研磨から〜郵送で全国からお受けします。」、100文字超) 全文は収まらない。
 *   本 seed では段落冒頭の一文 (一字一句そのまま) を切り出して使用する。全文は
 *   ホームページの実装 (src/app/page.tsx) では今後も独自 JSX のまま残せるため、
 *   site_settings.hero は「他ページで hero 相当の要約を再利用する場合」の既定値という
 *   位置づけになる。
 */

export const COMPANY_SETTINGS_SEED: SettingsValue<"company"> = zCompanySettings.parse({
  name: "山岸塗装",
  representative: "山岸 信之",
  address: "〒879-0614 大分県豊後高田市来縄3036-1",
  tel: "090-9478-5028",
  email: null,
  founded: null,
  business_hours: null,
});

export const HERO_SETTINGS_SEED: SettingsValue<"hero"> = zHeroSettings.parse({
  heading: "3Dプリントを、量産品と見分けがつかない外観に。",
  subheading: "積層痕を消す研磨から、自動車グレードの塗装仕上げまで。",
  cta_label: "SHOPで概算を出す",
  cta_href: "/shop",
});

export const SEO_DEFAULTS_SEED: SettingsValue<"seo_defaults"> = zSeoDefaults.parse({
  title_template: "%s | 山岸塗装",
  description:
    "3Dプリントを、量産品と見分けがつかない外観に。積層痕除去の研磨から自動車グレードの塗装仕上げまで、試作1点からブリッジ生産1,000個まで郵送で全国受託。山岸塗装(大分県豊後高田市)。",
  og_media_id: findMediaIdBySourceFile("public/og-image.jpg"),
});

/**
 * 初期値は zOpsLimits (settings/contracts.ts) の各フィールドコメントに記載の既定値:
 * X 投稿 100 件/月、AI 従量課金 $50/月 (50_000_000 µUSD)、画像生成 200 枚/月、
 * 画像モデル未設定 (null = /admin/settings で選択されるまで)。
 */
export const OPS_LIMITS_SEED: SettingsValue<"ops_limits"> = zOpsLimits.parse({
  x_monthly_post_limit: 100,
  ai_monthly_budget_micro_usd: 50_000_000,
  ai_monthly_image_limit: 200,
  ai_default_image_model: null,
});

/**
 * 本来は scripts/bootstrap-admin.ts (service role の auth.admin API) が
 * 管理者メールで初期化する想定 (設計書 §6.3: 通知先未設定のまま運用が始まる事故を防ぐ)。
 * 今回は service_role キー未払い出しの admin セッション運用のため bootstrap-admin.ts
 * (auth.admin.createUser 等が service role 必須) を実行できず、管理者アカウントは
 * SQL で直接作成済み。そのため notifications 設定も未初期化のままだったので、
 * bootstrap-admin.ts と同じ意味づけ (inquiry_to = 管理者メール) をここで転記する。
 */
function requireBootstrapAdminEmail(): string {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  if (!email) {
    throw new Error(
      "BOOTSTRAP_ADMIN_EMAIL が未設定です。notifications 設定の初期化には管理者メールが必要です。",
    );
  }
  return email;
}

export const NOTIFICATIONS_SETTINGS_SEED: SettingsValue<"notifications"> =
  zNotificationSettings.parse({
    inquiry_to: requireBootstrapAdminEmail(),
    on_publish_failure: false,
  });
