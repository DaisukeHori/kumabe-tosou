import type { Metadata } from "next";

import { mediaFacade } from "@/modules/media/facade";
import { settingsFacade } from "@/modules/settings/facade";
import type { SettingsValue } from "@/modules/settings/contracts";

/**
 * 公開サイト ((site) route group) のメタ情報解決 (canonical: docs/design/crm-suite/05-site-settings.md
 * §3.2 / §5.1 / §5.2 / §5.3 / §5.4)。
 *
 * root layout (`src/app/layout.tsx` — 変更不可、裁定 J12) のハードコード値がフォールバックの
 * 単一ソースであり、settings (`seo_defaults` / `analytics` / `branding`) が設定されていれば
 * それを優先する「設定しなければ今まで通り」の合成を行う (§0.4)。
 */

/**
 * root layout (`src/app/layout.tsx` — 変更不可) のハードコード値と**文字列完全一致**させる
 * fallback 定数。一致は tests/site-metadata-fallback-parity.test.ts が root layout の
 * `metadata` export を import して検証する (二重定義の乖離防止)。
 */
export const SITE_META_FALLBACK = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "https://kumabe-tosou.vercel.app",
  titleDefault: "隈部塗装 | 3Dプリント表面処理の専門工房 — 大分県豊後高田市",
  titleTemplate: "%s | 隈部塗装",
  description:
    "3Dプリントを、量産品と見分けがつかない外観に。積層痕除去の研磨から自動車グレードの塗装仕上げまで、試作1点からブリッジ生産1,000個まで郵送で全国受託。隈部塗装(大分県豊後高田市)。",
  ogTitle: "隈部塗装 | 3Dプリント表面処理の専門工房",
  ogDescription: "積層痕を消す研磨から、自動車グレードの塗装仕上げまで。郵送で全国からお受けします。",
  ogImage: {
    url: "/og-image.jpg",
    width: 1200,
    height: 630,
    alt: "隈部塗装 — 3Dプリント表面処理の専門工房",
  },
  siteName: "隈部塗装",
} as const;

/** generateMetadata / (site) layout 本体が使う解決済みメタ (DB 値 + fallback を合成した後の形) */
export type ResolvedSiteMeta = {
  /** seo_defaults 行の有無 (テスト・ログ用) */
  source: "db" | "fallback";
  titleDefault: string;
  /** seo_defaults.title_template ?? fallback */
  titleTemplate: string;
  /** seo_defaults.description ?? fallback */
  description: string;
  /** 常に SITE_META_FALLBACK.ogTitle (DB 化しない — seo_defaults に og 専用 title フィールドがないため。§5.2) */
  ogTitle: string;
  /** source="db" → seo_defaults.description / source="fallback" → SITE_META_FALLBACK.ogDescription
   *  (現行 root layout の短文を維持 — §5.2 の解決規則) */
  ogDescription: string;
  ogImage:
    | { kind: "default"; url: string; width: number; height: number; alt: string }
    | { kind: "media"; url: string; alt: string }; // og_media_id の JPEG 決定論 URL。
  // width/height は宣言しない (media 行の公開文脈読み取りを増やさないための割り切り。
  // OGP 仕様上 og:image:width/height は optional — §5.4)。
  /** 注入判定済み (§5.1 resolveGaId 通過後) */
  gaId: string | null;
  /** "/icon?v=xxxxxxxx" | null (未設定) */
  faviconHref: string | null;
};

/**
 * GA を注入すべきときのみ id を返す純関数。
 * - measurement_id 未設定 → null (機能無効)
 * - `vercelEnv === "production"` のときのみ id を返し、それ以外 (Preview / dev /
 *   VERCEL_ENV 不存在) は常に null。
 *
 * v1.1 是正 (05-site-settings.md §5.1): NODE_ENV フォールバック判定は入れない。
 * ローカル `next build && next start` は VERCEL_ENV なし + NODE_ENV=production になるため、
 * NODE_ENV を見てしまうとローカル本番相当ビルドで計測が混入する。本サイトのデプロイ先は
 * Vercel のみのため「Vercel 本番以外では計測しない」に倒す (§7.3 env)。
 */
export function resolveGaId(
  ga4MeasurementId: string | null,
  vercelEnv: string | undefined,
): string | null {
  if (!ga4MeasurementId) return null;
  if (vercelEnv !== "production") return null;
  return ga4MeasurementId;
}

