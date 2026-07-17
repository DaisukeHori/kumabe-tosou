import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Result } from "@/modules/platform/contracts";
import type { KmbErrorCode } from "@/modules/platform/errors";

/**
 * nav-badges モジュール repository (R6c / #129)。管理ナビの未対応件数バッジ用の
 * **読み取り専用 count 集計**だけを行う。
 *
 * 【モジュール境界の唯一の例外 — 移行設計.md §6】通常 `contact_inquiries` (inquiry 所有)・
 * `calls` (telephony 所有)・`tasks` (crm 所有) への直接クエリは各所有モジュールの repository
 * のみに許されるが (module-contracts.md §1)、本モジュールはリデザインで唯一許可された
 * 横断集計 facade であり、その実データ源として**行を引かない count のみ**をこの 3 テーブルへ
 * 発行する。書き込み・行取得は一切行わない (集計以外の用途が生じたら所有モジュール facade
 * 経由へ戻すこと)。フィルタ条件は各所有モジュールの既存集計 (inquiry.countInquiriesByStatus /
 * telephony.countAmbiguousCalls / crm.countTasksInRange) と 1:1 で一致させ、バッジ件数が
 * 既存のダッシュボード/一覧と食い違わないようにしている。
 *
 * client は facade が admin セッション確認済みの server client を渡す (RLS が admin 限定の
 * calls 等でも正しく count が返る)。DB エラーは握り潰さず KMB-E001 として Result で伝播する。
 */

type PgError = { code?: string; message: string };

/** count クエリの DB エラーを nav-badges 帯 (0xx) の KMB-E001 に写像する。 */
function toAggregateError(error: PgError, label: string): { ok: false; code: KmbErrorCode; detail: string } {
  return { ok: false, code: "KMB-E001", detail: `${label}: ${error.message}` };
}

/**
 * 未対応の問い合わせ件数 (contact_inquiries.status='new')。
 * inquiry/repository.ts countInquiriesByStatus('new') と同一条件。
 */
export async function countUnhandledInquiries(client: SupabaseClient): Promise<Result<number>> {
  const { count, error } = await client
    .from("contact_inquiries")
    .select("id", { count: "exact", head: true })
    .eq("status", "new");
  if (error) return toAggregateError(error, "未対応の問い合わせ件数の取得に失敗しました");
  return { ok: true, value: count ?? 0 };
}

/**
 * 要対応 (要レビュー) の通話件数 (calls.match_status='ambiguous')。
 * telephony/repository.ts countAmbiguousCalls (= getCallAlertCounts().needsReview) と同一条件。
 */
export async function countReviewCalls(client: SupabaseClient): Promise<Result<number>> {
  const { count, error } = await client
    .from("calls")
    .select("id", { count: "exact", head: true })
    .eq("match_status", "ambiguous");
  if (error) return toAggregateError(error, "要対応の通話件数の取得に失敗しました");
  return { ok: true, value: count ?? 0 };
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * JST の「今日」を YYYY-MM-DD で返す。crm/internal/jst.ts の jstTodayDateOnly と同型
 * (Date.getTime() に +9h した「ずらし時刻」の UTC 日付成分を読む純粋計算)。crm/internal は
 * モジュール境界 (ESLint) により本モジュールから import できないため、telephony が CAS 実装を
 * 複製しているのと同じ確立済みの理由で、この極小ヘルパをここに複製する。
 */
export function jstTodayDateOnly(now: Date = new Date()): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 期限超過/本日期限のやること件数 (tasks.status='open' かつ due_on <= JST今日)。
 * `due_on <= 今日` は「期限超過 (due_on < 今日)」+「本日期限 (due_on = 今日)」を含み、
 * due_on が NULL の行は比較が NULL となり自然に除外される (crm/repository.ts countTasksInRange
 * と同じクエリ形の date-only 文字列比較)。範囲が `<= today` である点に注意 — ダッシュボードの
 * overdue 集計 (getDashboardKpi, `due_on < today`) とは本日期限ぶんだけ件数が異なる (同型ではない)。
 * JST 境界は呼び出し時刻から算出する。
 */
export async function countDueOrOverdueTasks(
  client: SupabaseClient,
  now: Date = new Date(),
): Promise<Result<number>> {
  const today = jstTodayDateOnly(now);
  const { count, error } = await client
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("status", "open")
    .lte("due_on", today);
  if (error) return toAggregateError(error, "やること件数の取得に失敗しました");
  return { ok: true, value: count ?? 0 };
}
