/**
 * /admin/calendar 画面専用の JST 日時ユーティリティ (UI 層限定)。
 *
 * scheduling/internal/capacity.ts や auto-place.ts と発想は同じ (JST は UTC+9 固定オフセット・
 * DST なしのため ms 加減算で厳密に正しい) だが、ESLint MODULES (モジュール境界) が
 * `scheduling/internal/*` の app 層からの直 import を禁止しているため、UI 表示・グリッド座標
 * 計算専用にここへ複製する。業務ロジック (状態遷移・キャパ計算・自動配置) は一切持たない
 * (=純粋な表示/座標変換ヘルパーであり、internal/ の複製ではなく別関心事)。
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const JST_OFFSET_MS = 9 * HOUR_MS;

export type DateOnly = string; // YYYY-MM-DD (JST カレンダー日)

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** iso (UTC timestamptz) → JST 実時刻を表す Date (getUTC* で JST の年月日時分を読める) */
export function isoToJstShifted(iso: string): Date {
  return new Date(new Date(iso).getTime() + JST_OFFSET_MS);
}

/** JST 実時刻の Date (isoToJstShifted の逆変換) → ISO (UTC) */
function jstShiftedToIso(shifted: Date): string {
  return new Date(shifted.getTime() - JST_OFFSET_MS).toISOString();
}

/** 今日の JST カレンダー日 (YYYY-MM-DD) */
export function todayJstDateOnly(): DateOnly {
  const shifted = isoToJstShifted(new Date().toISOString());
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/** dateOnly (JST カレンダー日) → 曜日 (0=日 … 6=土)。タイムゾーンに依存しない (カレンダー日の曜日) */
export function jstWeekday(dateOnly: DateOnly): number {
  return new Date(`${dateOnly}T00:00:00Z`).getUTCDay();
}

/** dateOnly が JST の月曜日かどうか */
export function isJstMondayDateOnly(dateOnly: DateOnly): boolean {
  return jstWeekday(dateOnly) === 1;
}

/** dateOnly (JST カレンダー日) を含む週の月曜日 (JST) を返す */
export function mondayOfWeekJst(dateOnly: DateOnly): DateOnly {
  const weekday = jstWeekday(dateOnly); // 0=日
  const diffToMonday = weekday === 0 ? -6 : 1 - weekday;
  return addDaysJst(dateOnly, diffToMonday);
}

/** dateOnly (JST カレンダー日) に n 日足す (負数可) */
export function addDaysJst(dateOnly: DateOnly, days: number): DateOnly {
  const ms = Date.parse(`${dateOnly}T00:00:00Z`) + days * DAY_MS;
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** JST 月曜 00:00 (dateOnly) を起点に [startIso, endIso) の週範囲 (UTC ISO) を返す */
export function weekRangeIso(mondayDateOnly: DateOnly): { fromIso: string; toIso: string } {
  const startMs = new Date(`${mondayDateOnly}T00:00:00+09:00`).getTime();
  return {
    fromIso: new Date(startMs).toISOString(),
    toIso: new Date(startMs + 7 * DAY_MS).toISOString(),
  };
}

/** JST カレンダー月 (dateOnly が属する月) の 1 日〜翌月 1 日前日までの範囲 (UTC ISO)。月表示グリッド用 */
export function monthRangeIso(dateOnly: DateOnly): { fromIso: string; toIso: string; monthStart: DateOnly } {
  const [y, m] = dateOnly.split("-").map(Number);
  const monthStart = `${y}-${pad2(m)}-01`;
  const startMs = new Date(`${monthStart}T00:00:00+09:00`).getTime();
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${pad2(m + 1)}-01`;
  const endMs = new Date(`${nextMonth}T00:00:00+09:00`).getTime();
  return { fromIso: new Date(startMs).toISOString(), toIso: new Date(endMs).toISOString(), monthStart };
}

/** 月ビュー用の 6 週 (42 セル) グリッド。1 日を含む週の月曜始まり、前後月の日も埋めて返す */
export function monthGridDays(dateOnly: DateOnly): DateOnly[] {
  const { monthStart } = monthRangeIso(dateOnly);
  const gridStart = mondayOfWeekJst(monthStart);
  return Array.from({ length: 42 }, (_, i) => addDaysJst(gridStart, i));
}

/** dateOnly が dateOnly が属する月 (基準月) と同じ月かどうか (前後月の薄字表示判定用) */
export function isSameJstMonth(dateOnly: DateOnly, monthAnchor: DateOnly): boolean {
  return dateOnly.slice(0, 7) === monthAnchor.slice(0, 7);
}

/** dateOnly (JST) + 時:分 → ISO (UTC) */
export function jstDateTimeToIso(dateOnly: DateOnly, hour: number, minute: number): string {
  const ms = new Date(`${dateOnly}T00:00:00+09:00`).getTime() + hour * HOUR_MS + minute * 60_000;
  return new Date(ms).toISOString();
}

/** iso → { dateOnly, hour, minute } (JST 表示用の分解) */
export function isoToJstParts(iso: string): { dateOnly: DateOnly; hour: number; minute: number } {
  const shifted = isoToJstShifted(iso);
  return {
    dateOnly: `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`,
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/** iso を「HH:MM」(JST) で表示 */
export function formatJstTime(iso: string): string {
  const { hour, minute } = isoToJstParts(iso);
  return `${pad2(hour)}:${pad2(minute)}`;
}

/** iso を「M/D (曜)」(JST) で表示 */
const WEEKDAY_LABEL = ["日", "月", "火", "水", "木", "金", "土"];
export function formatJstDateLabel(iso: string): string {
  const { dateOnly } = isoToJstParts(iso);
  const [, m, d] = dateOnly.split("-").map(Number);
  return `${m}/${d} (${WEEKDAY_LABEL[jstWeekday(dateOnly)]})`;
}

export function formatDateOnlyLabel(dateOnly: DateOnly): string {
  const [, m, d] = dateOnly.split("-").map(Number);
  return `${m}/${d} (${WEEKDAY_LABEL[jstWeekday(dateOnly)]})`;
}

/** iso の分数 (0 分起点からの経過分、JST) を返す (グリッド座標計算用) */
export function jstMinutesOfDay(iso: string): number {
  const { hour, minute } = isoToJstParts(iso);
  return hour * 60 + minute;
}

/** starts_at ISO の JST 日付が dateOnly と一致するか */
export function isOnJstDate(iso: string, dateOnly: DateOnly): boolean {
  return isoToJstParts(iso).dateOnly === dateOnly;
}

/** 30 分スナップ (分単位切り捨て) */
export function snapDownToHalfHour(minutesOfDay: number): number {
  return Math.floor(minutesOfDay / 30) * 30;
}

/** 日内分数 (0〜1440) を「HH:MM」で表示 (空白ドラッグ作成 #95 のプレビューラベル・初期値受け渡し用) */
export function minutesToHHMM(minutesOfDay: number): string {
  const h = Math.floor(minutesOfDay / 60);
  const m = minutesOfDay % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

export function isoPlusMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

export function isoPlusHours(iso: string, hours: number): string {
  return isoPlusMinutes(iso, Math.round(hours * 60));
}

export { jstShiftedToIso };
