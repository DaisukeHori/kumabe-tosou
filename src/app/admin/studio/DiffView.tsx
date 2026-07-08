"use client";

import { useMemo, useState } from "react";

import { chunkedDiff, onlyChangedChunks } from "./diff";

/**
 * 差分表示 (設計書 §10)。raw vs cleaned / cleaned vs draft / revision N-1 vs N の
 * いずれにも使う汎用コンポーネント。追加=緑下線、削除=赤取り消し線。
 * 「変更のみ表示」トグル付き。
 */
export function DiffView({ oldText, newText, oldLabel, newLabel }: { oldText: string; newText: string; oldLabel: string; newLabel: string }) {
  const [onlyChanged, setOnlyChanged] = useState(false);
  const chunks = useMemo(() => chunkedDiff(oldText, newText), [oldText, newText]);
  const shown = onlyChanged ? onlyChangedChunks(chunks) : chunks;

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {oldLabel} → {newLabel}
        </p>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />
          変更のみ表示
        </label>
      </div>
      <div className="max-h-72 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
        {shown.length === 0 && <p className="text-xs text-muted-foreground">差分はありません。</p>}
        {shown.map((chunk, chunkIndex) => (
          <p key={chunkIndex} className="mb-2">
            {chunk.parts.map((part, partIndex) => {
              if (part.added) {
                return (
                  <span key={partIndex} className="bg-green-100 text-green-900 underline decoration-green-500 dark:bg-green-950 dark:text-green-200">
                    {part.value}
                  </span>
                );
              }
              if (part.removed) {
                return (
                  <span key={partIndex} className="bg-red-100 text-red-900 line-through decoration-red-500 dark:bg-red-950 dark:text-red-200">
                    {part.value}
                  </span>
                );
              }
              return <span key={partIndex}>{part.value}</span>;
            })}
          </p>
        ))}
      </div>
    </div>
  );
}
