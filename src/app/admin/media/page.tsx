import Link from "next/link";
import type { Metadata } from "next";

import { PageHeader } from "@/app/admin/_ui";
import { mediaFacade } from "@/modules/media/facade";

import { MediaGrid } from "./media-grid";

export const metadata: Metadata = { title: "メディア" };
export const dynamic = "force-dynamic";

export default async function AdminMediaPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { cursor } = await searchParams;
  const result = await mediaFacade.list({ cursor: cursor ?? null, limit: 50 });
  const items = result.ok ? result.value.items : [];
  const nextCursor = result.ok ? result.value.next_cursor : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="メディア"
        description="↑↓←→ で移動、Enter で編集、Cmd+S で保存、Esc で閉じます (参照ゼロのみ削除可)。"
      />

      {!result.ok && (
        <p className="text-sm text-destructive">一覧の取得に失敗しました: {result.detail ?? result.code}</p>
      )}

      <MediaGrid items={items} />

      {nextCursor && (
        <div>
          <Link href={`/admin/media?cursor=${encodeURIComponent(nextCursor)}`} className="text-sm underline underline-offset-4">
            次の50件へ →
          </Link>
        </div>
      )}
    </div>
  );
}
