import type { PostInput, PostKind } from "@/modules/content/contracts";
import { PageHeader } from "@/app/admin/_ui";
import { listMediaForPicker } from "@/app/admin/_ui/media-picker-data";

import { PostForm } from "../PostForm";

export const dynamic = "force-dynamic";

function isPostKind(value: string | undefined): value is PostKind {
  return value === "reading" || value === "news" || value === "blog";
}

export default async function NewPostPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const params = await searchParams;
  const kind: PostKind = isPostKind(params.kind) ? params.kind : "reading";

  const initialValues: PostInput = {
    slug: "",
    kind,
    title: "",
    excerpt: "",
    body: "",
    cover_media_id: null,
  };

  const mediaList = await listMediaForPicker();

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="記事を新規作成"
        backHref={`/admin/posts?kind=${kind}`}
        backLabel="← ホームページ更新へ"
      />
      <PostForm
        mode="create"
        initialValues={initialValues}
        mediaItems={mediaList.items}
        mediaNextCursor={mediaList.nextCursor}
      />
    </div>
  );
}
