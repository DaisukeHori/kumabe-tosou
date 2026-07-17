import type { WorkInput } from "@/modules/content/contracts";
import { PageHeader } from "@/app/admin/_ui";
import { listMediaForPicker } from "@/app/admin/_ui/media-picker-data";

import { WorkForm } from "../WorkForm";

export const dynamic = "force-dynamic";

const EMPTY_WORK: WorkInput = {
  slug: "",
  title: "",
  category: "",
  body: "",
  process_note: null,
  cover_media_id: null,
  image_ids: [],
  sort_order: 0,
};

export default async function NewWorkPage() {
  const mediaList = await listMediaForPicker();
  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader title="施工事例を新規作成" backHref="/admin/works" backLabel="← ホームページ更新へ" />
      <WorkForm
        mode="create"
        initialValues={EMPTY_WORK}
        mediaItems={mediaList.items}
        mediaNextCursor={mediaList.nextCursor}
      />
    </div>
  );
}
