import type { SettingsValue } from "@/modules/settings/contracts";

/**
 * JST 営業時間判定 (純関数。canonical: docs/design/crm-suite/04-telephony.md §6.2 末尾)。
 * settings 所有の `zBusinessHoursSettings` 型をそのまま受け取る (telephony → settings の
 * read 依存 — 07-contracts-delta §D2 Δ1)。DB/env には一切触れない (単体テスト対象)。
 */
export type BusinessHoursSettings = SettingsValue<"business_hours">;

type DayKey = Exclude<keyof BusinessHoursSettings, "holidays">;

const JST_TIME_ZONE = "Asia/Tokyo";

const WEEKDAY_KEY_BY_SHORT: Record<string, DayKey> = {
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
  Sun: "sun",
};

/**
 * 手順 (§6.2 末尾):
 * 1. now を Asia/Tokyo へ変換 (Intl.DateTimeFormat ベース。ライブラリ追加なし)
 * 2. holidays (zDateOnly 配列) に当日 (JST) が含まれる → 時間外
 * 3. 当曜日の zDayHours が null → 終日休み → 時間外
 * 4. open <= HH:MM < close (半開区間。文字列比較で安全 — "09:00" 形式は辞書順=時刻順)
 *    open > close (深夜跨ぎ) は表現不能のため時間外に倒す (zBusinessHoursSettings の
 *    refine で通常は保存不可だが、防御的に判定する)
 * 5. business_hours 未設定時の degrade (常に時間内) は呼び出し元 (facade) の責務
 *    (本関数は settings が渡された前提の純粋計算のみ)
 *
 * 境界規約: open ちょうどは時間内、close ちょうどは時間外 ([open, close) 半開区間)。
 */
export function isWithinBusinessHours(now: Date, settings: BusinessHoursSettings): boolean {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: JST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23", // hour12 ではなく hourCycle を使う (h23 でないと深夜 0 時が "24" になる実装差異がある)
    weekday: "short",
  });

  const byType: Record<string, string> = {};
  for (const part of formatter.formatToParts(now)) {
    byType[part.type] = part.value;
  }

  const jstDate = `${byType.year}-${byType.month}-${byType.day}`;
  const jstTime = `${byType.hour}:${byType.minute}`;
  const dayKey = WEEKDAY_KEY_BY_SHORT[byType.weekday];

  if (settings.holidays.includes(jstDate)) return false;
  if (!dayKey) return false; // 防御的 (Intl の weekday 値は仕様上固定のため実運用では発生しない

  const hours = settings[dayKey];
  if (!hours) return false; // 終日休み

  if (hours.open >= hours.close) return false; // 深夜跨ぎ非対応 → 時間外に倒す (防御的)

  return hours.open <= jstTime && jstTime < hours.close;
}
