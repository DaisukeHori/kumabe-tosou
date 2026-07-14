"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { DataTableHeaderRow, DataTableShell, dataTableRowClassName } from "@/app/admin/_ui";
import type { DocumentListItem } from "@/modules/sales/contracts";

import { DOC_TYPE_LABEL, DocumentStatusBadge, formatJpy } from "./_shared";

const GRID_COLS = "grid-cols-[1fr_auto_1.2fr_1.2fr_auto_auto_auto]";

/**
 * 帳票一覧テーブル (§8.2)。キーボード: ↑↓ 行移動 / Enter 詳細へ (§8.7)。
 * `/` (検索フォーカス) と Esc (検索クリア) は親 (page.tsx 側の検索 input) が担当するため、
 * ここでは行フォーカスと Enter 遷移のみを持つ (deals-table.tsx と同型の分割)。
 */
export function DocumentsTable({ items }: { items: DocumentListItem[] }) {
  const router = useRouter();
  const [focusedIndex, setFocusedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFocusedIndex((i) => Math.min(i, Math.max(items.length - 1, 0)));
  }, [items.length]);

  useEffect(() => {
    function handleSlash(e: KeyboardEvent) {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>("[data-documents-search]")?.focus();
      }
    }
    window.addEventListener("keydown", handleSlash);
    return () => window.removeEventListener("keydown", handleSlash);
  }, []);

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">該当する帳票がありません。</p>;
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
      router.push(`/admin/documents/${items[focusedIndex].id}`);
    }
  }

  return (
    <DataTableShell>
      <DataTableHeaderRow
        columns={["書類番号", "種別", "宛名", "案件名", "金額", "状態", "発行日"]}
        gridClassName={GRID_COLS}
      />
      <div
        ref={containerRef}
        role="listbox"
        aria-label="帳票一覧"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="divide-y divide-border outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
      >
        {items.map((item, index) => (
          <div
            key={item.id}
            role="option"
            aria-selected={index === focusedIndex}
            onClick={() => router.push(`/admin/documents/${item.id}`)}
            onMouseEnter={() => setFocusedIndex(index)}
            className={`grid cursor-pointer items-center gap-4 px-4 py-3 text-sm transition-colors ${GRID_COLS} ${dataTableRowClassName(index === focusedIndex)}`}
          >
            <div className="min-w-0 truncate font-medium">
              {item.doc_no ?? <span className="text-muted-foreground">下書き</span>}
            </div>
            <div className="text-xs text-muted-foreground">{DOC_TYPE_LABEL[item.doc_type]}</div>
            <div className="min-w-0 truncate text-xs text-muted-foreground">{item.billing_name}</div>
            <div className="min-w-0 truncate text-xs text-muted-foreground">{item.deal_title}</div>
            <div className="text-xs whitespace-nowrap">{formatJpy(item.total_jpy)}</div>
            <DocumentStatusBadge status={item.status} />
            <div className="text-xs whitespace-nowrap text-muted-foreground">{item.issue_date ?? "—"}</div>
          </div>
        ))}
      </div>
    </DataTableShell>
  );
}
