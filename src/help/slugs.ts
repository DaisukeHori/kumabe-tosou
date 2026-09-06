/**
 * 管理画面のパス → ヘルプ slug の対応 (純関数)。
 * canonical: docs/design/admin-help/README.md §6 の「対象ページ一覧」。
 *
 * 一覧 / 新規作成 / 詳細 は 1 つの slug にまとめる (ヘルプ内で節を分ける)。
 * 新しい管理画面ページを追加したら、ここに 1 行足す
 * (tests/help-slugs.test.ts が app ディレクトリを走査して未対応を検出する)。
 */

export const HELP_SLUGS = [
  "dashboard",
  "works",
  "posts",
  "voices",
  "media",
  "visual",
  "studio",
  "channels",
  "inquiries",
  "calls",
  "customers",
  "deals",
  "tasks",
  "documents",
  "calendar",
  "calendar-connections",
  "calendar-templates",
  "calendar-types",
  "prices",
  "settings",
  "costs",
  "login",
] as const;

export type HelpSlug = (typeof HELP_SLUGS)[number];

export function isHelpSlug(value: string): value is HelpSlug {
  return (HELP_SLUGS as readonly string[]).includes(value);
}

/** slug ごとのタイトルと代表 URL (ヘルプ画面の見出し・目次で使う)。 */
export const HELP_SLUG_META: Record<HelpSlug, { title: string; adminPath: string }> = {
  dashboard: { title: "今日の仕事", adminPath: "/admin" },
  works: { title: "ホームページ更新 — 施工事例", adminPath: "/admin/works" },
  posts: { title: "ホームページ更新 — 記事 (ブログ・読みもの)", adminPath: "/admin/posts" },
  voices: { title: "ホームページ更新 — お客様の声", adminPath: "/admin/voices" },
  media: { title: "ホームページ更新 — 画像", adminPath: "/admin/media" },
  visual: { title: "ホームページ更新 — 見た目と文章の編集", adminPath: "/admin/visual" },
  studio: { title: "発信スタジオ (音声から記事・投稿を作る)", adminPath: "/admin/studio" },
  channels: { title: "SNS の接続と配信", adminPath: "/admin/channels" },
  inquiries: { title: "問い合わせ", adminPath: "/admin/inquiries" },
  calls: { title: "通話 (着信・留守電・文字起こし)", adminPath: "/admin/calls" },
  customers: { title: "顧客", adminPath: "/admin/customers" },
  deals: { title: "案件", adminPath: "/admin/deals" },
  tasks: { title: "やること", adminPath: "/admin/tasks" },
  documents: { title: "見積書・請求書", adminPath: "/admin/documents" },
  calendar: { title: "カレンダー (作業予定)", adminPath: "/admin/calendar" },
  "calendar-connections": {
    title: "カレンダー — 外部連携 (Google / Microsoft)",
    adminPath: "/admin/calendar/connections",
  },
  "calendar-templates": { title: "カレンダー — テンプレート", adminPath: "/admin/calendar/templates" },
  "calendar-types": { title: "カレンダー — 作業種別", adminPath: "/admin/calendar/types" },
  prices: { title: "価格表", adminPath: "/admin/prices" },
  settings: { title: "設定", adminPath: "/admin/settings" },
  costs: { title: "AI 利用料金", adminPath: "/admin/costs" },
  login: { title: "ログイン", adminPath: "/admin/login" },
};

/**
 * /admin/<先頭セグメント> → slug。
 * 一覧・new・[id] はすべて同じ slug に寄せるため、先頭セグメントだけで決まる
 * (calendar だけは配下に別ページがあるので resolveHelpSlug 内で個別に処理する)。
 */
const SECTION_SLUGS: Record<string, HelpSlug> = {
  works: "works",
  posts: "posts",
  voices: "voices",
  media: "media",
  visual: "visual",
  studio: "studio",
  channels: "channels",
  inquiries: "inquiries",
  calls: "calls",
  customers: "customers",
  deals: "deals",
  tasks: "tasks",
  documents: "documents",
  prices: "prices",
  settings: "settings",
  costs: "costs",
  login: "login",
};

/** /admin/calendar 配下の 2 番目のセグメント → slug。 */
const CALENDAR_SUB_SLUGS: Record<string, HelpSlug> = {
  connections: "calendar-connections",
  templates: "calendar-templates",
  types: "calendar-types",
};

/**
 * 現在のパスに対応するヘルプ slug を返す。対応が無ければ null
 * (呼び出し側の HelpButton は null のときボタンを出さない)。
 */
export function resolveHelpSlug(pathname: string | null | undefined): HelpSlug | null {
  if (!pathname) return null;
  // クエリ・ハッシュ・末尾スラッシュを落として比較する。
  const path = pathname.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  if (path === "/admin") return "dashboard";
  if (!path.startsWith("/admin/")) return null;

  const segments = path.slice("/admin/".length).split("/").filter(Boolean);
  const [head, second] = segments;
  if (!head) return "dashboard";

  if (head === "calendar") {
    if (!second) return "calendar";
    return CALENDAR_SUB_SLUGS[second] ?? null;
  }

  return SECTION_SLUGS[head] ?? null;
}

/** ヘルプ画面 (/help/<slug>) の URL。 */
export function helpHref(slug: HelpSlug): string {
  return `/help/${slug}`;
}
