import { notFound } from "next/navigation";

import { contentFacade } from "@/modules/content/facade";

import { listMediaForPicker } from "../media-lookup";
import { VoiceForm } from "../VoiceForm";

export const dynamic = "force-dynamic";

export default async function EditVoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [result, mediaItems] = await Promise.all([contentFacade.getVoiceAdmin(id), listMediaForPicker()]);

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
  const voice = result.value;

  return (
    <div className="p-6">
      <h1 className="mb-6 text-xl font-semibold">お客様の声を編集</h1>
      <VoiceForm
        mode="edit"
        voiceId={voice.id}
        status={voice.status}
        updatedAt={voice.updated_at}
        initialValues={{
          customer_initial: voice.customer_initial,
          region: voice.region,
          rating: voice.rating,
          body: voice.body,
          item: voice.item,
          photo_media_id: voice.photo_media_id,
          sort_order: voice.sort_order,
        }}
        mediaItems={mediaItems}
      />
    </div>
  );
}
