import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { Surface } from "../surface";

/**
 * カンバン表示の共通シェル (#99 で deals/deals-kanban.tsx から抽出。01-crm.md §8.3 の見た目
 * (grid/列/カード/折りたたみ列) をモジュール横断 (deals/customers/tasks) で再利用する)。
 * ロジック (フォーカス管理・DnD 状態・遷移実行) は呼び出し元の責務 — 本ファイルは表示のみ。
 */
export function KanbanBoard({
  ariaLabel,
  onKeyDown,
  children,
}: {
  ariaLabel: string;
  onKeyDown: (e: React.KeyboardEvent) => void;
  children: ReactNode;
}) {
  return (
    <div
      role="grid"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex gap-3 overflow-x-auto pb-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {children}
    </div>
  );
}

/**
 * 通常列 (deals の非終端7列・customers の lead/customer・tasks の期日5列)。
 * onDragOver/onDrop を省略すると (tasks の「期日超過」列のように) その列へのネイティブ DnD
 * ドロップを構造的に禁止できる (preventDefault しない = ブラウザ既定のドロップ拒否)。
 */
export function KanbanColumn({
  ariaLabel,
  onDragOver,
  onDrop,
  header,
  meta,
  children,
}: {
  ariaLabel: string;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
  header: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="flex w-64 shrink-0 flex-col gap-2 rounded-xl border border-border bg-muted/30 p-2"
    >
      <div className="flex items-center justify-between px-1 text-xs">
        <span className="font-medium text-foreground">{header}</span>
        {meta && <span className="text-muted-foreground">{meta}</span>}
      </div>
      <div className="flex min-h-16 flex-col gap-2">{children}</div>
    </div>
  );
}

export function KanbanCard({
  draggable = true,
  onDragStart,
  onDragEnd,
  onClick,
  isFocused,
  className,
  children,
}: {
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onClick: () => void;
  isFocused: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Surface
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={cn("cursor-pointer p-2.5 text-xs transition-colors", isFocused && "ring-2 ring-ring", className)}
    >
      {children}
    </Surface>
  );
}

/**
 * 準終端/終端列用の折りたたみ列 (deals の paid/lost、customers の archived)。破線ボーダー。
 * expanded state は呼び出し元管理 (deals-kanban.tsx の expandedPaid/expandedLost と同型)。
 */
export function KanbanCollapsedColumn({
  label,
  count,
  expanded,
  onToggleExpanded,
  onDragOver,
  onDrop,
  children,
}: {
  label: string;
  count: number;
  expanded: boolean;
  onToggleExpanded: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: () => void;
  children: ReactNode;
}) {
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="flex w-64 flex-col gap-2 rounded-xl border border-dashed border-border p-2"
    >
      <button type="button" onClick={onToggleExpanded} className="flex items-center justify-between px-1 text-xs">
        <span className="font-medium">
          {label} <Badge variant="outline">{count}</Badge>
        </span>
        <span className="text-muted-foreground">{expanded ? "折りたたむ" : "展開する"}</span>
      </button>
      {expanded && <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">{children}</div>}
    </div>
  );
}
