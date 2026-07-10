import type { PageTextSlot } from "../types";

// ---------------------------------------------------------------------------
// story (5 — PLAN.md 記載の 6 件から story.message.body を除外。text-registry/index.ts
// 冒頭コメント参照)
// route: "/story"
// ---------------------------------------------------------------------------
export const STORY_TEXT_SLOTS: readonly PageTextSlot[] = [
  {
    key: "story.hero.heading",
    page: "story",
    route: "/story",
    label: "ストーリー / ヒーロー見出し",
    kind: "lines",
    maxLen: 28,
    defaultText: "なぜ、積層痕と\n戦うことにしたのか。",
    maxLines: 2,
    maxLineLen: 20,
  },
  {
    key: "story.hero.lead",
    page: "story",
    route: "/story",
    label: "ストーリー / ヒーローリード文",
    kind: "multiline",
    maxLen: 200,
    defaultText:
      "家電の量産塗装で長年腕を磨いた職人が、どうして3Dプリントの表面処理という、まだ名前もない仕事に専念することにしたのか。一本の相談から始まった、下地をめぐる物語です。",
  },
  {
    key: "story.message.heading",
    page: "story",
    route: "/story",
    label: "ストーリー / 代表メッセージ見出し",
    kind: "lines",
    maxLen: 36,
    defaultText: "「見えなくなる仕事」に、\n誇りを持っています。",
    maxLines: 2,
  },
  {
    key: "story.cta.heading",
    page: "story",
    route: "/story",
    label: "ストーリー / CTA帯 見出し",
    kind: "lines",
    maxLen: 44,
    defaultText: "物語の続きは、\nあなたの造形物で。",
    maxLines: 2,
  },
  {
    key: "story.cta.note",
    page: "story",
    route: "/story",
    label: "ストーリー / CTA帯 補足",
    kind: "text",
    maxLen: 60,
    defaultText: "「絶対に外せない一個」を、量産品の顔に。まずはお気軽にご相談ください。",
  },
];
