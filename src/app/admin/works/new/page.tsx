import type { WorkInput } from "@/modules/content/contracts";
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
    <div className="p-6">
      <h1 className="mb-6 text-xl font-semibold">施工事例を新規作成</h1>
      <WorkForm
        mode="create"
        initialValues={EMPTY_WORK}
        mediaItems={mediaList.items}
        mediaNextCursor={mediaList.nextCursor}
      />
    </div>
  );
}
