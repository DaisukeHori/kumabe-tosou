import type { PageTextSlot } from "../types";

// ---------------------------------------------------------------------------
// voices (12, route: "/voices")
// v2 Wave 1 (docs/design/visual-text-editor-v2.md §5): page-body.tsx (server) +
// voice-body.tsx ("use client", 手動 data-editable-text パターン) の全静的テキストを配線。
// defaultText は現行描画テキストと1文字も違わない (非退行)。「相談する」ボタンは共通スロット
// shared.cta.consult (shared-chrome.ts) を再利用し、本ファイルには重複登録しない。
// shop.ts / about.ts の Wave 1 方針を踏襲し、SectionMark の `label` は対象に含めるが
// `no` ("SEC. 01") は対象外 (装飾的な連番のため)。rich 語彙なし (ページ内は全て plain)。
// ---------------------------------------------------------------------------
export const VOICES_TEXT_SLOTS: readonly PageTextSlot[] = [
  {
    key: "voices.hero.index",
    page: "voices",
    route: "/voices",
    label: "お客様の声 / PageHead 連番表記 (INDEX NN — ページ名)",
    kind: "text",
    maxLen: 25,
    defaultText: "INDEX 05 — VOICES",
  },
  {
    key: "voices.hero.en",
    page: "voices",
    route: "/voices",
    label: "お客様の声 / PageHead 英字サブラベル",
    kind: "text",
    maxLen: 30,
    defaultText: "CUSTOMER VOICES",
  },
  {
    key: "voices.hero.heading",
    page: "voices",
    route: "/voices",
    label: "お客様の声 / ヒーロー見出し",
    kind: "lines",
    maxLen: 30,
    defaultText: "仕上がりを見た方の、\n率直な声。",
    maxLines: 2,
    maxLineLen: 18,
  },
  {
    key: "voices.hero.lead",
    page: "voices",
    route: "/voices",
    label: "お客様の声 / ヒーローリード文",
    kind: "multiline",
    maxLen: 160,
    defaultText:
      "ご依頼いただいた方からいただいたご感想を掲載しています。小ロット・個人利用のご依頼が多いため、掲載にあたってはお名前をイニシャルとし、ご了承いただいた範囲でご紹介しています。",
  },
  {
    key: "voices.sec.label",
    page: "voices",
    route: "/voices",
    label: "お客様の声 / SEC.01 セクションラベル",
    kind: "text",
    maxLen: 16,
    defaultText: "VOICES",
  },
  {
    key: "voices.empty.message",
    page: "voices",
    route: "/voices",
    label: "お客様の声 / 0件時の案内文 (EmptyState)",
    kind: "text",
    maxLen: 70,
    defaultText: "お客様の声は現在準備中です。ご了承をいただいたご感想を、順次掲載していきます。",
  },
  {
    key: "voices.card.item.prefix",
    page: "voices",
    route: "/voices",
    label: "お客様の声 / カード 施工品目の接頭辞",
    kind: "text",
    maxLen: 20,
    defaultText: "施工品目 — ",
  },
  {
    key: "voices.card.customer.suffix",
    page: "voices",
    route: "/voices",
    label: "お客様の声 / カード お客様名の敬称 (接尾辞)",
    kind: "text",
    maxLen: 8,
    defaultText: " 様",
  },
  {
    key: "voices.mapnote",
    page: "voices",
    route: "/voices",
    label: "お客様の声 / 掲載ポリシー注記",
    kind: "text",
    maxLen: 60,
    defaultText: "※ 掲載しているお客様の声は、ご了承をいただいたうえで公開しています。",
  },
  {
    key: "voices.cta.works",
    page: "voices",
    route: "/voices",
    label: "お客様の声 / CTAボタン (施工事例を見る)",
    kind: "text",
    maxLen: 20,
    defaultText: "施工事例を見る",
  },
  {
    key: "voices.body.readmore",
    page: "voices",
    route: "/voices",
    label: "お客様の声 / 本文展開ボタン (続きを読む, voice-body.tsx client)",
    kind: "text",
    maxLen: 12,
    defaultText: "続きを読む",
  },
  {
    key: "voices.body.collapse",
    page: "voices",
    route: "/voices",
    label: "お客様の声 / 本文折りたたみボタン (閉じる, voice-body.tsx client)",
    kind: "text",
    maxLen: 12,
    defaultText: "閉じる",
  },
];
