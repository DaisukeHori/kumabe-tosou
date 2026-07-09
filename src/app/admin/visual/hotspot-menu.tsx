"use client";

import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import type { TextPanelItem } from "./actions";
import type { MenuState } from "./types";

type Props = {
  menu: MenuState;
  altValue: string;
  onAltValueChange: (value: string) => void;
  /** kind=text/lines/multiline の編集中の値 (§5 テキスト編集メニュー) */
  textValue: string;
  onTextValueChange: (value: string) => void;
  /** menu.mode === "text-edit" のときの対象スロットのメタ情報 (kind/maxLen/maxLines/現在の state)。
   *  サイドパネルの listSidePanel 取得結果 (T2a に依存しない) から引く。未取得なら null。 */
  textMeta: TextPanelItem | null;
  savePending: boolean;
  onClose: () => void;
  onChangeImage: () => void;
  onEditAlt: () => void;
  onResetToDefault: () => void;
  onDeleteWorkImage: () => void;
  onSaveAlt: () => void;
  onSaveText: () => void;
  onResetTextToDefault: () => void;
};

/**
 * ホットスポットクリック時の小メニュー (§5.1/§5.2、テキストは visual-text-editor.md §5)。
 *
 * キーボード対応 (§5.2 の受入条件):
 * - 開いた時点で先頭の操作可能要素にフォーカスする。
 * - Tab: メニュー内のボタン (通常の DOM 順) を移動する (ブラウザ標準の Tab 挙動そのまま)。
 * - Enter: フォーカス中のボタンを決定する (button のネイティブ挙動)。alt 入力欄・kind=text の
 *   テキスト入力欄 (Input) では Enter で保存を実行する (§5.1 「alt 編集」/ visual-text-editor.md
 *   §5「kind=text は改行入力を禁止 (Enter で保存)」)。kind=lines/multiline の Textarea では
 *   Enter は通常の改行入力として振る舞う (保存は明示的にボタンを押す)。
 * - Esc: メニュー (またはフォーム) を閉じ、フォーカスをホットスポットへ戻す
 *   (onClose 呼び出し元の visual-editor.tsx が担当)。
 */
export function HotspotMenu({
  menu,
  altValue,
  onAltValueChange,
  textValue,
  onTextValueChange,
  textMeta,
  savePending,
  onClose,
  onChangeImage,
  onEditAlt,
  onResetToDefault,
  onDeleteWorkImage,
  onSaveAlt,
  onSaveText,
  onResetTextToDefault,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { hotspot } = menu;

  useEffect(() => {
    const first = containerRef.current?.querySelector<HTMLElement>("button, input, textarea");
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

  // ---- text-edit (§5): 文字数/行数カウンタ・下限 (空文字列拒否) の保存可否判定 ----
  const textLen = textValue.length;
  const textLineCount = textValue.split("\n").length;
  const textOverMaxLen = textMeta ? textLen > textMeta.maxLen : false;
  const textOverMaxLines =
    textMeta && textMeta.kind === "lines" && textMeta.maxLines != null
      ? textLineCount > textMeta.maxLines
      : false;
  const textIsEmpty = textValue.trim().length === 0;
  const textSaveDisabled = savePending || !textMeta || textOverMaxLen || textOverMaxLines || textIsEmpty;

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
      ) : menu.mode === "alt-edit" ? (
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
      ) : (
        <div className="flex flex-col gap-2 p-1">
          <label className="text-[11px] text-muted-foreground" htmlFor="visual-editor-text-input">
            テキスト
          </label>
          {textMeta ? (
            <>
              {textMeta.kind === "text" ? (
                <Input
                  id="visual-editor-text-input"
                  value={textValue}
                  onChange={(e) => onTextValueChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (!textSaveDisabled) onSaveText();
                    }
                  }}
                  disabled={savePending}
                />
              ) : (
                <Textarea
                  id="visual-editor-text-input"
                  value={textValue}
                  onChange={(e) => onTextValueChange(e.target.value)}
                  rows={textMeta.maxLines ?? 4}
                  disabled={savePending}
                />
              )}
              <div className="flex items-center justify-between text-[11px]">
                <span
                  className={cn(
                    "text-muted-foreground",
                    textOverMaxLen && "font-semibold text-destructive",
                  )}
                >
                  {textLen}/{textMeta.maxLen}
                </span>
                {textMeta.kind === "lines" && textMeta.maxLines != null && (
                  <span
                    className={cn(
                      "text-muted-foreground",
                      textOverMaxLines && "font-semibold text-destructive",
                    )}
                  >
                    {textLineCount}行/{textMeta.maxLines}行
                  </span>
                )}
              </div>
              {textIsEmpty && (
                <p className="text-[11px] text-destructive">空文字列 (または空白のみ) は保存できません</p>
              )}
              <div className="flex justify-end gap-2">
                {textMeta.state === "custom" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onResetTextToDefault}
                    disabled={savePending}
                  >
                    既定に戻す
                  </Button>
                )}
                <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={savePending}>
                  キャンセル (Esc)
                </Button>
                <Button type="button" size="sm" onClick={onSaveText} disabled={textSaveDisabled}>
                  保存{textMeta.kind === "text" ? " (Enter)" : ""}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[11px] text-muted-foreground">読み込み中…</p>
              <div className="flex justify-end">
                <Button type="button" variant="outline" size="sm" onClick={onClose}>
                  キャンセル (Esc)
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
