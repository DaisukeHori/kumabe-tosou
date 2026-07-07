import type { Metadata } from "next";
import { Geist_Mono, Noto_Sans_JP } from "next/font/google";
import "./globals.css";

import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";

const notoSansJP = Noto_Sans_JP({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = "https://kumabe-tosou.vercel.app";
const SITE_TITLE = "隈部塗装 | 3Dプリント表面処理の専門工房 — 大分県豊後高田市";
const SITE_DESCRIPTION =
  "3Dプリントを、量産品と見分けがつかない外観に。積層痕除去の研磨から自動車グレードの塗装仕上げまで、試作1点からブリッジ生産1,000個まで郵送で全国受託。隈部塗装(大分県豊後高田市)。";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: "%s | 隈部塗装",
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    title: "隈部塗装 | 3Dプリント表面処理の専門工房",
    description:
      "積層痕を消す研磨から、自動車グレードの塗装仕上げまで。郵送で全国からお受けします。",
    type: "website",
    locale: "ja_JP",
    siteName: "隈部塗装",
    url: SITE_URL,
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 630,
        alt: "隈部塗装 — 3Dプリント表面処理の専門工房",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "隈部塗装 | 3Dプリント表面処理の専門工房",
    description:
      "積層痕を消す研磨から、自動車グレードの塗装仕上げまで。郵送で全国からお受けします。",
    images: ["/og-image.jpg"],
  },
};

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${notoSansJP.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(LOCAL_BUSINESS_JSON_LD),
          }}
        />
      </head>
      <body className="flex min-h-full flex-col bg-primer text-carbon">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
