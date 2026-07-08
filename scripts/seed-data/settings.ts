import {
  zCompanySettings,
  zHeroSettings,
  zOpsLimits,
  zSeoDefaults,
  type SettingsValue,
} from "@/modules/settings/contracts";

import { findMediaIdBySourceFile } from "./media";

/**
 * src/app/layout.tsx (会社情報 / JSON-LD / SEO 既定値) と src/app/page.tsx (ヒーロー) から転記。
 *
 * (契約との乖離メモ)
 * - zCompanySettings.tel / email / founded / business_hours は legacy のどのページにも
 *   具体的な値が公開されていない (tokushoho ページでは「電話番号: ご請求があれば開示」と
 *   明記されており、意図的に非公開)。したがって null とする。将来 /admin/settings で
 *   堀さんが入力する想定。
 * - zHeroSettings.subheading (max 80) は、ホームページのヒーロー段落
 *   (「積層痕を消す研磨から〜郵送で全国からお受けします。」、100文字超) 全文は収まらない。
 *   本 seed では段落冒頭の一文 (一字一句そのまま) を切り出して使用する。全文は
 *   ホームページの実装 (src/app/page.tsx) では今後も独自 JSX のまま残せるため、
 *   site_settings.hero は「他ページで hero 相当の要約を再利用する場合」の既定値という
 *   位置づけになる。
 */

export const COMPANY_SETTINGS_SEED: SettingsValue<"company"> = zCompanySettings.parse({
  name: "隈部塗装",
  representative: "隈部 信之",
  address: "大分県豊後高田市",
  tel: null,
  email: null,
  founded: null,
  business_hours: null,
});

export const HERO_SETTINGS_SEED: SettingsValue<"hero"> = zHeroSettings.parse({
  media_id: findMediaIdBySourceFile("public/hero.jpg"),
  heading: "3Dプリントを、量産品と見分けがつかない外観に。",
  subheading: "積層痕を消す研磨から、自動車グレードの塗装仕上げまで。",
  cta_label: "SHOPで概算を出す",
  cta_href: "/shop",
});

export const SEO_DEFAULTS_SEED: SettingsValue<"seo_defaults"> = zSeoDefaults.parse({
  title_template: "%s | 隈部塗装",
  description:
    "3Dプリントを、量産品と見分けがつかない外観に。積層痕除去の研磨から自動車グレードの塗装仕上げまで、試作1点からブリッジ生産1,000個まで郵送で全国受託。隈部塗装(大分県豊後高田市)。",
  og_media_id: findMediaIdBySourceFile("public/og-image.jpg"),
});

/** 初期値 100 (設計書 §4.2 コメント: 課金ガードの初期値) */
export const OPS_LIMITS_SEED: SettingsValue<"ops_limits"> = zOpsLimits.parse({
  x_monthly_post_limit: 100,
});
