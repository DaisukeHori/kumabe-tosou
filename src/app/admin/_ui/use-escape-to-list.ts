"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * ダイアログ/ドロップダウン/ポップオーバー/シートのいずれかが開いているか (Issue #96)。
 * base-ui の各 Popup 系コンポーネントは open 中のみ DOM に存在する (`DialogContent` 等 —
 * `src/components/ui/dialog.tsx` 参照) ため、DOM 走査で安全に判定できる
 * (`CallDetailInteractive.tsx` の既存 `isDialogOpen()` と同じ手法を dialog 以外にも広げたもの)。
 *
 * `useEscapeToList` (一覧へ戻る) と、案件詳細の概要カード編集中に Esc をキャンセルとして扱う
 * ローカルハンドラ (`DealOverviewCard.tsx`) の両方が「オーバーレイが自分の Esc を処理する場合は
 * 横取りしない」ために使う共通判定 — 個別に selector を書いて誤爆条件がずれることを防ぐ。
 */
export function isOverlayOpen(): boolean {
  return (
    document.querySelector(
      '[data-slot="dialog-content"], [data-slot="dropdown-menu-content"], [data-slot="popover-content"], [data-slot="sheet-content"]',
    ) !== null
  );
}

/** input/textarea/select/contenteditable にフォーカスがあるか (フォーム入力中の Esc 誤爆防止)。 */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/**
 * Escape で一覧へ戻る共通フック (Issue #96 設計 §F)。以下のいずれかに該当する間は発火しない:
 * (a) ダイアログ/ドロップダウン/ポップオーバー/シート等のオーバーレイが開いている
 *     ({@link isOverlayOpen})
 * (b) `[data-esc-guard]` を持つ要素が DOM 中にある (概要カード編集中等、呼び出し元がローカルで
 *     Esc を処理したい場面のマーカー)
 * (c) フォーム入力にフォーカスがある ({@link isEditableTarget})
 *
 * `deals/[id]` が最初の適用先。customers/[id]・calls/[id] も将来この hook に寄せられる設計
 * (Issue 本文 §F 末尾)。薄い client コンポーネントから呼び出すことを想定する
 * (page.tsx は async Server Component のため hook を直接使えない)。
 */
export function useEscapeToList(href: string, enabled = true) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (isOverlayOpen()) return;
      if (document.querySelector("[data-esc-guard]")) return;
      if (isEditableTarget(e.target)) return;
      e.preventDefault();
      router.push(href);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [href, enabled, router]);
}
