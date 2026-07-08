import { zWorkInput, type WorkInput } from "@/modules/content/contracts";

import { findMediaIdBySourceFile } from "./media";

/**
 * src/app/works/page.tsx の WORKS 定数から一字一句転記。
 * body は元データに存在しないため、caption をそのまま body として保持する
 * (Markdown 契約 zMarkdown の制約内に収まる短文のため変換不要)。
 * genre → category、id → slug (元の "work-01" 等をそのまま slug として採用。
 * zSlug の正規表現 (小文字英数とハイフンのみ) に一致する)。
 */
const RAW_WORKS: {
  slug: string;
  title: string;
  category: string;
  body: string;
  coverSourceFile: string;
  sortOrder: number;
}[] = [
  {
    slug: "work-01",
    title: "3Dプリント車両ボディ",
    category: "ソリッドカラー",
    body: "積層痕研磨 → プラサフ → ソリッド原色 → 2液ウレタンクリア",
    coverSourceFile: "public/img/car-detail.jpg",
    sortOrder: 0,
  },
  {
    slug: "work-02",
    title: "スマホケース",
    category: "パール光彩",
    body: "面出し研磨 → プラサフ → 3コートパールベース → クリア仕上げ",
    coverSourceFile: "public/img/surface.jpg",
    sortOrder: 1,
  },
  {
    slug: "work-03",
    title: "フィギュア小物",
    category: "エアブラシグラデーション",
    body: "下地研磨 → エアブラシで濃淡をのせる → クリアで色止め",
    coverSourceFile: "public/img/airbrush-dark.jpg",
    sortOrder: 2,
  },
  {
    slug: "work-04",
    title: "カスタムパーツ",
    category: "メタリック仕上げ",
    body: "面出し → メタリックベース → クリアで粒子を閉じ込め鏡面研磨",
    coverSourceFile: "public/img/metal-work.jpg",
    sortOrder: 3,
  },
  {
    slug: "work-05",
    title: "エキゾースト風装飾",
    category: "ソウルレッド",
    body: "耐熱プラサフ → 3コートパール(赤系) → クリア + 磨き上げ",
    coverSourceFile: "public/img/machine.jpg",
    sortOrder: 4,
  },
  {
    slug: "work-06",
    title: "ヘルメット装飾",
    category: "マット黒",
    body: "面出し研磨#800 → プラサフ → マットブラック → つや消しクリア",
    coverSourceFile: "public/img/black-car.jpg",
    sortOrder: 5,
  },
];

export const WORKS_SEED: WorkInput[] = RAW_WORKS.map((w) =>
  zWorkInput.parse({
    slug: w.slug,
    title: w.title,
    category: w.category,
    body: w.body,
    process_note: null,
    cover_media_id: findMediaIdBySourceFile(w.coverSourceFile),
    image_ids: [findMediaIdBySourceFile(w.coverSourceFile)],
    sort_order: w.sortOrder,
  } satisfies WorkInput),
);
