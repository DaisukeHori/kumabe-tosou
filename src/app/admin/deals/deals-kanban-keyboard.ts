"use client";

import { useState } from "react";

import type { DealStage } from "@/modules/crm/contracts";

export type KanbanFocus = { col: number; row: number };

export type KanbanColumnShape = { stage: DealStage; deals: { id: string }[] };

/**
 * カンバンのキーボード操作 (01-crm.md §8.3): ←→ = 列フォーカス移動、↑↓ = 列内カード移動、
 * Shift+→/Shift+← = フォーカスカードのステージ移動 (lost へは移動不可 — 呼び出し元の
 * `columns` に非終端 7 列のみを渡すことで構造的に保証する。lost は dropdown 経由のみ)、
 * Enter = 詳細、Esc = フォーカス解除。
 *
 * ステージ遷移の実行 (Server Action 呼び出し・楽観更新・E602/E103 のロールバック) は
 * 呼び出し元 (`deals-kanban.tsx`) の責務 — 本フックはフォーカス管理とキー入力の解釈のみ行う。
 */
export function useDealsKanbanKeyboard({
  columns,
  onOpenDetail,
  onMoveStage,
}: {
  columns: KanbanColumnShape[];
  onOpenDetail: (dealId: string) => void;
  onMoveStage: (dealId: string, currentStage: DealStage, direction: 1 | -1) => void;
}) {
  const [focus, setFocus] = useState<KanbanFocus | null>(null);

  function clamp(col: number, row: number): KanbanFocus {
    const c = Math.max(0, Math.min(columns.length - 1, col));
    const rowCount = columns[c]?.deals.length ?? 0;
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
    const currentDeal = columns[col]?.deals[row];

    if (e.key === "ArrowRight" && e.shiftKey) {
      e.preventDefault();
      if (currentDeal) onMoveStage(currentDeal.id, columns[col].stage, 1);
    } else if (e.key === "ArrowLeft" && e.shiftKey) {
      e.preventDefault();
      if (currentDeal) onMoveStage(currentDeal.id, columns[col].stage, -1);
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
      if (currentDeal) onOpenDetail(currentDeal.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setFocus(null);
    }
  }

  return { focus, setFocus, handleKeyDown };
}
