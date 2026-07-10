import type { PageTextSlot } from "../types";

// ---------------------------------------------------------------------------
// service (8, route: "/service")
// ---------------------------------------------------------------------------
export const SERVICE_TEXT_SLOTS: readonly PageTextSlot[] = [
  {
    key: "service.hero.heading",
    page: "service",
    route: "/service",
    label: "サービス・料金 / ヒーロー見出し",
    kind: "lines",
    maxLen: 36,
    defaultText: "下地は全グレード共通。\nだから品質が揺れない。",
    maxLines: 2,
    maxLineLen: 20,
  },
  {
    key: "service.hero.lead",
    page: "service",
    route: "/service",
    label: "サービス・料金 / ヒーローリード文",
    kind: "multiline",
    maxLen: 200,
    defaultText:
      "自動車板金塗装のプロ標準工程を、そのまま3Dプリントに適用します。グレードの違いはトップコートの層数だけ。見積もりも「サイズ × 個数 × グレード」の3つで決まる、シンプルな構造です。",
  },
  {
    key: "service.process.aside.heading",
    page: "service",
    route: "/service",
    label: "サービス・料金 / 「なぜ鏡面磨きをしないのか」見出し",
    kind: "text",
    maxLen: 20,
    defaultText: "なぜ鏡面磨きをしないのか",
  },
  {
    key: "service.terms.heading",
    page: "service",
    route: "/service",
    label: "サービス・料金 / HONEST TERMS 見出し",
    kind: "text",
    maxLen: 20,
    defaultText: "正直に、先にお伝えします。",
  },
  {
    key: "service.qc.heading",
    page: "service",
    route: "/service",
    label: "サービス・料金 / QUALITY CONTROL 見出し",
    kind: "text",
    maxLen: 20,
    defaultText: "発送前に、8つの目で見る。",
  },
  {
    key: "service.gallery.heading",
    page: "service",
    route: "/service",
    label: "サービス・料金 / GALLERY 見出し",
    kind: "text",
    maxLen: 16,
    defaultText: "工程の、その手。",
  },
  {
    key: "service.cta.heading",
    page: "service",
    route: "/service",
    label: "サービス・料金 / CTA帯 見出し",
    kind: "lines",
    maxLen: 44,
    defaultText: "見積もりは、3つの数字で。\nサイズ × 個数 × グレード。",
    maxLines: 2,
  },
  {
    key: "service.cta.note",
    page: "service",
    route: "/service",
    label: "サービス・料金 / CTA帯 補足",
    kind: "text",
    maxLen: 60,
    defaultText: "造形データや写真があれば、より正確に概算をお出しできます。",
  },
];
