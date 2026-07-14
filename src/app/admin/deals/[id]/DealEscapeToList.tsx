"use client";

import { useEscapeToList } from "@/app/admin/_ui/use-escape-to-list";

/**
 * `/admin/deals/[id]` の Esc→一覧戻り (Issue #96 設計 §F)。page.tsx は async Server Component の
 * ため hook を直接使えず、この薄い client コンポーネントを差し込む (画面には何も描画しない)。
 */
export function DealEscapeToList() {
  useEscapeToList("/admin/deals");
  return null;
}
