"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { ContentStatusBadge, DataTableHeaderRow, DataTableShell, dataTableRowClassName, formatJstDateTime } from "@/app/admin/_ui";
import type { AdminPost } from "@/modules/content/contracts";

const GRID_COLS = "grid-cols-[1fr_auto_auto_auto]";

const KIND_LABEL: Record<string, string> = {
  reading: "読みもの",
  news: "お知らせ",
  blog: "AIブログ",
};

/** 一覧のキーボード操作 (cms-ai-pipeline.md §5.1): ↑↓ 行移動 / Enter 詳細 / Esc で選択解除 */
export function PostsListTable({ items }: { items: AdminPost[] }) {
  const router = useRouter();
  const [focusedIndex, setFocusedIndex] = useState(0);

  useEffect(() => {
    setFocusedIndex((i) => Math.min(i, Math.max(items.length - 1, 0)));
  }, [items.length]);

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">該当する記事がありません。</p>;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      router.push(`/admin/posts/${items[focusedIndex].id}`);
    } else if (e.key === "Escape") {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
    }
  }

  return (
    <DataTableShell>
      <DataTableHeaderRow columns={["タイトル", "種別", "状態", "更新日時"]} gridClassName={GRID_COLS} />
      <div
        role="listbox"
        aria-label="記事一覧"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="divide-y divide-border outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
      >
        {items.map((item, index) => (
          <div
            key={item.id}
            role="option"
            aria-selected={index === focusedIndex}
            onClick={() => router.push(`/admin/posts/${item.id}`)}
            onMouseEnter={() => setFocusedIndex(index)}
            className={`grid cursor-pointer items-center gap-4 px-4 py-3 text-sm transition-colors ${GRID_COLS} ${dataTableRowClassName(index === focusedIndex)}`}
          >
            <div className="min-w-0">
              <div className="truncate font-medium">{item.title}</div>
              <div className="truncate text-xs text-muted-foreground">{item.slug}</div>
            </div>
            <span className="rounded-full border border-border px-2 py-0.5 text-xs whitespace-nowrap">
              {KIND_LABEL[item.kind] ?? item.kind}
            </span>
            <ContentStatusBadge status={item.status} />
            <div className="text-xs whitespace-nowrap text-muted-foreground">
              {formatJstDateTime(item.updated_at)}
            </div>
          </div>
        ))}
      </div>
    </DataTableShell>
  );
}
