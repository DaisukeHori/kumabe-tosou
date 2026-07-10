import Link from "next/link";

import { MediaCover } from "@/components/site/media-cover";
import { ArrowButton, CtaBand, PageHead, Section } from "@/components/site/page-blocks";
import { SlotText } from "@/components/site/slot-text";

import type { PublicPostDetail } from "@/app/_lib/public-content";
import { formatNoteNo, type NoteNav } from "@/app/_lib/note-nav";
import { SimpleMarkdown } from "@/app/_lib/simple-markdown";
import type { ResolvedTexts } from "@/modules/page-media/contracts";

export function NoteDetailPageBody({
  post,
  nav,
  texts,
  editMode,
}: {
  post: PublicPostDetail;
  nav: NoteNav;
  texts: ResolvedTexts;
  editMode: boolean;
}) {
  return (
    <>
      <PageHead
        index={
          <SlotText
            slotKey="notes.hero.index"
            resolved={texts["notes.hero.index"]}
            editMode={editMode}
          />
        }
        en={
          <SlotText
            slotKey="notes.hero.en"
            resolved={texts["notes.hero.en"]}
            editMode={editMode}
          />
        }
        title={
          <>
            {nav.noteNo !== null ? (
              /* legacy .article-no (css:962-969): mono / 0.22em / soul の 2 段見出し */
              <span className="mb-4 block font-mono text-[11px] font-normal tracking-[0.22em] text-soul">
                {formatNoteNo(nav.noteNo)}
              </span>
            ) : null}
            {post.title}
          </>
        }
        lead={post.excerpt}
      />

      <Section className="pt-2 sm:pt-4">
        {post.cover ? (
          <div className="mb-8">
            <MediaCover
              src={post.cover.url}
              alt={post.cover.alt}
              aspect="aspect-[21/9]"
              editMode={editMode}
              kind="post"
              id={post.id}
              mediaId={post.cover.id}
            />
          </div>
        ) : null}

        <div className="max-w-3xl space-y-6 text-[15px] leading-[2.1] tracking-[0.02em] text-carbon-mid [&_strong]:font-bold [&_strong]:text-carbon">
          <SimpleMarkdown text={post.body} />
        </div>

        {/* 前後記事ナビ (notes-toc 意匠 css:938-955 の応用 + hover 0.25s var(--ease)) */}
        {nav.prev || nav.next ? (
          <nav
            aria-label="前後の読みもの"
            className="mt-12 grid border-y border-hair sm:grid-cols-2"
          >
            {nav.prev ? (
              <Link
                href={`/notes/${nav.prev.slug}`}
                className="kt-note-nav-link flex flex-col gap-1.5 border-b border-hair px-1 py-5 transition-colors duration-[250ms] ease-[var(--ease)] hover:text-soul sm:border-b-0 sm:border-r sm:pr-6"
              >
                <SlotText
                  as="span"
                  className="font-mono text-[10px] tracking-[0.2em] text-carbon-soft"
                  slotKey="notes.detail.prev.label"
                  resolved={texts["notes.detail.prev.label"]}
                  editMode={editMode}
                />
                <span className="text-[14.5px] font-medium leading-relaxed">
                  {nav.prev.title}
                </span>
              </Link>
            ) : (
              <span aria-hidden="true" className="hidden sm:block sm:border-r sm:border-hair" />
            )}
            {nav.next ? (
              <Link
                href={`/notes/${nav.next.slug}`}
                className="kt-note-nav-link flex flex-col items-start gap-1.5 px-1 py-5 transition-colors duration-[250ms] ease-[var(--ease)] hover:text-soul sm:items-end sm:pl-6 sm:text-right"
              >
                <SlotText
                  as="span"
                  className="font-mono text-[10px] tracking-[0.2em] text-carbon-soft"
                  slotKey="notes.detail.next.label"
                  resolved={texts["notes.detail.next.label"]}
                  editMode={editMode}
                />
                <span className="text-[14.5px] font-medium leading-relaxed">
                  {nav.next.title}
                </span>
              </Link>
            ) : null}
          </nav>
        ) : null}

        <div className="mt-10 flex flex-wrap gap-3">
          <ArrowButton href="/notes">
            <SlotText
              slotKey="notes.detail.back"
              resolved={texts["notes.detail.back"]}
              editMode={editMode}
            />
          </ArrowButton>
        </div>
      </Section>

      <CtaBand
        title={
          <SlotText
            slotKey="notes.cta.heading"
            resolved={texts["notes.cta.heading"]}
            editMode={editMode}
          />
        }
        note={
          <SlotText
            slotKey="notes.cta.note"
            resolved={texts["notes.cta.note"]}
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
