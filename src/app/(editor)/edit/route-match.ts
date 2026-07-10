/**
 * `/edit/**` の path セグメント → ルート種別の判定 (純粋関数、DB/コンポーネント非依存)。
 * canonical: docs/design/visual-media-editor.md §5.3a。
 *
 * page-map.tsx (データ取得 + ページボディ描画) から分離しているのは、ユニットテスト
 * (tests/edit-page-map.test.ts) がページボディ群 (next/image 等を含む巨大な import グラフ) を
 * 引き込まずに、このファイル単体を軽量に検証できるようにするため。
 */

export type EditRouteMatch =
  | { kind: "slot-page"; page: SlotPageKey }
  | { kind: "works-list" }
  | { kind: "voices-list" }
  | { kind: "notes-list" }
  | { kind: "blog-list" }
  | { kind: "works-detail"; slug: string }
  | { kind: "notes-detail"; slug: string }
  | { kind: "blog-detail"; slug: string };

/**
 * SLOT_REGISTRY の page フィールドと 1:1 (page-media/registry.ts 参照)。"" は home (route "/")。
 * v2 Wave 1: "privacy" は画像スロットを持たない (SLOT_REGISTRY に無い) が、テキストスロット
 * (text-registry/slots/privacy.ts, route "/privacy") を EDITABLE_ROUTES に含めるため
 * (page-media-text-registry.test.ts の route 部分集合検証)、slot-page 種別として
 * "画像スロット0件のページ" を追加する (renderSlotPage は slots を使わない)。
 */
export type SlotPageKey =
  | ""
  | "about"
  | "colors"
  | "contact"
  | "materials"
  | "privacy"
  | "process"
  | "service"
  | "shop"
  | "story";

const SLOT_PAGE_SEGMENTS = new Set<SlotPageKey>([
  "about",
  "colors",
  "contact",
  "materials",
  "privacy",
  "process",
  "service",
  "shop",
  "story",
]);

const STATIC_LIST_KIND: Record<string, EditRouteMatch["kind"]> = {
  works: "works-list",
  voices: "voices-list",
  notes: "notes-list",
  blog: "blog-list",
};

const DYNAMIC_DETAIL_KIND: Record<string, "works-detail" | "notes-detail" | "blog-detail"> = {
  works: "works-detail",
  notes: "notes-detail",
  blog: "blog-detail",
};

/**
 * `/edit/[[...path]]` の catch-all セグメント配列を EditRouteMatch に解決する純関数。
 * 未知のパスは null (呼び出し側が notFound() を出す)。
 */
export function matchEditRoute(path: string[] | undefined): EditRouteMatch | null {
  const segs = path ?? [];

  if (segs.length === 0) {
    return { kind: "slot-page", page: "" };
  }

  if (segs.length === 1) {
    const seg = segs[0];
    if (SLOT_PAGE_SEGMENTS.has(seg as SlotPageKey)) {
      return { kind: "slot-page", page: seg as SlotPageKey };
    }
    const listKind = STATIC_LIST_KIND[seg];
    if (listKind) return { kind: listKind } as EditRouteMatch;
    return null;
  }

  if (segs.length === 2) {
    const [prefix, slug] = segs;
    const detailKind = DYNAMIC_DETAIL_KIND[prefix];
    if (detailKind && slug) return { kind: detailKind, slug } as EditRouteMatch;
    return null;
  }

  return null;
}
