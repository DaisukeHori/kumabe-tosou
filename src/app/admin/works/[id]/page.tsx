import { notFound } from "next/navigation";

import { PageHeader } from "@/app/admin/_ui";
import { contentFacade } from "@/modules/content/facade";
import { ensureMediaItems, listMediaForPicker } from "@/app/admin/_ui/media-picker-data";

import { WorkForm } from "../WorkForm";

export const dynamic = "force-dynamic";

export default async function EditWorkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [result, mediaList] = await Promise.all([contentFacade.getWorkAdmin(id), listMediaForPicker()]);

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
  const work = result.value;

  // カバー/添付で選択済みの media が一覧の取得件数外に居ても必ずサムネイル表示できるよう補完する。
  const mediaItems = await ensureMediaItems(mediaList.items, [work.cover_media_id, ...work.image_ids]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader title="施工事例を編集" backHref="/admin/works" backLabel="← ホームページ更新へ" />
      <WorkForm
        mode="edit"
        workId={work.id}
        status={work.status}
        updatedAt={work.updated_at}
        initialValues={{
          slug: work.slug,
          title: work.title,
          category: work.category,
          body: work.body,
          process_note: work.process_note,
          cover_media_id: work.cover_media_id,
          image_ids: work.image_ids,
          sort_order: work.sort_order,
        }}
        mediaItems={mediaItems}
        mediaNextCursor={mediaList.nextCursor}
      />
    </div>
  );
}
