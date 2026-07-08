import type { VoiceInput } from "@/modules/content/contracts";

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
    <div className="p-6">
      <h1 className="mb-6 text-xl font-semibold">お客様の声を新規作成</h1>
      <VoiceForm mode="create" initialValues={EMPTY_VOICE} mediaItems={mediaItems} />
    </div>
  );
}
