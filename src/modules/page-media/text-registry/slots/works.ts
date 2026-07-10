import type { PageTextSlot } from "../types";

// ---------------------------------------------------------------------------
// works (14, route: "/works" + works/[slug]) — v2 Wave 1
//
// 一覧 (src/app/(site)/works/page-body.tsx) + 詳細 (src/app/(site)/works/[slug]/page-body.tsx)
// の全静的テキストを配線する。work.title/work.body/work.processNote/work.category/
// work.images 等 DB 由来の値は対象外 (docs/design/visual-text-editor-v2.md §Wave1)。
//
// works.cta.heading / works.cta.note は一覧・詳細で全く同じ文言 (CtaBand) を描画するため、
// notes.cta.* と同じパターンで 1 キーを両ルートに共有する (route は一覧側の "/works" を
// primary とし、affectedRoutes に両ルートを列挙する)。CtaBand の label ("相談する") は
// 新規スロットを作らず、既存の共有スロット shared.cta.consult (shared-chrome.ts) に配線する。
// ---------------------------------------------------------------------------
export const WORKS_TEXT_SLOTS: readonly PageTextSlot[] = [
  {
    key: "works.hero.heading",
    page: "works",
    route: "/works",
    label: "施工事例 / ヒーロー見出し",
    kind: "lines",
    maxLen: 36,
    defaultText: "3Dプリントを、\n量産品の顔に。",
    maxLines: 2,
    maxLineLen: 20,
  },
  {
    key: "works.hero.lead",
    page: "works",
    route: "/works",
    label: "施工事例 / ヒーローリード文",
    kind: "multiline",
    maxLen: 140,
    defaultText:
      "車両パーツからスマホカバー、小物、エアブラシ作品まで。素材や用途ごとに下地の作り方は変わりますが、狙う仕上がりはいつも「積層痕が消えて、量産品と見分けがつかない表面」です。",
  },
  {
    key: "works.sec.1.label",
    page: "works",
    route: "/works",
    label: "施工事例 / SEC.01 セクションラベル",
    kind: "text",
    maxLen: 20,
    defaultText: "SAMPLES",
  },
  {
    key: "works.empty.body",
    page: "works",
    route: "/works",
    label: "施工事例 / 0件時の説明文",
    kind: "text",
    maxLen: 60,
    defaultText: "施工事例は現在準備中です。実施工の写真・詳細が整い次第、順次公開します。",
  },
  {
    key: "works.empty.label",
    page: "works",
    route: "/works",
    label: "施工事例 / 0件時バッジ (STATUS — PREPARING)",
    kind: "text",
    maxLen: 30,
    defaultText: "STATUS — PREPARING",
  },
  {
    key: "works.gallery.placeholder.note",
    page: "works",
    route: "/works",
    label: "施工事例 / イメージ素材の注記",
    kind: "text",
    maxLen: 80,
    defaultText:
      "※ 掲載画像の一部はイメージ素材です(実際の施工写真は準備が整い次第、順次差し替えます)。",
  },
  {
    key: "works.sec.2.label",
    page: "works",
    route: "/works",
    label: "施工事例 / SEC.02 セクションラベル",
    kind: "text",
    maxLen: 20,
    defaultText: "NOTE",
  },
  {
    key: "works.cms.heading",
    page: "works",
    route: "/works",
    label: "施工事例 / CMS管理の案内見出し",
    kind: "text",
    maxLen: 30,
    defaultText: "一覧はCMSで管理しています。",
  },
  {
    key: "works.cms.lead",
    page: "works",
    route: "/works",
    label: "施工事例 / CMS管理の案内リード文 (SecLead内埋め込みのため text kind)",
    kind: "text",
    maxLen: 90,
    defaultText:
      "案件写真・素材・グレード・工程の一覧はCMS(管理画面)から更新され、このページへ即時反映されます。",
  },
  {
    key: "works.cta.heading",
    page: "works",
    route: "/works",
    label: "施工事例 / CTA帯 見出し (一覧・詳細で共有)",
    kind: "text",
    maxLen: 30,
    defaultText: "あなたの造形物も、この一覧に。",
    affectedRoutes: ["/works", "works/[slug]"],
  },
  {
    key: "works.cta.note",
    page: "works",
    route: "/works",
    label: "施工事例 / CTA帯 補足 (一覧・詳細で共有)",
    kind: "text",
    maxLen: 60,
    defaultText: "サイズ・個数・グレードの3点がわかれば概算をお出しできます。",
    affectedRoutes: ["/works", "works/[slug]"],
  },
  {
    key: "works.detail.hero.index",
    page: "works",
    route: "works/[slug]",
    label: "施工事例詳細 / PageHead 連番表記 (INDEX NN — ページ名)",
    kind: "text",
    maxLen: 25,
    defaultText: "INDEX 04 — WORKS",
  },
  {
    key: "works.detail.hero.en",
    page: "works",
    route: "works/[slug]",
    label: "施工事例詳細 / PageHead 英字サブラベル",
    kind: "text",
    maxLen: 30,
    defaultText: "CASE DETAIL",
  },
  {
    key: "works.detail.back.label",
    page: "works",
    route: "works/[slug]",
    label: "施工事例詳細 / 一覧に戻るボタン",
    kind: "text",
    maxLen: 20,
    defaultText: "施工事例一覧に戻る",
  },
];
