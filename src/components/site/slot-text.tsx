import { createElement, Fragment } from "react";

import { TEXT_REGISTRY } from "@/modules/page-media/facade";
import type { ResolvedText } from "@/modules/page-media/contracts";

import { textEditableAttrs } from "./editable-attrs";

/**
 * テキストスロットコンポーネント (canonical: docs/design/visual-text-editor.md §4.1)。
 *
 * - context は使わない (RSC で不可)。slotKey + resolved + editMode を props で受け取る
 *   (SlotImage と同型の設計)。
 * - kind は props で受け取らず、TEXT_REGISTRY (slotKey) から引く (SlotImage が
 *   SLOT_REGISTRY から aspect/sizes/priority を引くのと同じパターン)。
 * - テキストは React の通常レンダリング (エスケープ標準)。**dangerouslySetInnerHTML 禁止**。
 * - editMode===true のときだけ data-editable-text=slotKey を出力する。
 * - kind="lines": resolved.text を "\n" で分割し renderLines へ。renderLines 未指定なら
 *   <br/> 結合。
 * - kind="multiline": "\n\n" 区切りで <p> 群を生成する。v1.1: `<p><p>` の不正 HTML を
 *   避けるため、root は常に div (`as` prop は無視する)。
 * - kind="text": resolved.text をそのまま 1 要素で描画する。
 * - 動的タグ (`as`) は Reveal (reveal.tsx) と同じ createElement 経由で描画する
 *   (JSX でユニオン型の変数タグを直接使うと props 型が過度に絞られるため)。
 */

type IntrinsicTag = keyof React.JSX.IntrinsicElements;

const TEXT_SLOTS_BY_KEY: ReadonlyMap<string, (typeof TEXT_REGISTRY)[number]> = new Map(
  TEXT_REGISTRY.map((s) => [s.key, s]),
);

export type SlotTextProps = {
  slotKey: string;
  resolved: ResolvedText;
  editMode: boolean;
  /** 既定 span。見出しは呼び出し側が h1 等を包むか as で指定する (kind=multiline では無視) */
  as?: IntrinsicTag;
  className?: string;
  /** kind=lines 用。行ごとの装飾 (kt-hero-line / text-soul 最終行等) は呼び出し側が保持する */
  renderLines?: (lines: string[]) => React.ReactNode;
};

/** renderLines 未指定時の既定描画: 行を <br/> で結合する */
function defaultRenderLines(lines: string[]): React.ReactNode {
  return lines.map((line, i) => (
    <Fragment key={i}>
      {i > 0 ? <br /> : null}
      {line}
    </Fragment>
  ));
}

export function SlotText({
  slotKey,
  resolved,
  editMode,
  as = "span",
  className,
  renderLines,
}: SlotTextProps) {
  const slot = TEXT_SLOTS_BY_KEY.get(slotKey);
  if (!slot) {
    // registry に無い slot_key。ページボディからの誤った slotKey 指定を早期に発見するため
    // 安全側で明示的に落とす (SlotImage と同じ方針)。
    throw new Error(`[SlotText] TEXT_REGISTRY に存在しない slot_key です: ${slotKey}`);
  }

  const editableAttrs = textEditableAttrs(slotKey, editMode);

  if (slot.kind === "multiline") {
    // v1.1: <p> 群を包む root は常に div (`as` 無視、<p><p> の不正 HTML を構造的に禁止)
    const paragraphs = resolved.text.split("\n\n");
    return (
      <div className={className} {...editableAttrs}>
        {paragraphs.map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
      </div>
    );
  }

  const content =
    slot.kind === "lines"
      ? (renderLines ?? defaultRenderLines)(resolved.text.split("\n"))
      : resolved.text;

  return createElement(as, { className, ...editableAttrs }, content);
}
