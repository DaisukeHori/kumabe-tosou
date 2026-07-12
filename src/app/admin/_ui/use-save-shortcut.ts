"use client";

import { useEffect } from "react";

/**
 * Cmd/Ctrl+S での保存ショートカット (01-crm.md §8.1 共通キーボード要件)。
 * ブラウザ既定の保存ダイアログを抑止しつつ `onSave` を呼ぶ。フォーム/メモボックスがある
 * 画面 (customers/deals 詳細・新規フォーム・ActivityTimeline のメモ追加ボックス等) で
 * 共用するための 1 本化フック (#44 計画書 — 5 画面での類似実装重複を避ける)。
 *
 * `enabled` が false の間はリスナーを張らない (ダイアログ内で別のキー操作を優先したい場合等)。
 */
export function useSaveShortcut(onSave: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        onSave();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // onSave を deps に含める (stale closure 防止 — 呼び出し側が useCallback で安定化しない限り
    // 毎レンダーで listener を張り直すが、keydown 1 本の付け外しは軽量なため許容する)。
  }, [enabled, onSave]);
}
