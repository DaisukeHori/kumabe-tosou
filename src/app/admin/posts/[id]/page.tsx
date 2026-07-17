import { notFound } from "next/navigation";

import { PageHeader } from "@/app/admin/_ui";
import { contentFacade } from "@/modules/content/facade";
import { ensureMediaItems, listMediaForPicker } from "@/app/admin/_ui/media-picker-data";

import { PostForm } from "../PostForm";

export const dynamic = "force-dynamic";

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [result, mediaList] = await Promise.all([contentFacade.getPostAdmin(id), listMediaForPicker()]);

  if (!result.ok) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">
          取得に失敗しました ({result.code}): {result.detail}
        </p>
      </div>
    );
  }
  if (!result.value) notFound();
  const post = result.value;

  // カバー画像で選択済みの media が一覧の取得件数外に居ても必ずサムネイル表示できるよう補完する。
  const mediaItems = await ensureMediaItems(mediaList.items, [post.cover_media_id]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="記事を編集"
        backHref={`/admin/posts?kind=${post.kind}`}
        backLabel="← ホームページ更新へ"
      />
      <PostForm
        mode="edit"
        postId={post.id}
        status={post.status}
        updatedAt={post.updated_at}
        initialValues={{
          slug: post.slug,
          kind: post.kind,
          title: post.title,
          excerpt: post.excerpt,
          body: post.body,
          cover_media_id: post.cover_media_id,
        }}
        mediaItems={mediaItems}
        mediaNextCursor={mediaList.nextCursor}
        sourceRunId={post.source_run_id}
      />
    </div>
  );
}
