import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getPublishedBlogPostBySlug, listPublishedBlogSlugs } from "@/app/_lib/public-content";

import { BlogDetailPageBody } from "./page-body";

export async function generateStaticParams() {
  const slugs = await listPublishedBlogSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPublishedBlogPostBySlug(slug);
  if (!post) {
    return { title: "記事が見つかりません | 隈部塗装" };
  }

  return {
    title: { absolute: `${post.title} | 隈部塗装 — ブログ` },
    description: post.excerpt,
    openGraph: {
      title: `${post.title} | 隈部塗装`,
      description: post.excerpt,
      images: post.cover ? [post.cover.url] : undefined,
    },
  };
}

export default async function BlogDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPublishedBlogPostBySlug(slug);
  if (!post) notFound();

  return <BlogDetailPageBody post={post} editMode={false} />;
}
