import { PageTransition } from "@/components/motion/page-transition";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://kumabe-tosou.vercel.app";
const SITE_DESCRIPTION =
  "3Dプリントを、量産品と見分けがつかない外観に。積層痕除去の研磨から自動車グレードの塗装仕上げまで、試作1点からブリッジ生産1,000個まで郵送で全国受託。隈部塗装(大分県豊後高田市)。";

const LOCAL_BUSINESS_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  name: "隈部塗装",
  description: SITE_DESCRIPTION,
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

/*
  公開サイト (/admin/** を除く全ページ) 専用のレイアウト。
  ルートレイアウト (src/app/layout.tsx) は html/body/フォント/globals.css/
  基本 metadata のみを担い、公開サイト固有のグローバルナビ・フッター・
  LocalBusiness JSON-LD はこの route group レイアウトに閉じ込める。
  (site) は URL には出現しないため、配下ページの公開 URL は一切変わらない。
*/
export default function SiteLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(LOCAL_BUSINESS_JSON_LD),
        }}
      />
      <SiteHeader />
      <main className="flex-1">
        <PageTransition>{children}</PageTransition>
      </main>
      <SiteFooter />
    </>
  );
}
