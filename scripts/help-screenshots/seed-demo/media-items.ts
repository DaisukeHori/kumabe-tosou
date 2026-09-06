/**
 * ヘルプ撮影用デモ画像の一覧 (id と元ファイルの対応)。
 *
 * - media-seed.ts: この一覧を Supabase 開発ブランチへ投入する。
 * - pages/media.ts: 撮影時に同じ画像をローカルから表示するために使う。
 * 固定 id にしてあるので、投入し直しても画像とデモデータの対応が変わらない。
 */
export type HelpMediaSeedItem = {
  id: string;
  file: string;
  alt: string;
  credit: string | null;
  tags: string[];
  isPlaceholder: boolean;
};

export const HELP_MEDIA_SEED: HelpMediaSeedItem[] = [
  {
    id: "4d000001-0000-4000-8000-000000000001",
    file: "IMG_2381.png",
    alt: "塗装が仕上がったフィギュアを正面から撮った写真",
    credit: "熊部塗装",
    tags: ["フィギュア", "完成写真"],
    isPlaceholder: false,
  },
  {
    id: "4d000001-0000-4000-8000-000000000002",
    file: "IMG_2382.png",
    alt: "フィギュアに下塗りをしている作業中の写真",
    credit: "熊部塗装",
    tags: ["フィギュア", "作業風景"],
    isPlaceholder: false,
  },
  {
    id: "4d000001-0000-4000-8000-000000000003",
    file: "IMG_2415.png",
    alt: "小物パーツを並べて仕上がりを確認している写真",
    credit: "熊部塗装",
    tags: ["小物", "完成写真"],
    isPlaceholder: false,
  },
  {
    id: "4d000001-0000-4000-8000-000000000004",
    file: "IMG_2390.png",
    alt: "塗装が終わった自動車パーツを台に載せた写真",
    credit: "熊部塗装",
    tags: ["自動車パーツ", "完成写真"],
    isPlaceholder: false,
  },
  {
    id: "4d000001-0000-4000-8000-000000000005",
    file: "IMG_2391.png",
    alt: "自動車パーツの下地処理をしている写真",
    credit: "熊部塗装",
    tags: ["自動車パーツ", "作業風景"],
    isPlaceholder: false,
  },
  {
    id: "4d000001-0000-4000-8000-000000000006",
    file: "IMG_2402.png",
    alt: "塗装ブースで吹き付けをしている作業風景",
    credit: "熊部塗装",
    tags: ["作業風景"],
    isPlaceholder: false,
  },
  {
    id: "4d000001-0000-4000-8000-000000000007",
    file: "IMG_2420.png",
    alt: "工房を外から撮った写真",
    credit: "熊部塗装",
    tags: ["工房"],
    isPlaceholder: false,
  },
  {
    id: "4d000001-0000-4000-8000-000000000008",
    file: "IMG_2431.png",
    alt: "看板の色を試し塗りした板の写真 (差し替え予定)",
    credit: null,
    tags: ["仮素材"],
    isPlaceholder: true,
  },
];
