/**
 * legacy/js/main.js:197-210「7) カラーストリップのホイール横変換」の判定部。
 * 縦優勢のホイール入力を横スクロール量へ変換する。ストリップが端に達している
 * 方向への入力は null を返し、preventDefault せずページの縦スクロールへ抜く。
 * DOM 非依存の純関数 (vitest node 環境で直接テストする)。
 */
export function resolveStripWheel(input: {
  deltaX: number;
  deltaY: number;
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}): number | null {
  const { deltaX, deltaY, scrollLeft, clientWidth, scrollWidth } = input;
  // 旧実装は厳密に |deltaY| > |deltaX| (等値は変換しない)
  if (Math.abs(deltaY) <= Math.abs(deltaX)) return null;
  const atStart = scrollLeft <= 0 && deltaY < 0;
  const atEnd = scrollLeft + clientWidth >= scrollWidth - 1 && deltaY > 0;
  if (atStart || atEnd) return null;
  return deltaY;
}
