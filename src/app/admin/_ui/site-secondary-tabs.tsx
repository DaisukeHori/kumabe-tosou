import { UnderlineTabs, type UnderlineTab } from "@/app/admin/_ui";

/**
 * [#126 R5] 「ホームページ更新」ハブの 5 タブ。
 *
 * 移行設計.md §1.2A (確定: ルート維持型タブハブ) に沿って、公開サイト運用系の 5 ルート
 * (施工事例 / 記事 / お客様の声 / 写真・画像 / 見た目の編集) を 1 つのハブ配下の
 * URL 維持型タブへ統合する。5 つの既存 URL はそのまま生かし、各一覧ページ上部に
 * このタブ行を置いて相互遷移できるようにする (単一ページ /admin/site 化・ディレクトリ移動・
 * リダイレクトはしない)。全 URL は不変 (ブックマーク切れ・テスト破壊ゼロ)。
 *
 * カレンダー設定ハブ (CalendarSettingsTabs) と同じく R0 の共通 `UnderlineTabs`
 * (usePathname による active 自己判定 + admin トークン追従の下線) を利用する。
 * active 判定は既定の「完全一致 or 配下パス」。一覧 (/admin/works 等) では完全一致で active、
 * new/[id] 配下でも同じタブが active になる (ただしタブ行自体は一覧 5 ページにのみ配置)。
 */
const SITE_TABS: readonly UnderlineTab[] = [
  { href: "/admin/works", label: "施工事例" },
  { href: "/admin/posts", label: "記事" },
  { href: "/admin/voices", label: "お客様の声" },
  { href: "/admin/media", label: "写真・画像" },
  { href: "/admin/visual", label: "見た目の編集" },
];

export function SiteSecondaryTabs() {
  return <UnderlineTabs tabs={SITE_TABS} ariaLabel="ホームページ更新" />;
}
