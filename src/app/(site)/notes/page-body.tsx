import { Fragment } from "react";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/site/empty-state";
import { MediaCover } from "@/components/site/media-cover";
import { CtaBand, PageHead, Section, SectionMark } from "@/components/site/page-blocks";
import { Reveal } from "@/components/site/reveal";
import { SlotText } from "@/components/site/slot-text";

import { formatNoteNo, noteNumberOf } from "@/app/_lib/note-nav";
import type { PublicPostListItem } from "@/app/_lib/public-content";
import type { ResolvedTexts } from "@/modules/page-media/contracts";

import { LegacyNoteAnchorRedirect } from "./_legacy-anchor-redirect";

export function NotesPageBody({
  posts,
  texts,
  editMode,
}: {
  posts: PublicPostListItem[];
  texts: ResolvedTexts;
  editMode: boolean;
}) {
  return (
    <>
      <LegacyNoteAnchorRedirect />
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
          <SlotText
            slotKey="notes.hero.heading"
            resolved={texts["notes.hero.heading"]}
            editMode={editMode}
          />
        }
        lead={
          <SlotText
            slotKey="notes.hero.lead"
            resolved={texts["notes.hero.lead"]}
            editMode={editMode}
            className="mt-8 max-w-3xl text-[15.5px] leading-[2.05] tracking-[0.03em] text-carbon-mid"
          />
        }
      />

      <Section className="pt-6 sm:pt-8">
        <SectionMark
          no="SEC. 01"
          label={texts["notes.articles.label"].text}
          labelSlotKey="notes.articles.label"
          editMode={editMode}
        />
        {posts.length > 1 ? (
          <Reveal
            as="nav"
            aria-label="読みもの目次"
            className="mt-10 border border-hair bg-paper px-6 py-5 sm:px-9 sm:py-8"
          >
            <ul>
              {posts.map((post, i) => (
                <li
                  key={post.id}
                  className="border-b border-dashed border-hair-soft last:border-b-0"
                >
                  <Link
                    href={`/notes/${post.slug}`}
                    className="flex items-baseline gap-[18px] px-0.5 py-3.5 text-[14.5px] font-medium transition-colors duration-[250ms] ease-[var(--ease)] hover:text-soul"
                  >
                    <span className="shrink-0 font-mono text-[10.5px] text-carbon-soft">
                      {formatNoteNo(noteNumberOf(posts, i))}
                    </span>
                    {post.title}
                  </Link>
                </li>
              ))}
            </ul>
          </Reveal>
        ) : null}
        {posts.length === 0 ? (
          <div className="mt-10">
            <EmptyState>
              <SlotText
                slotKey="notes.empty.message"
                resolved={texts["notes.empty.message"]}
                editMode={editMode}
              />
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
                    editMode={editMode}
                    kind="post"
                    id={post.id}
                    mediaId={post.cover?.id ?? null}
                  />
                  <Card className="flex-1 gap-0 rounded-none border-0 bg-transparent py-0 shadow-none">
                    <CardHeader className="gap-2 px-6 pt-6">
                      <span className="font-mono text-[10.5px] tracking-[0.22em] text-soul">
                        {formatNoteNo(noteNumberOf(posts, i))}
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
        <Reveal
          as="div"
          className="mt-[clamp(48px,6vw,72px)] border border-dashed border-hair p-[clamp(26px,3.4vw,40px)] text-center text-[13px] leading-[2.1] text-carbon-soft"
        >
          <SlotText
            as="p"
            className="font-mono text-[10.5px] tracking-[0.22em]"
            slotKey="notes.comingsoon.label"
            resolved={texts["notes.comingsoon.label"]}
            editMode={editMode}
          />
          <SlotText
            as="p"
            className="mt-2.5"
            slotKey="notes.comingsoon.body"
            resolved={texts["notes.comingsoon.body"]}
            editMode={editMode}
            renderLines={(lines) => (
              <>
                {lines.map((line, i) => (
                  <Fragment key={i}>
                    {i > 0 ? <br /> : null}
                    {line}
                  </Fragment>
                ))}
              </>
            )}
          />
        </Reveal>
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
