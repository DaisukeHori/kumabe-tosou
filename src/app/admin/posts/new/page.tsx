import type { PostInput, PostKind } from "@/modules/content/contracts";

import { listMediaForPicker } from "../media-lookup";
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

  const mediaItems = await listMediaForPicker();

  return (
    <div className="p-6">
      <h1 className="mb-6 text-xl font-semibold">記事を新規作成</h1>
      <PostForm mode="create" initialValues={initialValues} mediaItems={mediaItems} />
    </div>
  );
}
