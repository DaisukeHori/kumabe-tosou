import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MediaCover } from "@/components/site/media-cover";
import { ArrowButton, CtaBand, PageHead, Section } from "@/components/site/page-blocks";

import { getPublishedBlogPostBySlug, listPublishedBlogSlugs } from "@/app/_lib/public-content";
import { SimpleMarkdown } from "@/app/_lib/simple-markdown";

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

  return (
    <>
      <PageHead index="INDEX 09 — BLOG" en="FIELD NOTES" title={post.title} lead={post.excerpt} />

      <Section className="pt-2 sm:pt-4">
        {post.cover ? (
          <div className="mb-8">
            <MediaCover src={post.cover.url} alt={post.cover.alt} aspect="aspect-[21/9]" />
          </div>
        ) : null}

        <div className="max-w-3xl space-y-6 text-[15px] leading-[2.1] tracking-[0.02em] text-carbon-mid [&_strong]:font-bold [&_strong]:text-carbon">
          <SimpleMarkdown text={post.body} />
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <ArrowButton href="/blog">ブログ一覧に戻る</ArrowButton>
        </div>
      </Section>

      <CtaBand
        title={<>もっと詳しく知りたい方へ。</>}
        note="工程・グレード・数量スライドの詳細はサービスページに。"
        href="/service"
        label="サービス・料金を見る"
      />
    </>
  );
}
