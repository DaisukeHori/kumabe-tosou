import type { PageTextSlot } from "../types";

// ---------------------------------------------------------------------------
// contact (2, route: "/contact")
// ---------------------------------------------------------------------------
export const CONTACT_TEXT_SLOTS: readonly PageTextSlot[] = [
  {
    key: "contact.hero.heading",
    page: "contact",
    route: "/contact",
    label: "相談する / ヒーロー見出し",
    kind: "lines",
    maxLen: 20,
    defaultText: "見積もりは、\n3つの数字で。",
    maxLines: 2,
    maxLineLen: 20,
  },
  {
    key: "contact.hero.lead",
    page: "contact",
    route: "/contact",
    label: "相談する / ヒーローリード文",
    kind: "multiline",
    maxLen: 200,
    defaultText:
      "「サイズ × 個数 × グレード」がわかれば、概算をお出しできます。下地が全グレード共通だから、見積もりの構造もこれだけシンプルです。造形データや写真、素材の種類がわかると、より正確になります。",
  },
];
