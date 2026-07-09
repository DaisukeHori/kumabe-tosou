import type { PublicPostListItem } from "@/app/_lib/public-content";

export type NoteNav = {
  /** NOTE 通し番号 (古い記事 = 01)。リストに見つからなければ null */
  noteNo: number | null;
  /** 前の記事 = 1 つ古い記事 (published_at 降順リストの idx+1) */
  prev: PublicPostListItem | null;
  /** 次の記事 = 1 つ新しい記事 (published_at 降順リストの idx-1) */
  next: PublicPostListItem | null;
};

/** published_at 降順リストから NOTE 番号 (昇順で安定) を割り当てる。
    legacy notes.html の NOTE 01〜07 固定番号の再現 — 新規記事が増えても
    既存記事の番号が変わらない (バックデート公開は例外、risks 参照)。 */
export function noteNumberOf(posts: PublicPostListItem[], index: number): number {
  return posts.length - index;
}

export function formatNoteNo(n: number): string {
  return `NOTE ${String(n).padStart(2, "0")}`;
}

export function buildNoteNav(posts: PublicPostListItem[], slug: string): NoteNav {
  const idx = posts.findIndex((p) => p.slug === slug);
  if (idx < 0) return { noteNo: null, prev: null, next: null };
  return {
    noteNo: noteNumberOf(posts, idx),
    prev: idx < posts.length - 1 ? posts[idx + 1] : null,
    next: idx > 0 ? posts[idx - 1] : null,
  };
}
