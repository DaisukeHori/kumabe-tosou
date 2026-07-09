/**
 * チルト+光沢追従の純関数部 (legacy/js/main.js:172-183 の計算部)。
 * px/py はカード内の正規化座標 (0..1)。
 * 正典 (docs/design/motion-gap-report.md §5):
 *   rx = (0.5 - py) * 6 [deg] — 上下 / ry = (px - 0.5) * 7 [deg] — 左右
 *   gx = px * 100 [%] / gy = py * 100 [%]
 */
export interface TiltValues {
  rxDeg: string;
  ryDeg: string;
  gx: string;
  gy: string;
}

export function computeTilt(px: number, py: number): TiltValues {
  return {
    rxDeg: ((0.5 - py) * 6).toFixed(2) + "deg",
    ryDeg: ((px - 0.5) * 7).toFixed(2) + "deg",
    gx: (px * 100).toFixed(1) + "%",
    gy: (py * 100).toFixed(1) + "%",
  };
}

/** mouseleave 時のリセット値 (legacy main.js:187-191) */
export const TILT_RESET = {
  rxDeg: "0deg",
  ryDeg: "0deg",
  gx: "30%",
  gy: "22%",
} as const;
