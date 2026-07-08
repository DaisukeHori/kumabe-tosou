"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import type { AdminVoice } from "@/modules/content/contracts";

const STATUS_LABEL: Record<string, string> = {
  draft: "下書き",
  review: "レビュー待ち",
  published: "公開中",
  archived: "アーカイブ",
};

/** 一覧のキーボード操作 (cms-ai-pipeline.md §5.1): ↑↓ 行移動 / Enter 詳細 / Esc で選択解除 */
export function VoicesListTable({ items }: { items: AdminVoice[] }) {
  const router = useRouter();
  const [focusedIndex, setFocusedIndex] = useState(0);

  useEffect(() => {
    setFocusedIndex((i) => Math.min(i, Math.max(items.length - 1, 0)));
  }, [items.length]);

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">該当するお客様の声がありません。</p>;
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
      router.push(`/admin/voices/${items[focusedIndex].id}`);
    } else if (e.key === "Escape") {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
    }
  }

  return (
    <div
      role="listbox"
      aria-label="お客様の声一覧"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="divide-y divide-border rounded-lg border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {items.map((item, index) => (
        <div
          key={item.id}
          role="option"
          aria-selected={index === focusedIndex}
          onClick={() => router.push(`/admin/voices/${item.id}`)}
          onMouseEnter={() => setFocusedIndex(index)}
          className={`grid cursor-pointer grid-cols-[1fr_auto_auto_auto_auto] items-center gap-4 px-4 py-3 text-sm ${
            index === focusedIndex ? "bg-muted" : ""
          }`}
        >
          <div className="min-w-0 truncate">{item.body}</div>
          <div className="text-xs whitespace-nowrap text-muted-foreground">{item.region}</div>
          <div className="text-xs whitespace-nowrap" aria-label={`評価 ${item.rating} / 5`}>
            {"★".repeat(item.rating)}
            {"☆".repeat(5 - item.rating)}
          </div>
          <span className="rounded-full border border-border px-2 py-0.5 text-xs whitespace-nowrap">
            {STATUS_LABEL[item.status] ?? item.status}
          </span>
          <div className="text-xs whitespace-nowrap text-muted-foreground">
            {new Date(item.updated_at).toLocaleString("ja-JP")}
          </div>
        </div>
      ))}
    </div>
  );
}
