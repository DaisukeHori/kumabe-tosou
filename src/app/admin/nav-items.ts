/**
 * 左サイドナビ項目一覧 (設計書 §5.2 画面一覧と 1:1)。
 * 未実装の画面もリンクだけ置く (実装され次第、他 agent が該当ルートを追加する)。
 */
export const ADMIN_NAV_ITEMS = [
  { href: "/admin", label: "ダッシュボード" },
  { href: "/admin/works", label: "施工事例" },
  { href: "/admin/posts", label: "記事" },
  { href: "/admin/voices", label: "お客様の声" },
  { href: "/admin/prices", label: "価格表" },
  { href: "/admin/media", label: "メディア" },
  { href: "/admin/inquiries", label: "問い合わせ" },
  { href: "/admin/studio", label: "AIスタジオ" },
  { href: "/admin/channels", label: "チャネル管理" },
  { href: "/admin/settings", label: "サイト設定" },
] as const;
