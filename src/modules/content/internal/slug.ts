import { nanoid } from "nanoid";

/**
 * slug 重複時の代替候補生成 (cms-ai-pipeline.md §2.4「自動生成失敗時は {kind}-{nanoid(8)}」を
 * 手動入力の重複エラー時 (KMB-E102) の代替提案にも適用する)。
 */
export function generateFallbackSlug(kind: string): string {
  return `${kind}-${nanoid(8)}`;
}
