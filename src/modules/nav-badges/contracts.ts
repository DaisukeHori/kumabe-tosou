import type { Result } from "@/modules/platform/contracts";

/**
 * nav-badges モジュール契約 — 管理サイドナビの「未対応件数バッジ」(R6c / #129)。
 *
 * canonical: docs/design/admin-redesign/移行設計.md §4 (P6 6c 行)・§6。
 *
 * 本モジュールは「管理ナビ表示用の読み取り専用横断集計」だけを責務に持つ、リデザイン全体で
 * **唯一の facade 追加例外** (§6)。3 種の未対応件数を 1 回の facade 呼び出しで束ねて返し、
 * 集計失敗/タイムアウト時は `Result.ok=false` (新エラーコード帯 0xx) を返して UI 側で
 * 「バッジ非表示」に縮退させる (レイアウトを壊さない)。
 *
 * 集計はいずれも DB 側 count (`head:true` + `count:"exact"`) で行い、行データは引かない
 * (repository.ts 参照)。フィルタは既存 facade の同種集計と完全一致させ、バッジ件数が
 * ダッシュボード/各一覧と食い違わないようにする:
 *   - inquiries: `inquiryFacade.countByStatus('new')` と同じ `contact_inquiries.status='new'`
 *   - calls:     `telephonyFacade.getCallAlertCounts().needsReview` と同じ `calls.match_status='ambiguous'`
 *   - tasks:     `crm/repository.ts countTasksInRange` と同じクエリ形の `tasks.status='open'`
 *                かつ `due_on <= JST今日` (= 期限超過 + 本日期限)。範囲が `<= today` である点に注意 —
 *                ダッシュボードの overdue 集計 (`getDashboardKpi()`, `due_on < today`) とは
 *                本日期限ぶんだけ件数が異なる (同型ではない)。
 */

/** 3 種のナビバッジ件数 (すべて 0 以上。0 件は UI 側で非表示 — admin-nav.tsx NavLink)。 */
export type NavBadgeCounts = {
  /** 未対応の問い合わせ件数 (contact_inquiries.status='new')。→ ナビ項目 /admin/inquiries */
  inquiries: number;
  /** 要対応 (要レビュー) の通話件数 (calls.match_status='ambiguous')。→ ナビ項目 /admin/calls */
  calls: number;
  /** 期限超過/本日期限のやること件数 (tasks.status='open' かつ due_on <= JST今日)。→ ナビ項目 /admin/tasks */
  tasks: number;
};

/**
 * 集計の性能予算 (ミリ秒)。この facade は admin レイアウト (Server Component) の毎リクエスト
 * 描画に乗る (= 全 admin ページのレイテンシに加算される) ため、上限を超えた場合は集計失敗
 * (KMB-E002) として扱い、バッジ非表示に縮退させてレイアウト描画をこれ以上ブロックしない。
 * 「数百 ms 級」(#129 実装方針) の上限として 800ms を採る。
 */
export const NAV_BADGE_TIMEOUT_MS = 800;

/**
 * NavBadgeCounts の各フィールド → 対応するナビ項目 href の対応表。バッジ件数の宛先 href の
 * **唯一の真実源**で、admin/layout.tsx がこの表を使って facade の集計結果を
 * `href → 件数` の record へ写す (UI (admin-nav.tsx) は href で件数を引く)。値は
 * nav-items.ts の該当ルートと一致する (tests/admin-nav-groups.test.ts で不変を固定)。
 */
export const NAV_BADGE_HREFS = {
  inquiries: "/admin/inquiries",
  calls: "/admin/calls",
  tasks: "/admin/tasks",
} as const;

export interface NavBadgesFacade {
  /**
   * 3 種の未対応件数を 1 回で集計して返す。認可 (admin) は内部で行い、非認可/未認証は
   * KMB-E201/E202 を返す。DB 障害・部分失敗は KMB-E001、タイムアウトは KMB-E002 を返す
   * (いずれも呼び出し側でバッジ非表示に縮退させる想定 — レイアウト描画は継続する)。
   */
  getNavBadgeCounts(): Promise<Result<NavBadgeCounts>>;
}
