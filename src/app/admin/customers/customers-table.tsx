"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { DataTableHeaderRow, DataTableShell, dataTableRowClassName } from "@/app/admin/_ui";
import type { CustomerListItem } from "@/modules/crm/contracts";

const GRID_COLS = "grid-cols-[1.4fr_1.4fr_1fr_auto_auto_auto]";

const LIFECYCLE_LABEL: Record<CustomerListItem["lifecycle"], string> = {
  lead: "見込み",
  customer: "取引中",
  archived: "アーカイブ",
};

function lifecycleBadgeVariant(lifecycle: CustomerListItem["lifecycle"]): "default" | "secondary" | "outline" {
  if (lifecycle === "customer") return "default";
  if (lifecycle === "archived") return "outline";
  return "secondary";
}

/** 顧客一覧 (01-crm.md §8.2)。キーボード: ↑↓ 行移動 / Enter 詳細 / Esc 選択解除。 */
export function CustomersTable({ items }: { items: CustomerListItem[] }) {
  const router = useRouter();
  const [focusedIndex, setFocusedIndex] = useState(0);

  useEffect(() => {
    setFocusedIndex((i) => Math.min(i, Math.max(items.length - 1, 0)));
  }, [items.length]);

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">該当する顧客がいません。</p>;
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
      router.push(`/admin/customers/${items[focusedIndex].id}`);
    } else if (e.key === "Escape") {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
    }
  }

  return (
    <DataTableShell>
      <DataTableHeaderRow
        columns={["名前", "連絡先", "会社", "状態", "進行中案件", "登録日"]}
        gridClassName={GRID_COLS}
      />
      <div
        role="listbox"
        aria-label="顧客一覧"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="divide-y divide-border outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
      >
        {items.map((item, index) => (
          <div
            key={item.id}
            role="option"
            aria-selected={index === focusedIndex}
            onClick={() => router.push(`/admin/customers/${item.id}`)}
            onMouseEnter={() => setFocusedIndex(index)}
            className={`grid cursor-pointer items-center gap-4 px-4 py-3 text-sm transition-colors ${GRID_COLS} ${dataTableRowClassName(index === focusedIndex)}`}
          >
            <div className="min-w-0">
              <div className="truncate font-medium">{item.name}</div>
              {item.name_kana && <div className="truncate text-xs text-muted-foreground">{item.name_kana}</div>}
            </div>
            <div className="min-w-0 text-xs text-muted-foreground">
              {item.email && <div className="truncate">{item.email}</div>}
              {item.tel_e164 && <div className="truncate">{item.tel_e164}</div>}
              {!item.email && !item.tel_e164 && "—"}
            </div>
            <div className="truncate text-xs text-muted-foreground">{item.company_name ?? "—"}</div>
            <Badge variant={lifecycleBadgeVariant(item.lifecycle)}>{LIFECYCLE_LABEL[item.lifecycle]}</Badge>
            <div className="text-xs text-muted-foreground">{item.open_deal_count}</div>
            <div className="text-xs whitespace-nowrap text-muted-foreground">
              {new Date(item.created_at).toLocaleDateString("ja-JP")}
            </div>
          </div>
        ))}
      </div>
    </DataTableShell>
  );
}
