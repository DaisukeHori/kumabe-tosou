import { Badge } from "@/components/ui/badge";
import { MediaCover } from "@/components/site/media-cover";
import { ArrowButton, CtaBand, PageHead, Section } from "@/components/site/page-blocks";
import { Reveal } from "@/components/site/reveal";
import { workImageEditableAttrs } from "@/components/site/editable-attrs";

import type { PublicWorkDetail } from "@/app/_lib/public-content";
import { SimpleMarkdown } from "@/app/_lib/simple-markdown";

export function WorkDetailPageBody({
  work,
  editMode,
}: {
  work: PublicWorkDetail;
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
