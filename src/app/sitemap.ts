import type { MetadataRoute } from "next";

import {
  getPublishedBlogPosts,
  getPublishedReadingPosts,
  getPublishedWorks,
} from "@/app/_lib/public-content";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://kumabe-tosou.vercel.app";

/*
  /tokushoho は metadata.robots.index = false (noindex) のため、
  検索エンジン向け sitemap には含めない。
*/
const STATIC_ROUTES = [
  { path: "/", priority: 1, changeFrequency: "weekly" as const },
  { path: "/story", priority: 0.7, changeFrequency: "monthly" as const },
  { path: "/about", priority: 0.7, changeFrequency: "monthly" as const },
  { path: "/service", priority: 0.9, changeFrequency: "monthly" as const },
  { path: "/works", priority: 0.8, changeFrequency: "weekly" as const },
  { path: "/voices", priority: 0.6, changeFrequency: "weekly" as const },
  { path: "/materials", priority: 0.7, changeFrequency: "monthly" as const },
  { path: "/colors", priority: 0.7, changeFrequency: "monthly" as const },
  { path: "/notes", priority: 0.5, changeFrequency: "monthly" as const },
  { path: "/blog", priority: 0.5, changeFrequency: "weekly" as const },
  { path: "/shop", priority: 0.8, changeFrequency: "weekly" as const },
  { path: "/process", priority: 0.6, changeFrequency: "monthly" as const },
  { path: "/contact", priority: 0.9, changeFrequency: "monthly" as const },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" as const },
] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date();

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((route) => ({
    url: `${SITE_URL}${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  // 公開済み works/notes(reading)/blog の詳細 URL を DB から動的に追加する
  // (cms-ai-pipeline.md §6.4: 「sitemap.ts は DB から動的生成に置換」)。
  // DB 未投入 / 取得失敗時は各関数が [] を返す (public-content.ts の safeQuery)ため、
  // sitemap 生成自体は落ちない。
  const [works, notes, blogPosts] = await Promise.all([
    getPublishedWorks(),
    getPublishedReadingPosts(),
    getPublishedBlogPosts(),
  ]);

  const workEntries: MetadataRoute.Sitemap = works.map((w) => ({
    url: `${SITE_URL}/works/${w.slug}`,
    lastModified: new Date(w.publishedAt),
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  const noteEntries: MetadataRoute.Sitemap = notes.map((p) => ({
    url: `${SITE_URL}/notes/${p.slug}`,
    lastModified: new Date(p.publishedAt),
    changeFrequency: "monthly",
    priority: 0.5,
  }));

  const blogEntries: MetadataRoute.Sitemap = blogPosts.map((p) => ({
    url: `${SITE_URL}/blog/${p.slug}`,
    lastModified: new Date(p.publishedAt),
    changeFrequency: "monthly",
    priority: 0.5,
  }));

  return [...staticEntries, ...workEntries, ...noteEntries, ...blogEntries];
}
