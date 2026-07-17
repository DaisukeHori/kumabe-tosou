/**
 * admin 一覧・詳細で timestamptz (UTC ISO) を JST 表示するための「決定的」整形ヘルパ。
 *
 * これらは `"use client"` コンポーネント内でも初期 HTML は SSR される。素の
 * `new Date(iso).toLocaleString("ja-JP")` は `timeZone` 未指定だと実行環境の TZ に依存し
 * (Vercel サーバ = UTC / ブラウザ = JST)、SSR とクライアントで生成文字列がずれて
 * hydration mismatch (Minified React error #418) を引き起こす。
 *
 * 実装方針は crm/internal/jst.ts・calendar/_ui/jst-time.ts と同一 —
 * UTC エポックに +9h した「ずらし時刻」の UTC 成分を読む純粋な数値計算 — で、
 * TZ・ロケール・ICU バージョンに一切依存しない決定的な文字列を生成する
 * (`suppressHydrationWarning` による握り潰しではなく、値そのものを一致させる)。
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** iso (UTC timestamptz) を JST の {年,月,日,時,分} 成分に分解 (getUTC* で JST 暦時刻を読む) */
function jstParts(iso: string): { y: number; mo: number; d: number; h: number; mi: number } {
  const shifted = new Date(new Date(iso).getTime() + JST_OFFSET_MS);
  return {
    y: shifted.getUTCFullYear(),
    mo: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    h: shifted.getUTCHours(),
    mi: shifted.getUTCMinutes(),
  };
}

/** iso を JST の「YYYY/MM/DD」で決定的に整形 (一覧の日付列など) */
export function formatJstDate(iso: string): string {
  const { y, mo, d } = jstParts(iso);
  return `${y}/${pad2(mo)}/${pad2(d)}`;
}

/** iso を JST の「YYYY/MM/DD HH:MM」で決定的に整形 (更新日時列など) */
export function formatJstDateTime(iso: string): string {
  const { y, mo, d, h, mi } = jstParts(iso);
  return `${y}/${pad2(mo)}/${pad2(d)} ${pad2(h)}:${pad2(mi)}`;
}
