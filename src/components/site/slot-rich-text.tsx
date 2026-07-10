import { createElement } from "react";

import { TEXT_REGISTRY } from "@/modules/page-media/facade";
import type { ResolvedText } from "@/modules/page-media/contracts";

import { textEditableAttrs } from "./editable-attrs";
import { renderRichInline, renderRichText } from "./rich-text";

/**
 * `rich` kind 専用のテキストスロットコンポーネント (canonical:
 * docs/design/visual-text-editor-v2.md §3.4)。SlotText (slot-text.tsx) と同型の props
 * (`slotKey` / `resolved` / `editMode` / `className` / `as`) を持つ。
 *
 * - kind が `rich` でない slotKey、または TEXT_REGISTRY に存在しない slotKey を渡すと
 *   throw する (SlotText と同じ早期失敗の方針)。
 * - editMode===true のときだけ `data-editable-text={slotKey}` を発行する
 *   (既存エディタの `[data-editable-text]` 走査が無改修で拾う)。
 * - resolved.text が複数段落 (`\n\n` を含む) の場合、root は常に div (`as` は無視、
 *   multiline と同じく `<p><p>` の不正 HTML を構造的に禁止する)。
 * - 単一段落の場合は `createElement(as ?? "span", ...)` でインライン要素として描画し、
 *   `<SecLead><SlotRichText as="span" .../></SecLead>` のように呼び出し側の flow へ
 *   埋め込めるようにする。
 */

type IntrinsicTag = keyof React.JSX.IntrinsicElements;

const TEXT_SLOTS_BY_KEY: ReadonlyMap<string, (typeof TEXT_REGISTRY)[number]> = new Map(
  TEXT_REGISTRY.map((s) => [s.key, s]),
);

export type SlotRichTextProps = {
  slotKey: string;
  resolved: ResolvedText;
  editMode: boolean;
  /** 既定 span (単一段落時のみ有効。複数段落時は div 固定で無視される) */
  as?: IntrinsicTag;
  className?: string;
};

export function SlotRichText({ slotKey, resolved, editMode, as = "span", className }: SlotRichTextProps) {
  const slot = TEXT_SLOTS_BY_KEY.get(slotKey);
  if (!slot) {
    // registry に無い slot_key。ページボディからの誤った slotKey 指定を早期に発見するため
    // 安全側で明示的に落とす (SlotText と同じ方針)。
    throw new Error(`[SlotRichText] TEXT_REGISTRY に存在しない slot_key です: ${slotKey}`);
  }
  if (slot.kind !== "rich") {
    throw new Error(
      `[SlotRichText] kind="rich" ではない slot_key です (kind=${slot.kind}): ${slotKey}`,
    );
  }

  const editableAttrs = textEditableAttrs(slotKey, editMode);
  const isMultiParagraph = resolved.text.includes("\n\n");

  if (isMultiParagraph) {
    // multiline (SlotText) と同じく、複数段落は root を常に div にする (`as` を無視)。
    return (
      <div className={className} {...editableAttrs}>
        {renderRichText(resolved.text)}
      </div>
    );
  }

  return createElement(as, { className, ...editableAttrs }, renderRichInline(resolved.text));
}
