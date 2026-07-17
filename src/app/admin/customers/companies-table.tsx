"use client";

import { useEffect, useState } from "react";

import { DataTableHeaderRow, DataTableShell, dataTableRowClassName, formatJstDate } from "@/app/admin/_ui";
import type { CompanyListItem } from "@/modules/crm/contracts";

import { CompanySheet } from "./CompanySheet";

const GRID_COLS = "grid-cols-[1.5fr_1fr_1.5fr_auto_auto]";

/** 会社一覧 (01-crm.md §8.2 「会社」タブ)。行クリック/Enter で会社 Sheet を開く。 */
export function CompaniesTable({ items }: { items: CompanyListItem[] }) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    setFocusedIndex((i) => Math.min(i, Math.max(items.length - 1, 0)));
  }, [items.length]);

  if (items.length === 0) {
    return <p className="text-label text-muted-foreground">該当する会社がありません。</p>;
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
      setOpenId(items[focusedIndex].id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
    }
  }

  return (
    <>
      <DataTableShell>
        <DataTableHeaderRow columns={["会社名", "電話番号", "住所", "所属顧客数", "更新日"]} gridClassName={GRID_COLS} />
        <div
          role="listbox"
          aria-label="会社一覧"
          tabIndex={0}
          onKeyDown={handleKeyDown}
          className="divide-y divide-border outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
        >
          {items.map((item, index) => (
            <div
              key={item.id}
              role="option"
              aria-selected={index === focusedIndex}
              onClick={() => setOpenId(item.id)}
              onMouseEnter={() => setFocusedIndex(index)}
              className={`grid cursor-pointer items-center gap-4 px-4 py-3 text-table transition-colors ${GRID_COLS} ${dataTableRowClassName(index === focusedIndex)}`}
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-foreground">{item.name}</div>
                {item.name_kana && <div className="truncate text-meta text-admin-text-meta">{item.name_kana}</div>}
              </div>
              <div className="truncate text-meta text-muted-foreground">{item.tel_e164 ?? "—"}</div>
              <div className="truncate text-meta text-muted-foreground">{item.address ?? "—"}</div>
              <div className="text-meta text-muted-foreground">{item.customer_count}</div>
              <div className="text-meta whitespace-nowrap text-muted-foreground">
                {formatJstDate(item.updated_at)}
              </div>
            </div>
          ))}
        </div>
      </DataTableShell>

      <CompanySheet companyId={openId} open={!!openId} onOpenChange={(open) => !open && setOpenId(null)} />
    </>
  );
}
