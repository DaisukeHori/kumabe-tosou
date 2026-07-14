/**
 * 左サイドナビ項目一覧 (設計書 §5.2 画面一覧と 1:1)。
 * 未実装の画面もリンクだけ置く (実装され次第、他 agent が該当ルートを追加する)。
 *
 * #94 でグループ化 (6 セクション・18 項目、URL パス変更なし)。今後 nav-items を
 * 追加する場合は該当グループの items 配下へ追加すること (フラットな配列への
 * 直接追加は不可。裁定 J14 — docs/design/crm-suite/00-overview.md §2.4)。
 */
export type AdminNavItem = { readonly href: string; readonly label: string };

export type AdminNavGroup = {
  /**
   * 折りたたみ状態の localStorage 永続化キー (kumabe-admin-nav-collapsed:v1 の
   * JSON 配列要素)。グループ間で一意。label:null のグループ (ダッシュボード) は
   * 折りたたみ UI を持たないため実質未使用だが、一意性検証の対象にするため付与する。
   */
  readonly id: string;
  /** null = グループ外の単独項目 (ダッシュボード)。見出し・折りたたみを持たない。 */
  readonly label: string | null;
  readonly items: readonly AdminNavItem[];
};

// 明示的に readonly AdminNavGroup[] 型を付与する (as const のみだとグループごとに
// items のタプル型が異なり、TS の flatMap 型推論が最初のグループの要素型のみを
// 採用してしまい、他グループの item (href/label) を型エラーにする既知の制約への対処)。
export const ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = [
  {
    id: "dashboard",
    label: null,
    items: [{ href: "/admin", label: "ダッシュボード" }],
  },
  {
    id: "crm",
    label: "顧客管理",
    items: [
      { href: "/admin/customers", label: "顧客" },
      { href: "/admin/deals", label: "案件" },
      { href: "/admin/tasks", label: "やること" },
    ],
  },
  {
    id: "sales-ops",
    label: "営業・予定",
    items: [
      { href: "/admin/documents", label: "帳票" },
      { href: "/admin/calendar", label: "カレンダー" },
      { href: "/admin/calls", label: "通話" },
    ],
  },
  {
    id: "content",
    label: "ホームページ",
    items: [
      { href: "/admin/works", label: "施工事例" },
      { href: "/admin/posts", label: "記事" },
      { href: "/admin/voices", label: "お客様の声" },
      { href: "/admin/media", label: "メディア" },
      { href: "/admin/visual", label: "ビジュアル編集" },
    ],
  },
  {
    id: "site",
    label: "サイト運営",
    items: [
      { href: "/admin/prices", label: "価格表" },
      { href: "/admin/inquiries", label: "問い合わせ" },
      { href: "/admin/channels", label: "チャネル管理" },
      { href: "/admin/settings", label: "サイト設定" },
    ],
  },
  {
    id: "system",
    label: "システム",
    items: [
      { href: "/admin/studio", label: "AIスタジオ" },
      { href: "/admin/costs", label: "利用料金" },
    ],
  },
] as const;

// 後方互換の derived export (J11 以降の設計書が「ADMIN_NAV_ITEMS へ追加」と
// 記述しているため残す)。
export const ADMIN_NAV_ITEMS = ADMIN_NAV_GROUPS.flatMap((g) => g.items);
