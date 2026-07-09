import type { Metadata } from "next";

import { getPublishedBlogPosts } from "@/app/_lib/public-content";

import { BlogPageBody } from "./page-body";

export const metadata: Metadata = {
  title: {
    absolute: "ブログ | 隈部塗装 — 現場の記録",
  },
  description:
    "隈部塗装のブログ。日々の工程・素材・色にまつわる話題を発信しています。",
  openGraph: {
    title: "ブログ | 隈部塗装 — 現場の記録",
    description: "日々の工程・素材・色にまつわる話題を発信しています。",
    images: ["/img/garage-work.jpg"],
  },
};

export default async function BlogPage() {
  const posts = await getPublishedBlogPosts();
  return <BlogPageBody posts={posts} editMode={false} />;
}
