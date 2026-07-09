import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/site/empty-state";
import { MediaCover } from "@/components/site/media-cover";
import {
  CtaBand,
  MapNote,
  PageHead,
  SecLead,
  SecTitle,
  Section,
  SectionMark,
} from "@/components/site/page-blocks";
import { Reveal } from "@/components/site/reveal";

import type { PublicWorkListItem } from "@/app/_lib/public-content";

export function WorksPageBody({
  works,
  editMode,
}: {
  works: PublicWorkListItem[];
  editMode: boolean;
}) {
  const hasPlaceholderPhotos = works.some((w) => w.cover?.isPlaceholder);

  return (
    <>
      <PageHead
        index="INDEX 04 — WORKS"
        en="FINISHING SAMPLES"
        title={
          <>
            3Dプリントを、
            <br />
            量産品の顔に。
          </>
        }
        lead="車両パーツからスマホカバー、小物、エアブラシ作品まで。素材や用途ごとに下地の作り方は変わりますが、狙う仕上がりはいつも「積層痕が消えて、量産品と見分けがつかない表面」です。"
      />

      <Section className="pt-6 sm:pt-8">
        <SectionMark no="SEC. 01" label="SAMPLES" />
        {works.length === 0 ? (
          <div className="mt-10">
            <EmptyState>
              施工事例は現在準備中です。実施工の写真・詳細が整い次第、順次公開します。
            </EmptyState>
          </div>
        ) : (
          <>
            <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {works.map((work) => (
                <Reveal key={work.id} as="div">
                  <Link
                    href={`/works/${work.slug}`}
                    className="group block kt-card-lift kt-photo"
                  >
                    <Card className="gap-0 overflow-hidden rounded-none border-hair bg-paper py-0 shadow-none group-hover:border-carbon/40">
                      <MediaCover
                        src={work.cover?.url ?? null}
                        alt={work.cover?.alt ?? work.title}
                        editMode={editMode}
                        kind="work"
                        id={work.id}
                        mediaId={work.cover?.id ?? null}
                      />
                      <CardHeader className="gap-2 px-5 pt-5">
                        <Badge
                          variant="outline"
                          className="w-fit rounded-none border-hair font-mono text-[9px] tracking-[0.14em] text-carbon-mid"
                        >
                          {work.category}
                        </Badge>
                        <CardTitle className="text-base tracking-wider">{work.title}</CardTitle>
                      </CardHeader>
                      {work.processNote ? (
                        <CardContent className="px-5 pb-5">
                          <p className="text-xs leading-6 text-carbon-mid">{work.processNote}</p>
                        </CardContent>
                      ) : null}
                    </Card>
                  </Link>
                </Reveal>
              ))}
            </div>
            {hasPlaceholderPhotos ? (
              <MapNote>
                ※
                掲載画像の一部はイメージ素材です(実際の施工写真は準備が整い次第、順次差し替えます)。
              </MapNote>
            ) : null}
          </>
        )}
      </Section>

      <Section>
        <SectionMark no="SEC. 02" label="NOTE" />
        <SecTitle>一覧はCMSで管理しています。</SecTitle>
        <SecLead>
          案件写真・素材・グレード・工程の一覧はCMS(管理画面)から更新され、このページへ即時反映されます。
        </SecLead>
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
