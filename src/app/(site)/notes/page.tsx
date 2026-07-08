import type { Metadata } from "next";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/site/empty-state";
import { MediaCover } from "@/components/site/media-cover";
import { CtaBand, PageHead, Section, SectionMark } from "@/components/site/page-blocks";
import { Reveal } from "@/components/site/reveal";

import { getPublishedReadingPosts } from "@/app/_lib/public-content";

import { LegacyNoteAnchorRedirect } from "./_legacy-anchor-redirect";

export const metadata: Metadata = {
  title: {
    absolute: "読みもの | 隈部塗装 — 塗りと色の裏側",
  },
  description:
    "隈部塗装の読みもの。工程と色の裏側を言葉で残しています。センチュリーの黒が水研ぎ3回である理由、ディーラーでも同色にならない赤の構造など。",
  openGraph: {
    title: "読みもの | 隈部塗装 — 塗りと色の裏側",
    description: "工程と色の裏側を言葉で残しています。",
    images: ["/img/garage-work.jpg"],
  },
};

export default async function NotesPage() {
  const posts = await getPublishedReadingPosts();

  return (
    <>
      <LegacyNoteAnchorRedirect />
      <PageHead
        index="INDEX 08 — NOTES"
        en="READING ON PAINT & COLOR"
        title={
          <>
            なぜ綺麗なのかは、
            <br />
            写真だけでは伝わらない。
          </>
        }
        lead="工程と色の裏側を、言葉で残しています。専門性は、言語化してはじめて伝わる——それがこの工房の考え方です。"
      />

      <Section className="pt-6 sm:pt-8">
        <SectionMark no="SEC. 01" label="ARTICLES" />
        {posts.length === 0 ? (
          <div className="mt-10">
            <EmptyState>
              読みものは現在準備中です。工程・色の裏側を、順次言葉にして公開していきます。
            </EmptyState>
          </div>
        ) : (
          <div className="mt-10 grid gap-6 sm:grid-cols-2">
            {posts.map((post, i) => (
              <Link key={post.id} href={`/notes/${post.slug}`} className="group block">
                <Reveal
                  as="article"
                  className="flex h-full flex-col overflow-hidden border border-hair bg-paper transition-colors group-hover:border-carbon/40"
                >
                  <MediaCover
                    src={post.cover?.url ?? null}
                    alt={post.cover?.alt ?? post.title}
                    aspect="aspect-[16/9]"
                  />
                  <Card className="flex-1 gap-0 rounded-none border-0 bg-transparent py-0 shadow-none">
                    <CardHeader className="gap-2 px-6 pt-6">
                      <span className="font-mono text-[10px] tracking-[0.18em] text-soul">
                        NOTE {String(i + 1).padStart(2, "0")}
                      </span>
                      <CardTitle className="text-lg leading-snug tracking-wider">
                        {post.title}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="px-6 pb-6">
                      <p className="text-sm leading-7 text-carbon-mid">{post.excerpt}</p>
                    </CardContent>
                  </Card>
                </Reveal>
              </Link>
            ))}
          </div>
        )}
      </Section>

      <CtaBand
        title={
          <>
            読んで気になったことは、
            <br />
            そのまま聞いてください。
          </>
        }
        note="工程・色・素材の相性、どんな質問でも。"
        href="/contact"
        label="相談する"
      />
    </>
  );
}
