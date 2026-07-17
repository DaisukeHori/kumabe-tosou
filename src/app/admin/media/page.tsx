import Link from "next/link";
import type { Metadata } from "next";

import { NoticePanel, PageHeader, SiteSecondaryTabs } from "@/app/admin/_ui";
import { mediaFacade } from "@/modules/media/facade";

import { MediaGrid } from "./media-grid";

export const metadata: Metadata = { title: "写真・画像" };
export const dynamic = "force-dynamic";

export default async function AdminMediaPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { cursor } = await searchParams;
  const [result, placeholderResult] = await Promise.all([
    mediaFacade.list({ cursor: cursor ?? null, limit: 50 }),
    mediaFacade.countPlaceholders(),
  ]);
  const items = result.ok ? result.value.items : [];
  const nextCursor = result.ok ? result.value.next_cursor : null;
  // 仮素材 (is_placeholder) の残数。現行の仮素材 KPI データをそのまま流用した
  // 「仮画像あり」注意バナー (移行設計.md §1.2A)。取得失敗時はバナー非表示に縮退する。
  const placeholderCount = placeholderResult.ok ? placeholderResult.value : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="写真・画像"
        description="↑↓←→ で移動、Enter で編集、Cmd+S で保存、Esc で閉じます (参照ゼロのみ削除可)。"
      />
      <SiteSecondaryTabs />

      {placeholderCount > 0 && (
        <NoticePanel title="仮画像があります">
          仮素材として登録された画像が {placeholderCount} 枚あります。公開前に本番用の写真へ差し替えてください
          (各画像の編集ダイアログで「仮素材として扱う」を外すと解消されます)。
        </NoticePanel>
      )}

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
