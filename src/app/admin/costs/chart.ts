import type { Provider } from "@/modules/ai-providers/contracts";

/**
 * /admin/costs (設計書 §9) の日別積み上げ棒グラフ — 座標計算のみを行う純関数。
 * recharts 等の依存を追加せず SVG を自作するため (§9)、DOM/React に一切触れない
 * ここで座標を計算し、コンポーネント側は計算結果をそのまま <rect> に流すだけにする
 * (テスト容易性のため、座標計算とレンダリングを分離する)。
 */

export type StackedBarSegmentInput = { provider: Provider; value: number };
export type StackedBarInput = { date: string; segments: StackedBarSegmentInput[] };

export type BarSegmentRect = {
  provider: Provider;
  value: number; // 元の値 (µUSD 等、単位は呼び出し側に委ねる) — ツールチップ表示用にそのまま通す
  x: number;
  y: number;
  width: number;
  height: number;
};
export type BarLayout = { date: string; x: number; barWidth: number; segments: BarSegmentRect[] };

export type StackedBarChartLayout = {
  width: number;
  height: number;
  maxValue: number;
  bars: BarLayout[];
};

export type StackedBarChartOptions = {
  width: number;
  height: number;
  gap?: number; // 棒同士の隙間 (px 相当、viewBox 座標系)
};

/**
 * 積み上げ棒グラフのレイアウトを計算する。
 * - 各棒の合計値のうち最大のもの (maxValue) を高さ100%として正規化する
 *   (全棒が 0 の場合は maxValue=1 とし、全セグメントの高さを 0 にする — ゼロ除算回避)。
 * - セグメントは配列の順に下から積み上げる (segments[0] が最下段)。
 */
export function computeStackedBarChart(
  data: readonly StackedBarInput[],
  opts: StackedBarChartOptions,
): StackedBarChartLayout {
  const gap = opts.gap ?? 2;
  const n = data.length;
  const totals = data.map((d) => d.segments.reduce((sum, s) => sum + s.value, 0));
  const maxValue = Math.max(1, ...totals);
  const barWidth = n > 0 ? Math.max(0, (opts.width - gap * (n - 1)) / n) : 0;

  const bars: BarLayout[] = data.map((d, i) => {
    const x = i * (barWidth + gap);
    let cursorY = opts.height; // 積み上げは下端 (opts.height) から上に向かって伸ばす
    const segments: BarSegmentRect[] = d.segments.map((s) => {
      const segHeight = (s.value / maxValue) * opts.height;
      const y = cursorY - segHeight;
      cursorY = y;
      return { provider: s.provider, value: s.value, x, y, width: barWidth, height: segHeight };
    });
    return { date: d.date, x, barWidth, segments };
  });

  return { width: opts.width, height: opts.height, maxValue, bars };
}