/** seo_defaults 行の有無に基づいて og:image を決定する (§5.4)。呼び出し元では throw しない。 */
async function resolveOgImage(
  seoValue: SettingsValue<"seo_defaults"> | null,
): Promise<ResolvedSiteMeta["ogImage"]> {
  if (!seoValue) {
    return { kind: "default", ...SITE_META_FALLBACK.ogImage };
  }
  const jpegResult = mediaFacade.getPublicJpegUrl(seoValue.og_media_id);
  if (!jpegResult.ok) {
    // getPublicJpegUrl は env 不正時のみ失敗する (§4.2)。実体の存在有無はここでは検証しない
    // (決定論 URL を返すだけの契約 — 404 は呼び出し側 <meta> の想定内、§9 パターン 12)。
    // env 不正という致命的な失敗のみ既定 OG 画像へ degrade する。
    console.error(
      "[site-metadata] og_media_id の URL 解決に失敗しました (既定 OG 画像で描画継続):",
      jpegResult.detail,
    );
    return { kind: "default", ...SITE_META_FALLBACK.ogImage };
  }
  // media 行への公開文脈での alt 追加読み取りは行わない (§3.2 コメント「media 行の公開文脈
  // 読み取りを増やさない割り切り」)。alt は SITE_META_FALLBACK の文言を流用する
  // (buildSiteMetadata は kind:"media" のとき alt を Metadata へ出力しないため実質未使用だが、
  // ResolvedSiteMeta の型契約 (§3.2) 上 alt は両 variant で必須のため埋める)。
  return { kind: "media", url: jpegResult.value, alt: SITE_META_FALLBACK.ogImage.alt };
}

/**
 * settings 3 キー (seo_defaults / analytics / branding) を settingsFacade.getPublicValue で
 * 読み (unstable_cache + tag "site_settings")、fallback と合成して ResolvedSiteMeta を返す。
 *
 * どのキーの読み取りが失敗しても throw しない (fallback で埋めて公開ページを落とさない —
 * page-media/pricing facade の allDefaultFallback と同じ「落とさない」思想)。
 * cookie 依存 client には一切触れない (settingsFacade.getPublicValue / mediaFacade.getPublicJpegUrl
 * とも cookie 非依存 — generateMetadata / (site) layout 本体の両方から呼ばれる前提)。
 */
export async function resolveSiteMeta(): Promise<ResolvedSiteMeta> {
  const [seoResult, analyticsResult, brandingResult] = await Promise.all([
    settingsFacade.getPublicValue("seo_defaults"),
    settingsFacade.getPublicValue("analytics"),
    settingsFacade.getPublicValue("branding"),
  ]);

  if (!seoResult.ok) {
    console.error(
      "[site-metadata] seo_defaults の読み取りに失敗しました (fallback で描画継続):",
      seoResult.detail,
    );
  }
  if (!analyticsResult.ok) {
    console.error(
      "[site-metadata] analytics の読み取りに失敗しました (GA 無効化で描画継続):",
      analyticsResult.detail,
    );
  }
  if (!brandingResult.ok) {
    console.error(
      "[site-metadata] branding の読み取りに失敗しました (既定 favicon で描画継続):",
      brandingResult.detail,
    );
  }

  const seoValue = seoResult.ok ? seoResult.value : null;
  const source: ResolvedSiteMeta["source"] = seoValue ? "db" : "fallback";

  const ga4MeasurementId = analyticsResult.ok ? (analyticsResult.value?.ga4_measurement_id ?? null) : null;
  const faviconMediaId = brandingResult.ok ? (brandingResult.value?.favicon_media_id ?? null) : null;

  const ogImage = await resolveOgImage(seoValue);

  return {
    source,
    titleDefault: SITE_META_FALLBACK.titleDefault,
    titleTemplate: seoValue?.title_template ?? SITE_META_FALLBACK.titleTemplate,
    description: seoValue?.description ?? SITE_META_FALLBACK.description,
    ogTitle: SITE_META_FALLBACK.ogTitle,
    // source と seoValue の有無は常に連動する (source="db" ⇔ seoValue が非 null) ため、
    // 非 null アサーションを使わずに ?? で同じ分岐を表現できる (§5.2 の解決規則表と同値)。
    ogDescription: seoValue?.description ?? SITE_META_FALLBACK.ogDescription,
    ogImage,
    gaId: resolveGaId(ga4MeasurementId, process.env.VERCEL_ENV),
    faviconHref: faviconMediaId ? `/icon?v=${faviconMediaId.slice(0, 8)}` : null,
  };
}

/**
 * ResolvedSiteMeta → Metadata (純関数、I/O なし)。
 *
 * Next.js のセグメント間メタマージは「トップレベルフィールド単位の浅い置換」であるため、
 * title / description / openGraph / twitter は**毎回全量返却**する (部分返却するとフィールド
 * 欠落回帰になる — §5.2 の要)。metadataBase は返さない (root layout の値を継承)。
 */
export function buildSiteMetadata(meta: ResolvedSiteMeta): Metadata {
  const openGraphImage =
    meta.ogImage.kind === "media"
      ? { url: meta.ogImage.url }
      : {
          url: meta.ogImage.url,
          width: meta.ogImage.width,
          height: meta.ogImage.height,
          alt: meta.ogImage.alt,
        };

  return {
    title: {
      default: meta.titleDefault,
      template: meta.titleTemplate,
    },
    description: meta.description,
    openGraph: {
      title: meta.ogTitle,
      description: meta.ogDescription,
      type: "website",
      locale: "ja_JP",
      siteName: SITE_META_FALLBACK.siteName,
      url: SITE_META_FALLBACK.siteUrl,
      images: [openGraphImage],
    },
    twitter: {
      card: "summary_large_image",
      title: meta.ogTitle,
      description: meta.ogDescription,
      images: [meta.ogImage.url],
    },
    icons: meta.faviconHref ? { icon: [{ url: meta.faviconHref, type: "image/png" }] } : undefined,
  };
}
