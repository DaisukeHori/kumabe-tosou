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
      disallow: ["/admin", "/edit"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
