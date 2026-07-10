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
import { SlotText } from "@/components/site/slot-text";

import type { PublicWorkListItem } from "@/app/_lib/public-content";
import type { ResolvedTexts } from "@/modules/page-media/contracts";

export function WorksPageBody({
  works,
  texts,
  editMode,
}: {
  works: PublicWorkListItem[];
  texts: ResolvedTexts;
  editMode: boolean;
}) {
  const hasPlaceholderPhotos = works.some((w) => w.cover?.isPlaceholder);

  return (
    <>
      <PageHead
        index="INDEX 04 — WORKS"
        en="FINISHING SAMPLES"
        title={
          <SlotText
            slotKey="works.hero.heading"
            resolved={texts["works.hero.heading"]}
            editMode={editMode}
          />
        }
        lead={
          <SlotText
            slotKey="works.hero.lead"
            resolved={texts["works.hero.lead"]}
            editMode={editMode}
            className="mt-8 max-w-3xl text-[15.5px] leading-[2.05] tracking-[0.03em] text-carbon-mid"
          />
        }
      />

      <Section className="pt-6 sm:pt-8">
        <SectionMark
          no="SEC. 01"
          label={texts["works.sec.1.label"].text}
          labelSlotKey="works.sec.1.label"
          editMode={editMode}
        />
        {works.length === 0 ? (
          <div className="mt-10">
            <EmptyState
              label={texts["works.empty.label"].text}
              labelSlotKey="works.empty.label"
              editMode={editMode}
            >
              <SlotText
                slotKey="works.empty.body"
                resolved={texts["works.empty.body"]}
                editMode={editMode}
              />
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
                <SlotText
                  slotKey="works.gallery.placeholder.note"
                  resolved={texts["works.gallery.placeholder.note"]}
                  editMode={editMode}
                />
              </MapNote>
            ) : null}
          </>
        )}
      </Section>

      <Section>
        <SectionMark
          no="SEC. 02"
          label={texts["works.sec.2.label"].text}
          labelSlotKey="works.sec.2.label"
          editMode={editMode}
        />
        <SecTitle>
          <SlotText
            slotKey="works.cms.heading"
            resolved={texts["works.cms.heading"]}
            editMode={editMode}
          />
        </SecTitle>
        <SecLead>
          <SlotText
            slotKey="works.cms.lead"
            resolved={texts["works.cms.lead"]}
            editMode={editMode}
          />
        </SecLead>
      </Section>

      <CtaBand
        title={
          <SlotText
            slotKey="works.cta.heading"
            resolved={texts["works.cta.heading"]}
            editMode={editMode}
          />
        }
        note={
          <SlotText
            slotKey="works.cta.note"
            resolved={texts["works.cta.note"]}
            editMode={editMode}
          />
        }
        href="/contact"
        label={texts["shared.cta.consult"].text}
        labelSlotKey="shared.cta.consult"
        editMode={editMode}
      />
    </>
  );
}
