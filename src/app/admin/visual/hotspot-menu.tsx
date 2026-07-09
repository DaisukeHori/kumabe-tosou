"use client";

import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { MenuState } from "./types";

type Props = {
  menu: MenuState;
  altValue: string;
  onAltValueChange: (value: string) => void;
  savePending: boolean;
  onClose: () => void;
  onChangeImage: () => void;
  onEditAlt: () => void;
  onResetToDefault: () => void;
  onDeleteWorkImage: () => void;
  onSaveAlt: () => void;
};

/**
 * ホットスポットクリック時の小メニュー (§5.1/§5.2)。
 *
 * キーボード対応 (§5.2 の受入条件):
 * - 開いた時点で先頭の操作可能要素にフォーカスする。
 * - Tab: メニュー内のボタン (通常の DOM 順) を移動する (ブラウザ標準の Tab 挙動そのまま)。
 * - Enter: フォーカス中のボタンを決定する (button のネイティブ挙動)。alt 入力欄では
 *   Enter で保存を実行する (§5.1 「alt 編集」)。
 * - Esc: メニュー (または alt 編集フォーム) を閉じ、フォーカスをホットスポットへ戻す
 *   (onClose 呼び出し元の visual-editor.tsx が担当)。
 */
export function HotspotMenu({
  menu,
  altValue,
  onAltValueChange,
  savePending,
  onClose,
  onChangeImage,
  onEditAlt,
  onResetToDefault,
  onDeleteWorkImage,
  onSaveAlt,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { hotspot } = menu;

  useEffect(() => {
    const first = containerRef.current?.querySelector<HTMLElement>("button, input");
    first?.focus();
  }, [menu.mode]);

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  }

  const style: CSSProperties = {
    top: hotspot.rect.top + hotspot.rect.height + 4,
    left: hotspot.rect.left,
  };

  return (
    <div
      ref={containerRef}
      role="menu"
      aria-label={`${hotspot.label} の編集メニュー`}
      onKeyDown={handleKeyDown}
      className="absolute z-20 w-56 rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-md"
      style={style}
    >
      {menu.mode === "menu" ? (
        <div className="flex flex-col gap-0.5">
          <p className="truncate px-2 py-1 text-[11px] text-muted-foreground">{hotspot.label}</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            role="menuitem"
            className="justify-start"
            disabled={savePending}
            onClick={onChangeImage}
          >
            画像を変更
          </Button>
          {hotspot.target.type === "slot" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              role="menuitem"
              className="justify-start"
              disabled={savePending}
              onClick={onEditAlt}
            >
              alt 編集
            </Button>
          )}
          {hotspot.target.type === "slot" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              role="menuitem"
              className="justify-start"
              disabled={savePending}
              onClick={onResetToDefault}
            >
              既定に戻す
            </Button>
          )}
          {hotspot.target.type === "work-image" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              role="menuitem"
              className="justify-start text-destructive"
              disabled={savePending}
              onClick={onDeleteWorkImage}
            >
              削除
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            role="menuitem"
            className="justify-start text-muted-foreground"
            onClick={onClose}
          >
            キャンセル (Esc)
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 p-1">
          <label className="text-[11px] text-muted-foreground" htmlFor="visual-editor-alt-input">
            alt テキスト
          </label>
          <Input
            id="visual-editor-alt-input"
            value={altValue}
            onChange={(e) => onAltValueChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSaveAlt();
              }
            }}
            maxLength={200}
            disabled={savePending}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={savePending}>
              キャンセル (Esc)
            </Button>
            <Button type="button" size="sm" onClick={onSaveAlt} disabled={savePending}>
              保存 (Enter)
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
