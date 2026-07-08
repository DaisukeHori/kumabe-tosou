import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { MediaCover } from "@/components/site/media-cover";
import { ArrowButton, CtaBand, PageHead, Section } from "@/components/site/page-blocks";
import { Reveal } from "@/components/site/reveal";

import { getPublishedWorkBySlug, listPublishedWorkSlugs } from "@/app/_lib/public-content";
import { SimpleMarkdown } from "@/app/_lib/simple-markdown";

export async function generateStaticParams() {
  const slugs = await listPublishedWorkSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const work = await getPublishedWorkBySlug(slug);
  if (!work) {
    return { title: "施工事例が見つかりません | 隈部塗装" };
  }

  const description = work.processNote ?? work.body.slice(0, 120);
  return {
    title: { absolute: `${work.title} | 隈部塗装 — 施工事例` },
    description,
    openGraph: {
      title: `${work.title} | 隈部塗装`,
      description,
      images: work.cover ? [work.cover.url] : undefined,
    },
  };
}

export default async function WorkDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const work = await getPublishedWorkBySlug(slug);
  if (!work) notFound();

  const gallery = work.images.length > 0 ? work.images : work.cover ? [work.cover] : [];

  return (
    <>
      <PageHead
        index="INDEX 04 — WORKS"
        en="CASE DETAIL"
        title={work.title}
        lead={work.processNote ?? ""}
      />

      <Section className="pt-2 sm:pt-4">
        <Reveal as="div" className="flex flex-wrap items-center gap-3">
          <Badge
            variant="outline"
            className="w-fit rounded-none border-hair font-mono text-[10px] tracking-[0.14em] text-carbon-mid"
          >
            {work.category}
          </Badge>
        </Reveal>

        {gallery.length > 0 ? (
          <Reveal
            as="div"
            className="mt-8 grid gap-4 sm:grid-cols-2"
          >
            {gallery.map((img) => (
              <MediaCover key={img.id} src={img.url} alt={img.alt} aspect="aspect-[4/3]" />
            ))}
          </Reveal>
        ) : (
          <div className="mt-8">
            <MediaCover src={null} alt={work.title} aspect="aspect-[4/3]" />
          </div>
        )}

        {work.body ? (
          <div className="mt-10 max-w-3xl space-y-6 text-[15px] leading-[2.1] tracking-[0.02em] text-carbon-mid [&_strong]:font-bold [&_strong]:text-carbon">
            <SimpleMarkdown text={work.body} />
          </div>
        ) : null}

        <div className="mt-10 flex flex-wrap gap-3">
          <ArrowButton href="/works">施工事例一覧に戻る</ArrowButton>
        </div>
      </Section>

      <CtaBand
        title={<>あなたの造形物も、この一覧に。</>}
        note="サイズ・個数・グレードの3点がわかれば概算をお出しできます。"
        href="/contact"
        label="相談する"
      />
    </>
  );
}
