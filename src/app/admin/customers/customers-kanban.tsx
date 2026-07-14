"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { KanbanBoard, KanbanCard, KanbanCollapsedColumn, KanbanColumn, Surface, useKanbanKeyboard } from "@/app/admin/_ui";
import {
  zCustomerLifecycle,
  type CustomerKanbanColumn,
  type CustomerLifecycle,
  type CustomerListItem,
} from "@/modules/crm/contracts";

import { updateCustomerLifecycleAction } from "./actions";

const LIFECYCLE_LABEL: Record<CustomerLifecycle, string> = {
  lead: "見込み",
  customer: "取引中",
  archived: "アーカイブ",
};

// lead → customer → archived の全順序 (§4.1「全遷移許可」)。deals の STAGE_ORDER / NON_TERMINAL_STAGES
// と同じ判断基準: メイン列 (lead/customer) の Shift+→/DnD が「アーカイブ」へ直接届く構造にする
// (deals の invoiced→paid が非終端7列の外の paid へ届くのと同型。lifecycle は全遷移許可のため
// deals の lost のような確認 Dialog は不要 — 直接 updateCustomerLifecycleAction を呼ぶ)。
const LIFECYCLE_ORDER = zCustomerLifecycle.options;
const MAIN_LIFECYCLES = LIFECYCLE_ORDER.filter((l) => l !== "archived");

function moveCustomer(
  columns: CustomerKanbanColumn[],
  customerId: string,
  fromLifecycle: CustomerLifecycle,
  toLifecycle: CustomerLifecycle,
): CustomerKanbanColumn[] {
  const fromCol = columns.find((c) => c.lifecycle === fromLifecycle);
  const customer = fromCol?.customers.find((c) => c.id === customerId);
  if (!customer) return columns;
  return columns.map((c) => {
    if (c.lifecycle === fromLifecycle) {
      return { ...c, customers: c.customers.filter((x) => x.id !== customerId), total_count: Math.max(0, c.total_count - 1) };
    }
    if (c.lifecycle === toLifecycle) {
      return { ...c, customers: [{ ...customer, lifecycle: toLifecycle }, ...c.customers], total_count: c.total_count + 1 };
    }
    return c;
  });
}

/**
 * 顧客カンバン (/admin/customers?view=kanban、#99)。主要列 = 見込み(lead)/取引中(customer)、
 * 折りたたみ列 = アーカイブ(直近20件)。DnD/Shift+←→ とも updateCustomerLifecycleAction を直接呼ぶ
 * (lifecycle は全遷移許可 — 01-crm.md §4.1 — のため deals の失注のような確認 Dialog は挟まない)。
 * 楽観更新 → 失敗時ロールバック、KMB-E103 は専用 toast (deals-kanban.tsx の applyStageChange と同型)。
 */
