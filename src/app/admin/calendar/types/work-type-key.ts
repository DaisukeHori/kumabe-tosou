/**
 * 作業種別「識別子 (key)」の自動生成 (Issue #97)。
 *
 * zWorkTypeInput.key の regex `/^[a-z0-9_]{2,30}$/` (src/modules/scheduling/contracts.ts) に
 * 常に適合する値を生成する純関数。type-editor.tsx (WorkTypeFormDialog) の「表示名 watch → key
 * 自動セット (keyDirty=false の間)」から呼ばれる。
 *
 * 【設計からの軽微な逸脱】Issue #97 の設計は「同ファイル内 (type-editor.tsx) に実装」を指示している
 * が、type-editor.tsx は "use client" + `../actions` (Server Actions ファイル) 経由で
 * scheduling facade を含む重い import chain を持つ。tests/ 配下は jsdom/@testing-library 非導入
 * (vitest.config.ts environment: "node") のため、同ファイルに置くと単体テストが actions.ts の
 * モック化を要求し脆くなる。costs/aggregate.ts・components/motion/tilt-math.ts と同型の
 * 「純関数を隣接 .ts に切り出してテストする」既存規約に倣い、本ファイルへ分離した
 * (type-editor.tsx からは通常の import で使用— 実質的に「同ファイル (機能単位)」の範囲内)。
 */

const ASCII_LABEL_RE = /^[A-Za-z0-9 _-]+$/;
const KEY_RE = /^[a-z0-9_]{2,30}$/;

export function generateWorkTypeKey(label: string): string {
  const trimmed = label.trim();
  if (trimmed.length > 0 && ASCII_LABEL_RE.test(trimmed)) {
    const slug = trimmed
      .toLowerCase()
      .replace(/[\s-]+/g, "_")
      .replace(/[^a-z0-9_]/g, "")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 30);
    if (KEY_RE.test(slug)) return slug;
  }
  // 日本語ラベル等 (ASCII に適合しない) や短すぎる/記号のみの ASCII ラベルは、非意味的だが
  // 常に regex 適合する key へフォールバックする (詳細設定でいつでも手動上書き可能)。
  const rand = Math.floor(Math.random() * 100)
    .toString()
    .padStart(2, "0");
  return `wt_${Date.now().toString(36)}${rand}`.slice(0, 30);
}
