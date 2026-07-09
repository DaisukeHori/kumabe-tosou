import Link from "next/link";

import { MediaCover } from "@/components/site/media-cover";
import { ArrowButton, CtaBand, PageHead, Section } from "@/components/site/page-blocks";

import type { PublicPostDetail } from "@/app/_lib/public-content";
import { formatNoteNo, type NoteNav } from "@/app/_lib/note-nav";
import { SimpleMarkdown } from "@/app/_lib/simple-markdown";

export function NoteDetailPageBody({
  post,
  nav,
  editMode,
}: {
  post: PublicPostDetail;
  nav: NoteNav;
  editMode: boolean;
}) {
  return (
    <>
      <PageHead
        index="INDEX 08 — NOTES"
        en="READING ON PAINT & COLOR"
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
                <span className="font-mono text-[10px] tracking-[0.2em] text-carbon-soft">
                  ← PREV — 前の記事
                </span>
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
                <span className="font-mono text-[10px] tracking-[0.2em] text-carbon-soft">
                  NEXT — 次の記事 →
                </span>
                <span className="text-[14.5px] font-medium leading-relaxed">
                  {nav.next.title}
                </span>
              </Link>
            ) : null}
          </nav>
        ) : null}

        <div className="mt-10 flex flex-wrap gap-3">
          <ArrowButton href="/notes">読みもの一覧に戻る</ArrowButton>
        </div>
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
