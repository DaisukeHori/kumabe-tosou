import type { VoiceInput } from "@/modules/content/contracts";
import { PageHeader } from "@/app/admin/_ui";

import { listMediaForPicker } from "../media-lookup";
import { VoiceForm } from "../VoiceForm";

export const dynamic = "force-dynamic";

const EMPTY_VOICE: VoiceInput = {
  customer_initial: "",
  region: "",
  rating: 5,
  body: "",
  item: null,
  photo_media_id: null,
  sort_order: 0,
};

export default async function NewVoicePage() {
  const mediaItems = await listMediaForPicker();
  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader title="お客様の声を新規作成" backHref="/admin/voices" backLabel="← ホームページ更新へ" />
      <VoiceForm mode="create" initialValues={EMPTY_VOICE} mediaItems={mediaItems} />
    </div>
  );
}
