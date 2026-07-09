"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { ContentGapItem, SlotPanelItem, WorksNavItem } from "./actions";

const STATE_LABEL: Record<SlotPanelItem["state"], string> = {
  default: "既定画像",
  custom: "差し替え済み",
  placeholder: "未設定 (プレースホルダ)",
};

const STATE_CLASS: Record<SlotPanelItem["state"], string> = {
  default: "border-transparent bg-muted text-muted-foreground",
  custom: "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  placeholder: "border-transparent bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "下書き",
  review: "レビュー待ち",
  published: "公開中",
  archived: "アーカイブ",
};

type Props = {
  slots: SlotPanelItem[];
  contentGaps: ContentGapItem[];
  works: WorksNavItem[];
  /** 現在 iframe が表示している施工事例詳細の slug (一覧表示中は null)。§5.1a */
  activeWorkSlug: string | null;
  pending: boolean;
  onSlotClick: (item: SlotPanelItem) => void;
  onGapClick: (item: ContentGapItem) => void;
  onWorkClick: (slug: string) => void;
  onBackToWorksList: () => void;
};

/**
 * 空スロット可視化サイドパネル (§5.4 BLOCKER-3 対応)。
 * iframe クリックだけに頼らず、このページ (route) が持つべき全 slot と、
 * 公開ページに DOM が出ない (未設定の) コンテンツ画像を一覧する。
 *
 * §5.1a: /works タブ選択時は、work_images (ギャラリー) が出る施工事例詳細ページへの
 * 2段ナビ (公開済み一覧 → クリックで /edit/works/{slug} に切り替え) も表示する。
 */
export function SidePanel({
  slots,
  contentGaps,
  works,
  activeWorkSlug,
  pending,
  onSlotClick,
  onGapClick,
  onWorkClick,
  onBackToWorksList,
}: Props) {
  return (
    <aside
      className="flex h-fit flex-col gap-4 rounded-xl border border-border bg-background p-4"
      aria-busy={pending}
    >
      {works.length > 0 && (
        <div>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">施工事例の詳細ページ</h2>
            {activeWorkSlug && (
              <button
                type="button"
                onClick={onBackToWorksList}
                className="shrink-0 text-xs text-primary hover:underline focus-visible:underline focus-visible:outline-none"
              >
                ← 一覧に戻る
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            事例をクリックすると詳細ページに切り替わり、カバー画像・ギャラリーを編集できます。
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {works.map((item) => (
              <li key={item.slug}>
                <button
                  type="button"
                  onClick={() => onWorkClick(item.slug)}
                  aria-current={activeWorkSlug === item.slug ? "true" : undefined}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                    activeWorkSlug === item.slug ? "border-primary bg-primary/10 font-medium" : "border-border",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h2 className="text-sm font-semibold">このページの画像スロット</h2>
        {slots.length === 0 && contentGaps.length === 0 && works.length === 0 && !pending && (
          <p className="mt-2 text-xs text-muted-foreground">このページに編集可能な画像はありません。</p>
        )}
        <ul className="mt-2 flex flex-col gap-1.5">
          {slots.map((item) => (
            <li key={item.slotKey}>
              <button
                type="button"
                onClick={() => onSlotClick(item)}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-border px-2.5 py-1.5 text-left text-xs hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                <Badge variant="outline" className={cn("shrink-0", STATE_CLASS[item.state])}>
                  {STATE_LABEL[item.state]}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {contentGaps.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold">画像未設定のコンテンツ</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            公開ページにまだ表示されていない (下書き、または cover 未設定) ため、ここから直接設定します。
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {contentGaps.map((item) => (
              <li key={`${item.kind}:${item.id}`}>
                <button
                  type="button"
                  onClick={() => onGapClick(item)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-left text-xs hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  <Badge variant="outline" className="shrink-0 border-transparent bg-muted text-muted-foreground">
                    {STATUS_LABEL[item.status] ?? item.status}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
