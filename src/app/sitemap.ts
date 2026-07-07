import type { MetadataRoute } from "next";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://kumabe-tosou.vercel.app";

/*
  /tokushoho は metadata.robots.index = false (noindex) のため、
  検索エンジン向け sitemap には含めない。
*/
const ROUTES = [
  { path: "/", priority: 1, changeFrequency: "weekly" as const },
  { path: "/story", priority: 0.7, changeFrequency: "monthly" as const },
  { path: "/about", priority: 0.7, changeFrequency: "monthly" as const },
  { path: "/service", priority: 0.9, changeFrequency: "monthly" as const },
  { path: "/works", priority: 0.8, changeFrequency: "weekly" as const },
  { path: "/voices", priority: 0.6, changeFrequency: "weekly" as const },
  { path: "/materials", priority: 0.7, changeFrequency: "monthly" as const },
  { path: "/colors", priority: 0.7, changeFrequency: "monthly" as const },
  { path: "/notes", priority: 0.5, changeFrequency: "monthly" as const },
  { path: "/shop", priority: 0.8, changeFrequency: "weekly" as const },
  { path: "/process", priority: 0.6, changeFrequency: "monthly" as const },
  { path: "/contact", priority: 0.9, changeFrequency: "monthly" as const },
  { path: "/privacy", priority: 0.3, changeFrequency: "yearly" as const },
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return ROUTES.map((route) => ({
    url: `${SITE_URL}${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
