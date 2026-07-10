import type { PageTextSlot } from "../types";

// ---------------------------------------------------------------------------
// notes (4, route: "/notes") — notes.cta.* は notes/[slug] とも共有 (PLAN.md §5.8)
// ---------------------------------------------------------------------------
export const NOTES_TEXT_SLOTS: readonly PageTextSlot[] = [
  {
    key: "notes.hero.heading",
    page: "notes",
    route: "/notes",
    label: "読みもの / ヒーロー見出し",
    kind: "lines",
    maxLen: 34,
    defaultText: "なぜ綺麗なのかは、\n写真だけでは伝わらない。",
    maxLines: 2,
    maxLineLen: 20,
  },
  {
    key: "notes.hero.lead",
    page: "notes",
    route: "/notes",
    label: "読みもの / ヒーローリード文",
    kind: "multiline",
    maxLen: 200,
    defaultText: "工程と色の裏側を、言葉で残しています。専門性は、言語化してはじめて伝わる——それがこの工房の考え方です。",
  },
  {
    key: "notes.cta.heading",
    page: "notes",
    route: "/notes",
    label: "読みもの / CTA帯 見出し (一覧・詳細で共有)",
    kind: "lines",
    maxLen: 44,
    defaultText: "読んで気になったことは、\nそのまま聞いてください。",
    maxLines: 2,
    affectedRoutes: ["/notes", "notes/[slug]"],
  },
  {
    key: "notes.cta.note",
    page: "notes",
    route: "/notes",
    label: "読みもの / CTA帯 補足 (一覧・詳細で共有)",
    kind: "text",
    maxLen: 60,
    defaultText: "工程・色・素材の相性、どんな質問でも。",
    affectedRoutes: ["/notes", "notes/[slug]"],
  },
];
