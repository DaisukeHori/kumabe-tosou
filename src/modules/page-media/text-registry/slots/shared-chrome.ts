import type { PageTextSlot } from "../types";

// ---------------------------------------------------------------------------
// shared / chrome (2) — route 横断の共有スロット (PLAN.md §2.2)
// ---------------------------------------------------------------------------
export const SHARED_CHROME_TEXT_SLOTS: readonly PageTextSlot[] = [
  {
    key: "shared.cta.consult",
    page: "shared",
    route: "/",
    label: "共通 / 「相談する」ボタン",
    kind: "text",
    maxLen: 8,
    defaultText: "相談する",
    affectsAllRoutes: true,
  },
  {
    key: "chrome.footer.tagline",
    page: "chrome",
    route: "/",
    label: "共通 / フッター事業紹介文",
    kind: "multiline",
    maxLen: 80,
    defaultText:
      "3Dプリント造形物の表面処理(研磨・塗装)専門工房。積層痕除去から自動車グレードの仕上げまで、郵送で全国からお受けします。",
    affectsAllRoutes: true,
  },
];
