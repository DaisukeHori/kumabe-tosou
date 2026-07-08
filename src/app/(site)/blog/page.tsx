import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/site/empty-state";
import { MediaCover } from "@/components/site/media-cover";
import { CtaBand, PageHead, Section, SectionMark } from "@/components/site/page-blocks";
import { Reveal } from "@/components/site/reveal";

import { getPublishedBlogPosts } from "@/app/_lib/public-content";

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

  return (
    <>
      <PageHead
        index="INDEX 09 — BLOG"
        en="FIELD NOTES"
        title={
          <>
            現場の今日を、
            <br />
            そのまま記録する。
          </>
        }
        lead="工程の合間に生まれた気づきや、素材・色にまつわる話題を発信しています。"
      />

      <Section className="pt-6 sm:pt-8">
        <SectionMark no="SEC. 01" label="POSTS" />
        {posts.length === 0 ? (
          <div className="mt-10">
            <EmptyState>
              ブログは現在準備中です。現場の記録が整い次第、順次公開します。
            </EmptyState>
          </div>
        ) : (
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <Link key={post.id} href={`/blog/${post.slug}`} className="group block">
                <Reveal
                  as="article"
                  className="flex h-full flex-col overflow-hidden border border-hair bg-paper transition-colors group-hover:border-carbon/40"
                >
                  <MediaCover
                    src={post.cover?.url ?? null}
                    alt={post.cover?.alt ?? post.title}
                  />
                  <Card className="flex-1 gap-0 rounded-none border-0 bg-transparent py-0 shadow-none">
                    <CardHeader className="gap-2 px-5 pt-5">
                      <CardTitle className="text-base leading-snug tracking-wider">
                        {post.title}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-5 pb-5">
                      <p className="text-xs leading-6 text-carbon-mid">{post.excerpt}</p>
                    </CardContent>
                  </Card>
                </Reveal>
              </Link>
            ))}
          </div>
        )}
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
