/**
 * Asia/Tokyo (JST, UTC+9, 夏時間なし) の日付境界ヘルパ。
 * canonical: docs/design/crm-suite/01-crm.md §2.5・§11.2。
 *
 * 実装方針: `Date.getTime()` に 9 時間を加算した「ずらし時刻」の UTC 成分を読むことで、
 * タイムゾーン非依存に JST のカレンダー日付/曜日を導出する (Intl.DateTimeFormat 不要の
 * 純粋な数値計算 — テスト容易性のため)。tasks.due_on (date 型) は JST の暦日そのものであり、
 * timestamptz からの変換ではない点に注意 (01-crm §4.3 注記) — 本ファイルの `dueOn` を扱う関数は
 * date-only 文字列同士の比較のみを行い、timestamptz 変換を経由しない。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function toJstShifted(now: Date): Date {
  return new Date(now.getTime() + JST_OFFSET_MS);
}

/** JST の「今日」を YYYY-MM-DD (zDateOnly 形式) で返す */
export function jstTodayDateOnly(now: Date = new Date()): string {
  return toJstShifted(now).toISOString().slice(0, 10);
}

/** JST 月曜起点の「今週」範囲 (月曜〜日曜、両端含む) を YYYY-MM-DD で返す */
export function jstWeekRange(now: Date = new Date()): { from: string; to: string } {
  const shifted = toJstShifted(now);
  const dow = shifted.getUTCDay(); // 0=日 .. 6=土 (ずらし時刻の UTC 成分 = JST の暦日)
  const diffToMonday = dow === 0 ? -6 : 1 - dow;

  const monday = new Date(shifted);
  monday.setUTCDate(monday.getUTCDate() + diffToMonday);
  monday.setUTCHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}

/** due_on (date-only 文字列、null 可) が JST 今日より過去なら true (§4.3: due_on < JST 今日) */
export function isOverdueJst(dueOn: string | null, now: Date = new Date()): boolean {
  if (dueOn === null) return false;
  return dueOn < jstTodayDateOnly(now);
}

/** due_on が JST 今日と一致するか */
export function isDueTodayJst(dueOn: string | null, now: Date = new Date()): boolean {
  if (dueOn === null) return false;
  return dueOn === jstTodayDateOnly(now);
}

/** due_on が JST 今週 (月曜起点、両端含む) 内か */
export function isDueThisWeekJst(dueOn: string | null, now: Date = new Date()): boolean {
  if (dueOn === null) return false;
  const { from, to } = jstWeekRange(now);
  return dueOn >= from && dueOn <= to;
}

/** JST 翌日 (due_on 既定値算出 — §6.5 手順 5 の折り返しタスク due_on) */
export function jstTomorrowDateOnly(now: Date = new Date()): string {
  const shifted = toJstShifted(now);
  shifted.setUTCDate(shifted.getUTCDate() + 1);
  return shifted.toISOString().slice(0, 10);
}
