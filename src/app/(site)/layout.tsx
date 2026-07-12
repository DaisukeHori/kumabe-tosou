import type { Metadata } from "next";
import { GoogleAnalytics } from "@next/third-parties/google";

import { PageTransition } from "@/components/motion/page-transition";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { CustomCursor } from "@/components/motion/custom-cursor";
import { SectionIndicator } from "@/components/motion/section-indicator";
import { PaperNoise } from "@/components/motion/paper-noise";
import { pageMediaFacade } from "@/modules/page-media/facade";
import { buildSiteMetadata, resolveSiteMeta } from "@/app/_lib/site-metadata";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://kumabe-tosou.vercel.app";

/**
 * LocalBusiness JSON-LD の生成 (canonical: 05-site-settings.md §5.2 末尾)。
 * description のみ resolveSiteMeta() の解決結果 (DB seo_defaults.description ?? fallback) を
 * 受け取り、社名・住所等は §0.5 のとおりハードコード維持 (DB 化しない)。
 */
function buildLocalBusinessJsonLd(description: string) {
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: "隈部塗装",
    description,
    url: SITE_URL,
    address: {
      "@type": "PostalAddress",
      addressRegion: "大分県",
      addressLocality: "豊後高田市",
      addressCountry: "JP",
    },
    areaServed: "全国",
    priceRange: "¥¥",
  };
}

/**
 * 公開ページのみ DB (seo_defaults/analytics/branding) 駆動でメタを解決する
 * (root layout `src/app/layout.tsx` は変更不可 — 裁定 J12、§5.2)。
 * title/description/openGraph/twitter/icons を毎回全量返却する (buildSiteMetadata 参照 —
 * Next.js のセグメント間マージがトップレベルフィールド単位の浅い置換のため、部分返却は
 * フィールド欠落回帰になる)。
 */
export async function generateMetadata(): Promise<Metadata> {
  return buildSiteMetadata(await resolveSiteMeta());
}

/*
  公開サイト (/admin/** を除く全ページ) 専用のレイアウト。
  ルートレイアウト (src/app/layout.tsx) は html/body/フォント/globals.css/
  基本 metadata のみを担い、公開サイト固有のグローバルナビ・フッター・
  LocalBusiness JSON-LD はこの route group レイアウトに閉じ込める。
  (site) は URL には出現しないため、配下ページの公開 URL は一切変わらない。
*/
/**
 * SiteHeader/SiteFooter の全表示テキスト (shared.cta.consult / chrome.footer.tagline /
 * common.header.* / common.footer.*) の配線 (canonical: docs/design/visual-text-editor.md
 * §4.1 MAJOR-1、v2 Wave 1 W1-1)。公開 (site) は resolveAllTexts() (unstable_cache 経由・
 * request-time API ではないため SSG を壊さない) を editMode=false で、解決済み全件
 * (`texts`) をそのまま SiteHeader/SiteFooter に渡す (両コンポーネントが内部で
 * slotKey ごとに引く)。
 */
export default async function SiteLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // resolveAllTexts と resolveSiteMeta は互いに依存しない独立読み取りのため並列化する
  // (§5.1 コード例どおり generateMetadata と本体の 2 箇所呼び出しは許容 — unstable_cache が
  // 実クエリを 1 エントリに収束させる)。
  const [textsResult, meta] = await Promise.all([
    pageMediaFacade.resolveAllTexts(),
    resolveSiteMeta(),
  ]);
  const texts = textsResult.ok ? textsResult.value : {};

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(buildLocalBusinessJsonLd(meta.description)),
        }}
      />
      <PaperNoise />
      <SiteHeader texts={texts} editMode={false} />
      <main className="flex-1">
        <PageTransition>{children}</PageTransition>
      </main>
      <SiteFooter texts={texts} editMode={false} />
      {/* 署名演出オーバーレイ (M1)。/edit iframe に載せないため (site) 限定 */}
      <CustomCursor />
      <SectionIndicator />
      {/* GA4 タグ注入。(site) route group のみに存在するため /admin・/edit・/print には
          構造的に載らない (§5.1)。meta.gaId は resolveGaId により VERCEL_ENV==="production"
          のときのみ非 null (§5.1 v1.1 是正)。 */}
      {meta.gaId ? <GoogleAnalytics gaId={meta.gaId} /> : null}
    </>
  );
}
