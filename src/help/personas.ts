import type { HelpPersonaId } from "./types";

/**
 * ヘルプのユースケースに登場する人物像。canonical: docs/design/admin-help/README.md §4。
 * 「誰が・どんな状況で使うか」を統一するために、各ページのヘルプはここから引く
 * (ページごとに設定を作らない)。
 */
export type HelpPersona = {
  id: HelpPersonaId;
  name: string;
  role: string;
  /** 1〜2 文の人物紹介 (高校生が読んで分かる言葉で)。 */
  description: string;
  /** よく使う端末や時間帯など、操作の前提。 */
  habit: string;
};

export const HELP_PERSONAS: Record<HelpPersonaId, HelpPersona> = {
  yamagishi: {
    id: "yamagishi",
    name: "山岸 信之",
    role: "代表・塗装職人",
    description:
      "会社の代表で、日中はほとんど作業場にいます。見積の金額や予定を決めるのはこの人です。",
    habit: "パソコンを触るのは夜に少しだけ。日中はスマートフォンで確認することが多いです。",
  },
  sato: {
    id: "sato",
    name: "佐藤 さん",
    role: "事務スタッフ (週 3 日)",
    description:
      "見積書と請求書の作成、入金の確認、メールの返信を担当しています。数字の扱いに慣れています。",
    habit: "出勤日の午前中にまとめて処理します。パソコンの画面を見ながら作業します。",
  },
  customer: {
    id: "customer",
    name: "お客様 (田中さん)",
    role: "3D プリント造形を依頼する会社の担当者",
    description:
      "初めてホームページから問い合わせをする人です。専門用語には慣れていません。",
    habit: "ホームページのフォームやメールでやり取りします。管理画面は見ません。",
  },
};

export function getHelpPersona(id: HelpPersonaId): HelpPersona {
  return HELP_PERSONAS[id];
}