export function CustomersKanban({ initialColumns }: { initialColumns: CustomerKanbanColumn[] }) {
  const router = useRouter();
  const [columns, setColumns] = useState(initialColumns);
  const [expandedArchived, setExpandedArchived] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => setColumns(initialColumns), [initialColumns]);

  const mainColumns = MAIN_LIFECYCLES.map((l) => columns.find((c) => c.lifecycle === l)).filter(
    (c): c is CustomerKanbanColumn => c !== undefined,
  );
  const archivedColumn = columns.find((c) => c.lifecycle === "archived");

  async function applyLifecycleChange(customer: CustomerListItem, fromLifecycle: CustomerLifecycle, toLifecycle: CustomerLifecycle) {
    const previousColumns = columns;
    setColumns((prev) => moveCustomer(prev, customer.id, fromLifecycle, toLifecycle));
    const result = await updateCustomerLifecycleAction(customer.id, toLifecycle, customer.updated_at);
    if (!result.ok) {
      setColumns(previousColumns);
      if (result.code === "KMB-E103") {
        toast.error("他の操作でこの顧客が更新されています。再読み込みしてください。");
      } else {
        toast.error(result.detail ?? "状態の変更に失敗しました。");
      }
      return;
    }
    router.refresh();
  }

  function handleMoveLifecycle(customerId: string, currentLifecycle: CustomerLifecycle, direction: 1 | -1) {
    const currentColumn = columns.find((c) => c.lifecycle === currentLifecycle);
    const customer = currentColumn?.customers.find((c) => c.id === customerId);
    if (!customer) return;
    const idx = LIFECYCLE_ORDER.indexOf(currentLifecycle);
    const targetLifecycle = LIFECYCLE_ORDER[idx + direction];
    if (!targetLifecycle) return;
    void applyLifecycleChange(customer, currentLifecycle, targetLifecycle);
  }

  const { focus, setFocus, handleKeyDown } = useKanbanKeyboard<CustomerLifecycle>({
    columns: mainColumns.map((c) => ({ key: c.lifecycle, items: c.customers })),
    onOpenDetail: (customerId) => router.push(`/admin/customers/${customerId}`),
    onMoveItem: handleMoveLifecycle,
  });

  function handleDrop(toLifecycle: CustomerLifecycle) {
    if (!draggingId) return;
    const fromColumn = columns.find((c) => c.customers.some((cu) => cu.id === draggingId));
    const customer = fromColumn?.customers.find((cu) => cu.id === draggingId);
    setDraggingId(null);
    if (!customer || !fromColumn || fromColumn.lifecycle === toLifecycle) return;
    void applyLifecycleChange(customer, fromColumn.lifecycle, toLifecycle);
  }

  return (
    <div className="flex flex-col gap-4">
      <KanbanBoard ariaLabel="顧客カンバン" onKeyDown={handleKeyDown}>
        {mainColumns.map((column, colIndex) => (
          <KanbanColumn
            key={column.lifecycle}
            ariaLabel={LIFECYCLE_LABEL[column.lifecycle]}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(column.lifecycle)}
            header={LIFECYCLE_LABEL[column.lifecycle]}
            meta={`${column.total_count}件${column.total_count > 100 ? " (表示は直近100件)" : ""}`}
          >
            {column.customers.map((customer, rowIndex) => {
              const isFocused = focus?.col === colIndex && focus.row === rowIndex;
              return (
                <KanbanCard
                  key={customer.id}
                  isFocused={isFocused}
                  onDragStart={() => setDraggingId(customer.id)}
                  onDragEnd={() => setDraggingId(null)}
                  onClick={() => {
                    setFocus({ col: colIndex, row: rowIndex });
                    router.push(`/admin/customers/${customer.id}`);
                  }}
                >
                  <p className="truncate text-sm font-medium">{customer.name}</p>
                  {customer.name_kana && (
                    <p className="truncate text-[11px] text-muted-foreground">{customer.name_kana}</p>
                  )}
                  {customer.company_name && (
                    <p className="mt-0.5 truncate text-muted-foreground">{customer.company_name}</p>
                  )}
                  <div className="mt-1 flex items-center justify-between gap-1">
                    <span className="truncate text-muted-foreground">
                      {customer.email ?? customer.tel_e164 ?? "—"}
                    </span>
                    <Badge variant="outline" className="shrink-0">
                      {customer.open_deal_count}
                    </Badge>
                  </div>
                </KanbanCard>
              );
            })}
          </KanbanColumn>
        ))}
      </KanbanBoard>

      <KanbanCollapsedColumn
        label={LIFECYCLE_LABEL.archived}
        count={archivedColumn?.total_count ?? 0}
        expanded={expandedArchived}
        onToggleExpanded={() => setExpandedArchived((v) => !v)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => handleDrop("archived")}
      >
        {(archivedColumn?.customers ?? []).map((customer) => (
          <Surface
            key={customer.id}
            className="cursor-pointer p-2.5 text-xs"
            onClick={() => router.push(`/admin/customers/${customer.id}`)}
          >
            <p className="truncate text-sm font-medium">{customer.name}</p>
            <p className="mt-0.5 truncate text-muted-foreground">{customer.company_name ?? "—"}</p>
          </Surface>
        ))}
      </KanbanCollapsedColumn>
    </div>
  );
}
