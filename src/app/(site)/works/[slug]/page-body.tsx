import { Badge } from "@/components/ui/badge";
import { MediaCover } from "@/components/site/media-cover";
import { ArrowButton, CtaBand, PageHead, Section } from "@/components/site/page-blocks";
import { Reveal } from "@/components/site/reveal";
import { workImageEditableAttrs } from "@/components/site/editable-attrs";
import { SlotText } from "@/components/site/slot-text";

import type { PublicWorkDetail } from "@/app/_lib/public-content";
import { SimpleMarkdown } from "@/app/_lib/simple-markdown";
import type { ResolvedTexts } from "@/modules/page-media/contracts";

export function WorkDetailPageBody({
  work,
  texts,
  editMode,
}: {
  work: PublicWorkDetail;
  texts: ResolvedTexts;
  editMode: boolean;
}) {
  // work.images (実際の work_images ギャラリー) があればそれを、無ければ cover 1 枚を表示する。
  // ギャラリーは data-editable-work-image、cover 代用時は data-editable-content (kind=work) を
  // 出す (docs/design/visual-media-editor.md §1)。
  const hasGallery = work.images.length > 0;
  const gallery = hasGallery ? work.images : work.cover ? [work.cover] : [];

  return (
    <>
      <PageHead
        index={
          <SlotText
            slotKey="works.detail.hero.index"
            resolved={texts["works.detail.hero.index"]}
            editMode={editMode}
          />
        }
        en={
          <SlotText
            slotKey="works.detail.hero.en"
            resolved={texts["works.detail.hero.en"]}
            editMode={editMode}
          />
        }
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
            {gallery.map((img) =>
              hasGallery ? (
                <div key={img.id} {...workImageEditableAttrs(work.id, img.id, editMode)}>
                  <MediaCover src={img.url} alt={img.alt} aspect="aspect-[4/3]" />
                </div>
              ) : (
                <MediaCover
                  key={img.id}
                  src={img.url}
                  alt={img.alt}
                  aspect="aspect-[4/3]"
                  editMode={editMode}
                  kind="work"
                  id={work.id}
                  mediaId={img.id}
                />
              ),
            )}
          </Reveal>
        ) : (
          <div className="mt-8">
            <MediaCover
              src={null}
              alt={work.title}
              aspect="aspect-[4/3]"
              editMode={editMode}
              kind="work"
              id={work.id}
              mediaId={null}
            />
          </div>
        )}

        {work.body ? (
          <div className="mt-10 max-w-3xl space-y-6 text-[15px] leading-[2.1] tracking-[0.02em] text-carbon-mid [&_strong]:font-bold [&_strong]:text-carbon">
            <SimpleMarkdown text={work.body} />
          </div>
        ) : null}

        <div className="mt-10 flex flex-wrap gap-3">
          <ArrowButton href="/works">
            <SlotText
              slotKey="works.detail.back.label"
              resolved={texts["works.detail.back.label"]}
              editMode={editMode}
            />
          </ArrowButton>
        </div>
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
