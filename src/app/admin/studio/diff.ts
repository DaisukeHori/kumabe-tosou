import { diffChars } from "diff";

/**
 * 差分表示 (canonical: docs/design/cms-ai-pipeline.md §10)。
 * 「段落単位でチャンク化してから文字 diff を行う (巨大 diff の視認性対策)」の実装。
 *
 * アルゴリズム: 共通接頭辞・共通接尾辞の段落はそのまま (変更なし) とし、
 * 食い違う中間の段落群だけをまとめて 1 チャンクとして diffChars する。
 * raw_text vs cleaned_text / cleaned_text vs draft / revision N-1 vs N の
 * いずれも「同じ文章の軽微な編集」が前提のため、段落順の大きな入れ替えは
 * 想定しない (§10.1 の用途と一致)。
 */

export type DiffPart = { value: string; added?: boolean; removed?: boolean };
export type DiffChunk = { changed: boolean; parts: DiffPart[] };

function splitParagraphs(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split(/\n{2,}/);
}

export function chunkedDiff(oldText: string, newText: string): DiffChunk[] {
  const oldParas = splitParagraphs(oldText);
  const newParas = splitParagraphs(newText);

  let prefixLen = 0;
  while (
    prefixLen < oldParas.length &&
    prefixLen < newParas.length &&
    oldParas[prefixLen] === newParas[prefixLen]
  ) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < oldParas.length - prefixLen &&
    suffixLen < newParas.length - prefixLen &&
    oldParas[oldParas.length - 1 - suffixLen] === newParas[newParas.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const chunks: DiffChunk[] = [];
  for (let i = 0; i < prefixLen; i++) {
    chunks.push({ changed: false, parts: [{ value: oldParas[i] }] });
  }

  const oldMiddle = oldParas.slice(prefixLen, oldParas.length - suffixLen).join("\n\n");
  const newMiddle = newParas.slice(prefixLen, newParas.length - suffixLen).join("\n\n");
  if (oldMiddle.length > 0 || newMiddle.length > 0) {
    chunks.push({ changed: true, parts: diffChars(oldMiddle, newMiddle) });
  }

  for (let i = oldParas.length - suffixLen; i < oldParas.length; i++) {
    chunks.push({ changed: false, parts: [{ value: oldParas[i] }] });
  }

  return chunks;
}

/** 「変更のみ表示」トグル (§10.2) */
export function onlyChangedChunks(chunks: DiffChunk[]): DiffChunk[] {
  return chunks.filter((c) => c.changed);
}
