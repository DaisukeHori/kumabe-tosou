/**
 * タイムライン (occurred_at, id) desc keyset カーソルの encode/decode 純関数
 * (01-crm.md §5.2 zTimelinePagination コメント / §2.5)。`base64("<occurred_at ISO>|<id>")`。
 *
 * 注記: crm/repository.ts の listTimelinePage は現状カーソルを自前の base64url(JSON) 形式で
 * 内部完結して扱っており (呼び出し元にはオペークな文字列として渡す)、本モジュールの
 * encode/decode を直接は呼んでいない。本モジュールは 07-delta の zTimelinePagination コメントが
 * 明記する契約上の canonical カーソル形式であり、01-crm.md §11.2/§2.5 が要求する実装物として
 * 用意する (単体テストは #2-3 = 画面 Issue のスコープ — 01-crm §2.5 注記どおり)。将来 listTimeline
 * がカーソル形式を canonical 準拠に統一する際はここを唯一の実装として repository 側から使う。
 */

export type TimelineCursor = { occurredAt: string; id: string };

export function encodeTimelineCursor(cursor: TimelineCursor): string {
  return Buffer.from(`${cursor.occurredAt}|${cursor.id}`, "utf-8").toString("base64");
}

export function decodeTimelineCursor(raw: string | null | undefined): TimelineCursor | null {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf-8");
    const separatorIndex = decoded.lastIndexOf("|");
    if (separatorIndex === -1) return null;
    const occurredAt = decoded.slice(0, separatorIndex);
    const id = decoded.slice(separatorIndex + 1);
    if (occurredAt.length === 0 || id.length === 0) return null;
    return { occurredAt, id };
  } catch {
    // 不正なカーソルは安全に棄却 (先頭ページ扱い)
    return null;
  }
}
