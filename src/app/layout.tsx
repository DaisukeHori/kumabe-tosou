import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono, Noto_Sans_JP, Shippori_Antique_B1 } from "next/font/google";
import "./globals.css";

const notoSansJP = Noto_Sans_JP({
  variable: "--font-sans",
  subsets: ["latin"],
});

/*
  legacy/css/style.css の --font-wide (font-stretch: 125% で使用) の移植。
  可変フォントの wdth 軸を axes で読み込み、--font-wide (globals.css) から参照される。
*/
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
  // --font-wide は装飾テキスト (透かし番号/章番号) 専用で LCP に関与しないため
  // 全ページ ~208KB の先行プリロードを止める (実測でプラン見積り +25-30KB を大幅超過)
  preload: false,
});

/*
  legacy/index.html の見出しフォント (Shippori Antique B1) の移植。
  --font-disp として globals.css から参照される。
*/
const shipporiAntiqueB1 = Shippori_Antique_B1({
  variable: "--font-shippori",
  weight: "400",
  subsets: ["latin"],
});

/*
  legacy/index.html の mono フォント (IBM Plex Mono) の移植。
  --font-mono (Tailwind の font-mono ユーティリティ) として globals.css から参照される。
*/
const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
});

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://kumabe-tosou.vercel.app";
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${notoSansJP.variable} ${shipporiAntiqueB1.variable} ${ibmPlexMono.variable} ${archivo.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-primer text-carbon">
        {children}
      </body>
    </html>
  );
}
