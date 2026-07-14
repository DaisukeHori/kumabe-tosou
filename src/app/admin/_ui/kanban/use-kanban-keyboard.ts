"use client";

import { useState } from "react";

export type KanbanFocus = { col: number; row: number };

export type KanbanColumnShape<TKey extends string> = { key: TKey; items: { id: string }[] };

/**
 * カンバン共通のキーボード操作 (01-crm.md §8.3)。#99 で deals/deals-kanban-keyboard.ts の
 * useDealsKanbanKeyboard をジェネリック化して src/app/admin/_ui/kanban/ に移設した
 * (ロジックは元実装そのまま — clamp/フォーカス管理/キー解釈に変更なし)。
 *
 * ←→ = 列フォーカス移動、↑↓ = 列内カード移動、Shift+→/Shift+← = フォーカスカードの項目移動
 * (呼び出し元が `columns` として渡した列のみが移動先候補になる — 「移動不可の列」は呼び出し元が
 * columns から除外する / onMoveItem 内でガードすることで保証する。deals-kanban.tsx の
 * 「lost へは移動不可」と同じ責務分担)、Enter = 詳細 (deals) または編集 Sheet (tasks) を開く、
 * Esc = フォーカス解除。
 *
 * 遷移の実行 (Server Action 呼び出し・楽観更新・CAS 失敗時のロールバック) は呼び出し元
 * (deals-kanban.tsx / customers-kanban.tsx / tasks-kanban.tsx) の責務 — 本フックはフォーカス管理と
 * キー入力の解釈のみ行う。
 */
export function useKanbanKeyboard<TKey extends string>({
  columns,
  onOpenDetail,
  onMoveItem,
}: {
  columns: KanbanColumnShape<TKey>[];
  onOpenDetail: (id: string) => void;
  onMoveItem: (id: string, currentKey: TKey, direction: 1 | -1) => void;
}) {
  const [focus, setFocus] = useState<KanbanFocus | null>(null);

  function clamp(col: number, row: number): KanbanFocus {
    const c = Math.max(0, Math.min(columns.length - 1, col));
    const rowCount = columns[c]?.items.length ?? 0;
    const r = rowCount === 0 ? 0 : Math.max(0, Math.min(rowCount - 1, row));
    return { col: c, row: r };
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (columns.length === 0) return;

    if (!focus) {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter"].includes(e.key)) {
        e.preventDefault();
        setFocus(clamp(0, 0));
      }
      return;
    }

    const { col, row } = focus;
    const currentItem = columns[col]?.items[row];

    if (e.key === "ArrowRight" && e.shiftKey) {
      e.preventDefault();
      if (currentItem) onMoveItem(currentItem.id, columns[col].key, 1);
    } else if (e.key === "ArrowLeft" && e.shiftKey) {
      e.preventDefault();
      if (currentItem) onMoveItem(currentItem.id, columns[col].key, -1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      setFocus(clamp(col + 1, row));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setFocus(clamp(col - 1, row));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocus(clamp(col, row + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocus(clamp(col, row - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (currentItem) onOpenDetail(currentItem.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setFocus(null);
    }
  }

  return { focus, setFocus, handleKeyDown };
}
