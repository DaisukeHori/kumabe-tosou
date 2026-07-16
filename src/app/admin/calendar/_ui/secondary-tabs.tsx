import { UnderlineTabs, type UnderlineTab } from "@/app/admin/_ui";

/**
 * [#125 R4b] カレンダー設定ハブの 3 タブ (外部連携 / テンプレート / 作業種別)。
 *
 * 移行設計.md §1.2B (確定: ルート維持型ハブ) に沿って、旧 4 タブ (予定表を含む)
 * `CalendarSecondaryTabs` を「カレンダー設定」3 タブへ再編した。予定表 (/admin/calendar)
 * はこのタブ行を持たず、ヘッダ右のギア導線 (⚙ カレンダー設定) から connections へ入る。
 * URL はすべて不変 (リダイレクト・ブックマーク切れ・テスト破壊ゼロ)。
 *
 * 旧実装の `border-soul` (公開サイトトークン) は廃止し、R0 の共通 `UnderlineTabs`
 * (admin primary の下線・トークン追従) を利用する。既定タブはモック `calSettings` 準拠で
 * connections (ギア導線の飛び先も connections)。
 */
const SETTINGS_TABS: readonly UnderlineTab[] = [
  { href: "/admin/calendar/connections", label: "外部連携" },
  { href: "/admin/calendar/templates", label: "テンプレート" },
  { href: "/admin/calendar/types", label: "作業種別" },
];

export function CalendarSettingsTabs() {
  return <UnderlineTabs tabs={SETTINGS_TABS} ariaLabel="カレンダー設定" />;
}
