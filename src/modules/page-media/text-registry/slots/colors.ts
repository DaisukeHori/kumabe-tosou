import type { PageTextSlot } from "../types";

// ---------------------------------------------------------------------------
// colors (4, route: "/colors")
// ---------------------------------------------------------------------------
export const COLORS_TEXT_SLOTS: readonly PageTextSlot[] = [
  {
    key: "colors.hero.heading",
    page: "colors",
    route: "/colors",
    label: "色見本 / ヒーロー見出し (8枚 = SWATCHES.length と手動同期)",
    kind: "lines",
    maxLen: 36,
    defaultText: "名車の象徴色で組んだ、\n8枚の技術証明。",
    maxLines: 2,
    maxLineLen: 20,
  },
  {
    key: "colors.hero.lead",
    page: "colors",
    route: "/colors",
    label: "色見本 / ヒーローリード文 (8色中5色 = 手動同期)",
    kind: "multiline",
    maxLen: 200,
    defaultText:
      "見る人に一瞬で技術レベルを伝えるための、色見本ラインナップです。8色中5色が3コート・高難度系。いずれも市販の調色済み補修塗料を正規の用途で使用し、「参考色」として仕上げます。実物の色見本パネル（対辺70mmの六角形・裏面カラーコード刻印）は、郵送でお貸し出しできるよう準備中です。",
  },
  {
    key: "colors.cta.heading",
    page: "colors",
    route: "/colors",
    label: "色見本 / CTA帯 見出し",
    kind: "lines",
    maxLen: 44,
    defaultText: "この8色以外も、\n色番号でご指定いただけます。",
    maxLines: 2,
  },
  {
    key: "colors.cta.note",
    page: "colors",
    route: "/colors",
    label: "色見本 / CTA帯 補足",
    kind: "text",
    maxLen: 60,
    defaultText: "日塗工番号・自動車カラーコードに対応。まずはサイズ×個数×グレードでご相談ください。",
  },
];
