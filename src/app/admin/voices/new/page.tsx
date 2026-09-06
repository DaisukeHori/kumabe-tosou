import type { VoiceInput } from "@/modules/content/contracts";
import { requireAdminPage } from "@/app/admin/_lib/require-admin-page";
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
  // 契約書 §3.5: page 先頭でも requireAdmin (E201/E202 は /admin/login へ redirect)
  const auth = await requireAdminPage("/admin/voices/new");
  if (!auth.ok) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">認可の確認に失敗しました ({auth.code}): {auth.detail}</p>
      </div>
    );
  }

  const mediaItems = await listMediaForPicker();
  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader title="お客様の声を新規作成" backHref="/admin/voices" backLabel="← ホームページ更新へ" />
      <VoiceForm mode="create" initialValues={EMPTY_VOICE} mediaItems={mediaItems} />
    </div>
  );
}
