import { zVoiceInput, type VoiceInput } from "@/modules/content/contracts";

/**
 * src/app/voices/page.tsx の VOICES 定数から一字一句転記。
 * heading (見出し) は zVoiceInput に対応するフィールドがないため body の先頭に残す
 * (「見出し。本文」という構成で内容を欠落させずに保持する)。
 * name の「様」敬称・area は customer_initial / region にそのまま対応。
 * 写真は元データに存在しないため photo_media_id は null。
 */
const RAW_VOICES: {
  headingAndBody: string;
  customerInitial: string;
  region: string;
  rating: number;
  item: string;
  sortOrder: number;
}[] = [
  {
    headingAndBody:
      "オリジナル3Dプリントフィギュアの仕上がりに感動。自分でデザインしたフィギュアの積層痕がまったく気にならない仕上がりになって驚きました。陰影のグラデーションも思っていた以上に自然で、量産のフィギュアと並べても違和感がありません。",
    customerInitial: "K.T",
    region: "福岡県",
    rating: 5,
    item: "フィギュア(エアブラシグラデーション)",
    sortOrder: 0,
  },
  {
    headingAndBody:
      "小ロットでも丁寧に対応いただけた。3個だけの小ロットでも「数が少ないので」と断られることなく、通常と同じ工程で仕上げていただけました。色味の相談にも細かく応じてくれて、届いた実物は写真以上に質感がよかったです。",
    customerInitial: "M.S",
    region: "大分県",
    rating: 5,
    item: "小型カスタムパーツ(3個・メタリック仕上げ)",
    sortOrder: 1,
  },
  {
    headingAndBody:
      "相談段階から工程を細かく共有してくれる。見積もり前の相談の時点で、下地からクリアまでの工程と納期の目安を具体的に説明してもらえたので安心して任せられました。郵送でのやり取りでしたが、進捗の連絡もこまめにいただけました。",
    customerInitial: "R.H",
    region: "東京都(匿名)",
    rating: 4,
    item: "車両パーツ(ソリッドカラー)",
    sortOrder: 2,
  },
];

export const VOICES_SEED: VoiceInput[] = RAW_VOICES.map((v) =>
  zVoiceInput.parse({
    customer_initial: v.customerInitial,
    region: v.region,
    rating: v.rating,
    body: v.headingAndBody,
    item: v.item,
    photo_media_id: null,
    sort_order: v.sortOrder,
  } satisfies VoiceInput),
);
