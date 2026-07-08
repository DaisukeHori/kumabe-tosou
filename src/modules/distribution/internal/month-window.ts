const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 「当月」の解釈 (JST) を UTC ISO の [開始, 終了) 範囲で返す (設計書 §2.4: 表示・解釈は Asia/Tokyo)。
 * 課金ガード (§8.2) の対象は scheduled_at がこの範囲に入る channel_posts。
 */
export function currentJstMonthRangeUtc(now: Date = new Date()): { startUtc: string; endUtc: string } {
  const jstNow = new Date(now.getTime() + JST_OFFSET_MS);
  const y = jstNow.getUTCFullYear();
  const m = jstNow.getUTCMonth();
  const startJst = Date.UTC(y, m, 1, 0, 0, 0);
  const endJst = Date.UTC(y, m + 1, 1, 0, 0, 0);
  return {
    startUtc: new Date(startJst - JST_OFFSET_MS).toISOString(),
    endUtc: new Date(endJst - JST_OFFSET_MS).toISOString(),
  };
}
