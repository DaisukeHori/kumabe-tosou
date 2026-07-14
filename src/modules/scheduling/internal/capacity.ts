/**
 * 週間キャパシティ計算 (canonical: docs/design/crm-suite/03-scheduling.md §7.2)。
 * DB 非依存の純関数のみ。JST (Asia/Tokyo, 常に UTC+9・DST なし) 変換はこのファイルの
 * resolveWeekRangeJst() / isJstMonday() の 2 箇所に閉じ込める (§7.2「Asia/Tokyo 変換は
 * コード側 1 箇所」の指示)。
 */

import type { WeeklyCapacity } from "../contracts";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * weekStart (zDateOnly, JST カレンダー日) が JST の月曜日かどうかを判定する。
 * カレンダー日付の曜日はタイムゾーンに依存しない (「2026-07-13」はどの経度で見ても月曜日) ため、
 * UTC 深夜 0 時としてパースして getUTCDay() で判定してよい (これは JST 判定ではなく、
 * 純粋にカレンダー日の曜日判定であることに注意 — resolveWeekRangeJst の JST→UTC 変換とは別の話)。
 */
export function isJstMonday(dateOnly: string): boolean {
  const ms = Date.parse(`${dateOnly}T00:00:00Z`);
  if (Number.isNaN(ms)) return false;
  return new Date(ms).getUTCDay() === 1;
}

/**
 * weekStart (JST 月曜 00:00 のカレンダー日) を UTC ISO の範囲 [startUtc, endUtc) に変換する。
 * JST 00:00 = UTC (前日) 15:00 (UTC+9 固定オフセット、DST なし)。
 * 月曜以外の入力を弾く責務は呼び出し元 (facade が Zod + isJstMonday で KMB-E101) にあり、
 * この関数自体は非月曜を渡されても機械的に 7 日後を返すだけ (§7.2 の指示どおり)。
 */
export function resolveWeekRangeJst(weekStart: string): { startUtc: string; endUtc: string } {
  // タイムゾーン付き ISO 文字列 (+09:00) は Date.parse がオフセット解決込みで UTC ms を返すため、
  // 追加のオフセット演算は不要 — 「+09:00」の指定自体が JST→UTC 変換そのもの。
  const startMs = new Date(`${weekStart}T00:00:00+09:00`).getTime();
  const endMs = startMs + 7 * DAY_MS;
  return { startUtc: new Date(startMs).toISOString(), endUtc: new Date(endMs).toISOString() };
}

/**
 * booked_hours = Σ planned_hours (§7.2 — 配置スパンではなく工数の合算)。
 * 「consumes_capacity=true and status in ('scheduled','in_progress','done') and
 * starts_at ∈ [week_start, week_end)」の絞り込みは repository のクエリ側の責務であり、
 * この関数は「絞り込み済みの配列を合算するだけ」の薄い関数にする (§7.2 の指示 — テストしやすさのため)。
 * week_start は呼び出し元 (facade) が既に保持している入力値をそのまま WeeklyCapacity に
 * 合成するため、ここでは受け取らない (実装計画書の関数シグネチャどおり)。
 */
export function computeWeeklyCapacity(
  weeklyHours: number,
  bookedBlocks: ReadonlyArray<{ planned_hours: number }>,
): Omit<WeeklyCapacity, "week_start"> {
  const bookedHours = bookedBlocks.reduce((sum, b) => sum + b.planned_hours, 0);
  return {
    weekly_hours: weeklyHours,
    booked_hours: bookedHours,
    remaining_hours: weeklyHours - bookedHours, // 負値許容 (P27)
  };
}
