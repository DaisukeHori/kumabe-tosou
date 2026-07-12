"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { DataTableHeaderRow, DataTableShell, dataTableRowClassName } from "@/app/admin/_ui";
import { DEAL_STAGE_REGISTRY, type DealListItem } from "@/modules/crm/contracts";

const GRID_COLS = "grid-cols-[1.6fr_1fr_1fr_auto_auto]";
const jpy = new Intl.NumberFormat("ja-JP");

/** 案件テーブルビュー (01-crm.md §8.3 `?view=table`)。キーボード: ↑↓ 行移動 / Enter 詳細。 */
export function DealsTable({ items }: { items: DealListItem[] }) {
  const router = useRouter();
  const [focusedIndex, setFocusedIndex] = useState(0);

  useEffect(() => {
    setFocusedIndex((i) => Math.min(i, Math.max(items.length - 1, 0)));
  }, [items.length]);

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">該当する案件がありません。</p>;
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
      router.push(`/admin/deals/${items[focusedIndex].id}`);
    } else if (e.key === "Escape") {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
    }
  }

  return (
    <DataTableShell>
      <DataTableHeaderRow columns={["案件名", "顧客", "金額", "ステージ", "見込み完了日"]} gridClassName={GRID_COLS} />
      <div
        role="listbox"
        aria-label="案件一覧"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="divide-y divide-border outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
      >
        {items.map((item, index) => (
          <div
            key={item.id}
            role="option"
            aria-selected={index === focusedIndex}
            onClick={() => router.push(`/admin/deals/${item.id}`)}
            onMouseEnter={() => setFocusedIndex(index)}
            className={`grid cursor-pointer items-center gap-4 px-4 py-3 text-sm transition-colors ${GRID_COLS} ${dataTableRowClassName(index === focusedIndex)}`}
          >
            <div className="min-w-0 truncate font-medium">{item.title}</div>
            <div className="min-w-0 truncate text-xs text-muted-foreground">{item.customer_name}</div>
            <div className="text-xs text-muted-foreground">
              {item.amount_jpy !== null ? `¥${jpy.format(item.amount_jpy)}` : "—"}
            </div>
            <Badge variant={DEAL_STAGE_REGISTRY[item.stage].isLost ? "destructive" : DEAL_STAGE_REGISTRY[item.stage].isWon ? "default" : "outline"}>
              {DEAL_STAGE_REGISTRY[item.stage].label}
            </Badge>
            <div className="text-xs whitespace-nowrap text-muted-foreground">{item.expected_close_on ?? "—"}</div>
          </div>
        ))}
      </div>
    </DataTableShell>
  );
}
