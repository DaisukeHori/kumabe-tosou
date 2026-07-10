import type { PageTextSlot } from "../types";

// ---------------------------------------------------------------------------
// about (7, route: "/about")
// ---------------------------------------------------------------------------
export const ABOUT_TEXT_SLOTS: readonly PageTextSlot[] = [
  {
    key: "about.hero.heading",
    page: "about",
    route: "/about",
    label: "会社案内 / ヒーロー見出し",
    kind: "lines",
    maxLen: 36,
    defaultText: "下地の仕事は、\n見えなくなるからこそ。",
    maxLines: 2,
    maxLineLen: 20,
  },
  {
    key: "about.hero.lead",
    page: "about",
    route: "/about",
    label: "会社案内 / ヒーローリード文",
    kind: "multiline",
    maxLen: 200,
    defaultText:
      "仕上がった塗面に、研ぎの跡は残りません。それでも、艶の深さも、色の正確さも、すべては見えなくなった下地が決めています。隈部塗装は、その見えない工程に最も時間を割く工房です。",
  },
  {
    key: "about.why.heading",
    page: "about",
    route: "/about",
    label: "会社案内 / WHY THIS WORKSHOP 見出し",
    kind: "lines",
    maxLen: 40,
    defaultText: "「表面処理だけ頼みたい」に、\n応える工房が少なかった。",
    maxLines: 2,
  },
  {
    key: "about.facility.heading",
    page: "about",
    route: "/about",
    label: "会社案内 / FACILITY 見出し",
    kind: "text",
    maxLen: 24,
    defaultText: "バンパー6本を、同時に塗れる。",
  },
  {
    key: "about.gallery.heading",
    page: "about",
    route: "/about",
    label: "会社案内 / GALLERY 見出し",
    kind: "text",
    maxLen: 18,
    defaultText: "現場の、手ざわり。",
  },
  {
    key: "about.cta.heading",
    page: "about",
    route: "/about",
    label: "会社案内 / CTA帯 見出し",
    kind: "lines",
    maxLen: 44,
    defaultText: "工程と料金の詳細は、\nサービスページに。",
    maxLines: 2,
  },
  {
    key: "about.cta.note",
    page: "about",
    route: "/about",
    label: "会社案内 / CTA帯 補足",
    kind: "text",
    maxLen: 60,
    defaultText: "下地は全グレード共通。差分はトップコートの層数だけです。",
  },
];
