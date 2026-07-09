import { MediaCover } from "@/components/site/media-cover";
import { ArrowButton, CtaBand, PageHead, Section } from "@/components/site/page-blocks";

import type { PublicPostDetail } from "@/app/_lib/public-content";
import { SimpleMarkdown } from "@/app/_lib/simple-markdown";

export function NoteDetailPageBody({
  post,
  editMode,
}: {
  post: PublicPostDetail;
  editMode: boolean;
}) {
  return (
    <>
      <PageHead index="INDEX 08 — NOTES" en="READING ON PAINT & COLOR" title={post.title} lead={post.excerpt} />

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
