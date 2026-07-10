import { Star } from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/site/empty-state";
import { MediaCover } from "@/components/site/media-cover";
import {
  ArrowButton,
  MapNote,
  PageHead,
  Section,
  SectionMark,
} from "@/components/site/page-blocks";
import { Reveal } from "@/components/site/reveal";
import { SlotText } from "@/components/site/slot-text";
import { VoiceBody } from "@/components/site/voice-body";
import { cn } from "@/lib/utils";
import type { ResolvedTexts } from "@/modules/page-media/contracts";

import type { PublicVoiceListItem } from "@/app/_lib/public-content";

function StarRating({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`評価 ${count} / 5`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn(
            "size-4",
            i < count ? "fill-soul text-soul" : "fill-transparent text-carbon-soft/40",
          )}
        />
      ))}
    </div>
  );
}

export function VoicesPageBody({
  voices,
  texts,
  editMode,
}: {
  voices: PublicVoiceListItem[];
  texts: ResolvedTexts;
  editMode: boolean;
}) {
  return (
    <>
      <PageHead
        index={
          <SlotText
            slotKey="voices.hero.index"
            resolved={texts["voices.hero.index"]}
            editMode={editMode}
          />
        }
        en={
          <SlotText
            slotKey="voices.hero.en"
            resolved={texts["voices.hero.en"]}
            editMode={editMode}
          />
        }
        title={
          <SlotText
            slotKey="voices.hero.heading"
            resolved={texts["voices.hero.heading"]}
            editMode={editMode}
          />
        }
        lead={
          <SlotText
            slotKey="voices.hero.lead"
            resolved={texts["voices.hero.lead"]}
            editMode={editMode}
            className="mt-8 max-w-3xl text-[15.5px] leading-[2.05] tracking-[0.03em] text-carbon-mid"
          />
        }
      />

      <Section className="pt-6 sm:pt-8">
        <SectionMark
          no="SEC. 01"
          label={texts["voices.sec.label"].text}
          labelSlotKey="voices.sec.label"
          editMode={editMode}
        />
        {voices.length === 0 ? (
          <div className="mt-10">
            <EmptyState>
              <SlotText
                slotKey="voices.empty.message"
                resolved={texts["voices.empty.message"]}
                editMode={editMode}
              />
            </EmptyState>
          </div>
        ) : (
          <>
            <div className="mt-10 grid gap-6 md:grid-cols-3">
              {voices.map((voice) => (
                <Reveal key={voice.id} as="div">
                  <Card className="kt-card-lift kt-photo h-full justify-between overflow-hidden rounded-none border-hair bg-paper py-0 shadow-none">
                    {voice.photo ? (
                      <MediaCover
                        src={voice.photo.url}
                        alt={voice.photo.alt}
                        aspect="aspect-[16/10]"
                        editMode={editMode}
                        kind="voice"
                        id={voice.id}
                        mediaId={voice.photo.id}
                      />
                    ) : null}
                    <CardHeader className="gap-3 pt-5">
                      <StarRating count={voice.rating} />
                    </CardHeader>
                    <CardContent className="flex flex-1 flex-col justify-between gap-6">
                      <VoiceBody
                        body={voice.body}
                        readMoreText={texts["voices.body.readmore"]}
                        collapseText={texts["voices.body.collapse"]}
                        editMode={editMode}
                      />
                      <div className="border-t border-hair pt-4">
                        <p className="text-sm font-medium tracking-wider">
                          {voice.customerInitial}
                          <SlotText
                            slotKey="voices.card.customer.suffix"
                            resolved={texts["voices.card.customer.suffix"]}
                            editMode={editMode}
                          />
                          <span className="ml-2 text-xs font-normal text-carbon-soft">
                            {voice.region}
                          </span>
                        </p>
                        {voice.item ? (
                          <p className="mt-1 font-mono text-[10px] tracking-[0.14em] text-carbon-soft">
                            <SlotText
                              slotKey="voices.card.item.prefix"
                              resolved={texts["voices.card.item.prefix"]}
                              editMode={editMode}
                            />
                            {voice.item}
                          </p>
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                </Reveal>
              ))}
            </div>
            <MapNote>
              <SlotText
                slotKey="voices.mapnote"
                resolved={texts["voices.mapnote"]}
                editMode={editMode}
              />
            </MapNote>
          </>
        )}
        <div className="mt-8 flex flex-wrap gap-3">
          <ArrowButton href="/works">
            <SlotText
              slotKey="voices.cta.works"
              resolved={texts["voices.cta.works"]}
              editMode={editMode}
            />
          </ArrowButton>
          <ArrowButton href="/contact">
            <SlotText
              slotKey="shared.cta.consult"
              resolved={texts["shared.cta.consult"]}
              editMode={editMode}
            />
          </ArrowButton>
        </div>
      </Section>
    </>
  );
}
