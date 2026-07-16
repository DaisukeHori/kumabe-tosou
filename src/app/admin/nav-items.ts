/**
 * 左サイドナビ項目一覧 (設計書 §5.2 画面一覧と 1:1)。
 * 未実装の画面もリンクだけ置く (実装され次第、他 agent が該当ルートを追加する)。
 *
 * #94 でグループ化 (6 セクション・18 項目、URL パス変更なし)。
 * #118 (R1) で「リソース別」から「業務フェーズ別」IA へ再編 (①お客さんを作る→
 * ②受付→③商談→④製造・請求→その他)。**href は 1 つも変えない** — ラベル・
 * グループ名・順序・フェーズ番号のみ変更し、全ルートのナビ到達可能性を維持する。
 * content 系 5 項目 (works/posts/voices/media/visual) は R5 で「ホームページ更新」
 * 1 項目 (5 タブ) へ統合するまで「①お客さんを作る」配下に暫定残置する。
 *
 * 今後 nav-items を追加する場合は該当グループの items 配下へ追加すること (フラットな
 * 配列への直接追加は不可。裁定 J14 — docs/design/crm-suite/00-overview.md §2.4)。
 */
export type AdminNavItem = { readonly href: string; readonly label: string };

export type AdminNavGroup = {
  /**
   * 折りたたみ状態の localStorage 永続化キー (kumabe-admin-nav-collapsed:v2 の
   * JSON 配列要素)。グループ間で一意。label:null のグループ (今日の仕事) は
   * 折りたたみ UI を持たないため実質未使用だが、一意性検証の対象にするため付与する。
   */
  readonly id: string;
  /** null = グループ外の単独項目 (今日の仕事)。見出し・折りたたみを持たない。 */
  readonly label: string | null;
  /**
   * 業務フェーズ番号 (①〜④)。表示時はグループ見出しラベルの先頭へ付与する。
   * 番号を分離して保持することで、将来の「番号を非表示にする」切替を
   * ラベル文字列の編集なしで実装できる (設計書 §3.2)。番号を持たないグループ
   * (今日の仕事・その他) では省略する。
   */
  readonly phaseNo?: string;
  readonly items: readonly AdminNavItem[];
};

// 明示的に readonly AdminNavGroup[] 型を付与する (as const のみだとグループごとに
// items のタプル型が異なり、TS の flatMap 型推論が最初のグループの要素型のみを
// 採用してしまい、他グループの item (href/label) を型エラーにする既知の制約への対処)。
export const ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = [
  {
    id: "dashboard",
    label: null,
    items: [{ href: "/admin", label: "今日の仕事" }],
  },
  {
    id: "create-customers",
    label: "お客さんを作る",
    phaseNo: "①",
    // content 系 5 項目 (works/posts/voices/media/visual) は R5 で
    // 「ホームページ更新」1 項目 (5 タブ) へ統合するまで暫定残置する。
    items: [
      { href: "/admin/works", label: "施工事例" },
      { href: "/admin/posts", label: "記事" },
      { href: "/admin/voices", label: "お客様の声" },
      { href: "/admin/media", label: "メディア" },
      { href: "/admin/visual", label: "ビジュアル編集" },
      { href: "/admin/studio", label: "発信スタジオ" },
      { href: "/admin/channels", label: "SNSの接続" },
    ],
  },
  {
    id: "intake",
    label: "受付",
    phaseNo: "②",
    items: [
      { href: "/admin/inquiries", label: "問い合わせ" },
      { href: "/admin/calls", label: "通話" },
    ],
  },
  {
    id: "sales",
    label: "商談",
    phaseNo: "③",
    items: [
      { href: "/admin/customers", label: "顧客" },
      { href: "/admin/deals", label: "案件" },
      { href: "/admin/tasks", label: "やること" },
    ],
  },
  {
    id: "production",
    label: "製造・請求",
    phaseNo: "④",
    items: [
      { href: "/admin/documents", label: "見積書・請求書" },
      { href: "/admin/calendar", label: "カレンダー" },
    ],
  },
  {
    id: "misc",
    label: "その他",
    items: [
      { href: "/admin/prices", label: "価格表" },
      { href: "/admin/settings", label: "設定" },
      { href: "/admin/costs", label: "AI利用料金" },
    ],
  },
] as const;

// 後方互換の derived export (J11 以降の設計書が「ADMIN_NAV_ITEMS へ追加」と
// 記述しているため残す)。
export const ADMIN_NAV_ITEMS = ADMIN_NAV_GROUPS.flatMap((g) => g.items);
