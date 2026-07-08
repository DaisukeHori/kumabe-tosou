import { z } from "zod";

import { zMediaId } from "@/modules/platform/contracts";
import { zMediaPatch } from "@/modules/media/contracts";

/**
 * media テーブルへ投入する原本メディアの一覧。
 *
 * (契約との乖離メモ) module-contracts.md §4.8 は media の「編集」入力 (zMediaPatch) のみを
 * 定義しており、「新規作成」入力の Zod スキーマは定義されていない (media の作成は Storage
 * アップロード + repository INSERT であり、フォーム入力として契約化されていないため)。
 * そのためこのファイルでは id を zMediaId で、alt/tags/is_placeholder を zMediaPatch
 * (partial) と同じ制約の完全形スキーマで検証する。将来 media の作成入力契約が必要になった
 * 場合は module-contracts.md §4.8 に zMediaCreateInput 相当を追加し、本ファイルもそれに従う。
 */
const zSeedMediaRow = z.object({
  id: zMediaId,
  // Storage 上のファイル名。scripts/seed-from-legacy.ts が public/img/<file> を読み込む際の参照に使う。
  sourceFile: z.string().min(1),
  // media-originals バケット内パス (アップロード先)。
  storagePath: z.string().min(1),
  alt: zMediaPatch.shape.alt.unwrap(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  mimeType: z.string().min(1),
  credit: z.string().nullable(),
  isPlaceholder: zMediaPatch.shape.is_placeholder.unwrap(),
  tags: zMediaPatch.shape.tags.unwrap(),
});
export type SeedMediaRow = z.infer<typeof zSeedMediaRow>;

/**
 * 実在ファイルは public/hero.jpg, public/og-image.jpg, public/img/*.jpg (legacy 資産)。
 * alt / credit は各ページのハードコード文言から一字一句転記 (works ページの alt を優先採用。
 * 同一画像バイト列が複数ページで別の alt 文言に使われているケース (hero.jpg = og-image.jpg =
 * black-car.jpg、md5 で確認済み) は、用途ごとに別 media 行として個別に alt を保持する
 * 方針を採った — DDL の media.alt がメディア 1 行につき 1 値である制約と、
 * ページごとに異なる alt 文言を両立させるため)。
 */
export const MEDIA_SEED: SeedMediaRow[] = (
  [
    {
      id: "10381a05-baf4-45fe-90f5-a777177d08e5",
      sourceFile: "public/hero.jpg",
      storagePath: "seed/hero.jpg",
      alt: "深い艶で仕上げられた黒い車体",
      width: 1400,
      height: 787,
      mimeType: "image/jpeg",
      credit: "cmreflections / Unsplash",
      isPlaceholder: true,
      tags: ["hero"],
    },
    {
      id: "925e6898-6a98-4ea4-8c86-8be1556bca23",
      sourceFile: "public/og-image.jpg",
      storagePath: "seed/og-image.jpg",
      alt: "隈部塗装 — 3Dプリント表面処理の専門工房",
      width: 1400,
      height: 787,
      mimeType: "image/jpeg",
      credit: null,
      isPlaceholder: true,
      tags: ["og"],
    },
    {
      id: "5cc0ae2e-562a-4530-aad9-b764cdd1d8e5",
      sourceFile: "public/img/car-detail.jpg",
      storagePath: "seed/works/car-detail.jpg",
      alt: "車体パーツのクローズアップ",
      width: 1400,
      height: 2488,
      mimeType: "image/jpeg",
      credit: null,
      isPlaceholder: true,
      tags: ["works"],
    },
    {
      id: "b77e74cc-83ee-4a6a-8689-efb54e41de9e",
      sourceFile: "public/img/surface.jpg",
      storagePath: "seed/works/surface.jpg",
      alt: "光をふくんだ表面の質感",
      width: 1400,
      height: 1400,
      mimeType: "image/jpeg",
      credit: null,
      isPlaceholder: true,
      tags: ["works"],
    },
    {
      id: "2052378a-478b-4db8-b8ef-d3133b03ddd8",
      sourceFile: "public/img/airbrush-dark.jpg",
      storagePath: "seed/works/airbrush-dark.jpg",
      alt: "エアブラシで陰影をつくる作業",
      width: 1400,
      height: 933,
      mimeType: "image/jpeg",
      credit: null,
      isPlaceholder: true,
      tags: ["works"],
    },
    {
      id: "4ab32530-eda4-489b-b0f4-368a77ac13fd",
      sourceFile: "public/img/metal-work.jpg",
      storagePath: "seed/works/metal-work.jpg",
      alt: "金属的な質感の加工物",
      width: 1400,
      height: 2100,
      mimeType: "image/jpeg",
      credit: null,
      isPlaceholder: true,
      tags: ["works"],
    },
    {
      id: "7cd31e28-208c-4496-8948-445a3ee1fa17",
      sourceFile: "public/img/machine.jpg",
      storagePath: "seed/works/machine.jpg",
      alt: "産業機械のような質感の造形物",
      width: 1400,
      height: 2099,
      mimeType: "image/jpeg",
      credit: null,
      isPlaceholder: true,
      tags: ["works"],
    },
    {
      id: "670e0231-0e7c-479b-9549-d3b668b1c361",
      sourceFile: "public/img/black-car.jpg",
      storagePath: "seed/works/black-car.jpg",
      alt: "モノクロの艶消し質感",
      width: 1400,
      height: 787,
      mimeType: "image/jpeg",
      credit: null,
      isPlaceholder: true,
      tags: ["works"],
    },
  ] satisfies SeedMediaRow[]
).map((row) => zSeedMediaRow.parse(row));

export function findMediaIdBySourceFile(sourceFile: string): string {
  const row = MEDIA_SEED.find((m) => m.sourceFile === sourceFile);
  if (!row) throw new Error(`seed media not found for source file: ${sourceFile}`);
  return row.id;
}
