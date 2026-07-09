import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getPublishedReadingPostBySlug, listPublishedReadingSlugs } from "@/app/_lib/public-content";

import { NoteDetailPageBody } from "./page-body";

export async function generateStaticParams() {
  const slugs = await listPublishedReadingSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPublishedReadingPostBySlug(slug);
  if (!post) {
    return { title: "読みものが見つかりません | 隈部塗装" };
  }

  return {
    title: { absolute: `${post.title} | 隈部塗装 — 読みもの` },
    description: post.excerpt,
    openGraph: {
      title: `${post.title} | 隈部塗装`,
      description: post.excerpt,
      images: post.cover ? [post.cover.url] : undefined,
    },
  };
}

export default async function NoteDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPublishedReadingPostBySlug(slug);
  if (!post) notFound();

  return <NoteDetailPageBody post={post} editMode={false} />;
}
