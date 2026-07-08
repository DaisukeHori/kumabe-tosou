"use client";

import { useState } from "react";

/**
 * お客様の声の本文表示。500 字を超える場合は clamp し「続きを読む」で全文展開する
 * (cms-ai-pipeline.md §2.3: 「本文が長大 → voices は body 500 字で clamp + 続きを読む」)。
 * 新規ファイル (既存コンポーネントは変更しない)。
 */
const CLAMP_LENGTH = 500;

export function VoiceBody({ body }: { body: string }) {
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
        >
          {expanded ? "閉じる" : "続きを読む"}
        </button>
      ) : null}
    </div>
  );
}
