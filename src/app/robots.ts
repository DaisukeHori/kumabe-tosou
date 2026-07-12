import type { MetadataRoute } from "next";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://kumabe-tosou.vercel.app";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // /admin (CMS) と /edit (ビジュアルエディタの編集プレビュー専用ルート) は
      // 検索エンジンに出さない (docs/design/visual-media-editor.md §5.3/§10)。
      // /print (sales の印刷専用ルート。署名トークン認証) も同様 (05-site-settings.md §5.5)。
      disallow: ["/admin", "/edit", "/print"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
