import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getPublishedWorkBySlug, listPublishedWorkSlugs } from "@/app/_lib/public-content";
import { pageMediaFacade } from "@/modules/page-media/facade";

import { WorkDetailPageBody } from "./page-body";

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

  const textsResult = await pageMediaFacade.resolveAllTexts();
  const texts = textsResult.ok ? textsResult.value : {};

  return <WorkDetailPageBody work={work} texts={texts} editMode={false} />;
}
