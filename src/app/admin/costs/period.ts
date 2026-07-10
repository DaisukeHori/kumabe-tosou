/**
 * /admin/costs (設計書 §9) の期間解決 (純関数)。
 * UTC 基準で [from, to) の半開区間を返す (to は排他的な翌日 0 時)。
 * facade.getUsageSummary({ from, to }) → repository の
 * `.gte("created_at", from).lt("created_at", to)` にそのまま渡せる YYYY-MM-DD 文字列。
 */

export type PeriodKey = "this_month" | "last_month" | "last_30d";

export const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: "this_month", label: "今月" },
  { key: "last_month", label: "先月" },
  { key: "last_30d", label: "30日" },
];

export function isPeriodKey(value: string | undefined): value is PeriodKey {
  return value === "this_month" || value === "last_month" || value === "last_30d";
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 直近 30 日 (当日を含め過去29日 + 当日 = 30 日分) の [from, to) を返す。日別棒グラフは常にこれを使う。 */
export function last30DaysRange(now: Date): { from: string; to: string } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const date = now.getUTCDate();
  const to = new Date(Date.UTC(year, month, date + 1));
  const from = new Date(Date.UTC(year, month, date - 29));
  return { from: toDateStr(from), to: toDateStr(to) };
}

/** 内訳テーブルの期間切替 (今月/先月/30日) を [from, to) に解決する。 */
export function resolvePeriodRange(period: PeriodKey, now: Date): { from: string; to: string } {
  if (period === "last_30d") return last30DaysRange(now);

  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  if (period === "this_month") {
    const from = new Date(Date.UTC(year, month, 1));
    const to = new Date(Date.UTC(year, month + 1, 1));
    return { from: toDateStr(from), to: toDateStr(to) };
  }

  // last_month (Date.UTC は月のアンダーフローを年繰り下げで自動処理する — 1月なら前年12月になる)
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  return { from: toDateStr(from), to: toDateStr(to) };
}
