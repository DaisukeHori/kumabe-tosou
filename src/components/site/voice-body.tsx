"use client";

import { useState } from "react";

import { textEditableAttrs } from "@/components/site/editable-attrs";
import type { ResolvedText } from "@/modules/page-media/contracts";

/**
 * お客様の声の本文表示。500 字を超える場合は clamp し「続きを読む」で全文展開する
 * (cms-ai-pipeline.md §2.3: 「本文が長大 → voices は body 500 字で clamp + 続きを読む」)。
 *
 * v2 Wave 1 (visual-text-editor-v2.md §5): 「続きを読む」/「閉じる」ラベルを編集可能にする。
 * この部品は "use client" であり、facade.ts ("server-only") を import する
 * <SlotText>/<SlotRichText> を直接使うとクライアントバンドルが壊れる (shop-simulator.tsx と
 * 同じ制約)。そのため resolveAllTexts() 済みの ResolvedText を page-body から props で受け取り、
 * "server-only" を持たない純関数 textEditableAttrs (editable-attrs.ts) だけで
 * data-editable-text を手動付与する (SlotText と同じ見た目・同じ data 属性契約を再現)。
 */
const CLAMP_LENGTH = 500;

export function VoiceBody({
  body,
  readMoreText,
  collapseText,
  editMode,
}: {
  body: string;
  readMoreText: ResolvedText;
  collapseText: ResolvedText;
  editMode: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = body.length > CLAMP_LENGTH;
  const shown = expanded || !isLong ? body : `${body.slice(0, CLAMP_LENGTH)}…`;

  return (
    <div>
      <p className="whitespace-pre-line text-sm leading-7 text-carbon-mid">{shown}</p>
      {isLong ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 font-mono text-[10px] tracking-[0.16em] text-soul underline underline-offset-4"
          {...textEditableAttrs(
            expanded ? "voices.body.collapse" : "voices.body.readmore",
            editMode,
          )}
        >
          {expanded ? collapseText.text : readMoreText.text}
        </button>
      ) : null}
    </div>
  );
}
