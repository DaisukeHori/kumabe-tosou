/**
 * /admin/calendar 週グリッドの座標変換 (純関数)。
 *
 * calendar-grid.tsx から DOM 依存 (ref / getBoundingClientRect / scrollTop) を切り離し、
 * 単体テスト可能な形にしたもの。
 *
 * 【地雷 / この関数が存在する理由】trackRect は **スクロールコンテナの中身** (48 行分の高さを
 * 持つトラック要素) の getBoundingClientRect() を渡す前提である。中身の rect.top はスクロール
 * した分だけ上 (負方向) へ動くため、`clientY - trackRect.top` の時点で **すでにスクロール量が
 * 含まれた** トラック内 Y になっている。ここへさらに scrollTop を足すとスクロール量が二重に
 * 加算され、初期スクロール (07:00) の分だけ常に約 7 時間下がった位置が選択される
 * (修正前の実バグ)。したがってこの関数は scrollTop を一切受け取らないし、足さない。
 */

const DAY_TOTAL_MIN = 24 * 60;

/** minutes を rowMinutes 刻みへ四捨五入し、0〜(24:00 − 1 行) にクランプする。 */
export function snapMinutes(minutes: number, rowMinutes: number): number {
  return Math.min(DAY_TOTAL_MIN - rowMinutes, Math.max(0, Math.round(minutes / rowMinutes) * rowMinutes));
}

export type GridTrackRect = {
  /** トラック要素の左端 (viewport 座標) */
  left: number;
  /** トラック要素の上端 (viewport 座標)。スクロール済みなら負の値になり得る */
  top: number;
  /** 時刻ガターを含むトラック全幅 */
  width: number;
};

export type ClientToGridPositionArgs = {
  clientX: number;
  clientY: number;
  trackRect: GridTrackRect;
  /** 左端の時刻ガター幅 (px)。日カラム判定はこの分を差し引く */
  gutterPx: number;
  /** 1 行 (= rowMinutes 分) の高さ (px) */
  rowHeightPx: number;
  /** 1 行が表す分数 (30) */
  rowMinutes: number;
  /** 週グリッドの日カラム数 (7) */
  dayCount: number;
};

export type GridPosition = {
  /** 週内の日オフセット。0〜dayCount-1 にクランプ済み */
  dayOffset: number;
  /** rowMinutes へスナップした日内分 */
  minutes: number;
  /** スナップ前の連続値 (create ドラッグの floor/ceil 判定に使う) */
  rawMinutes: number;
};

/**
 * ポインタの viewport 座標を週グリッド上の位置 (日オフセット + 日内分) へ変換する。
 * trackRect はスクロールコンテナの「中身」の rect を渡すこと (scrollTop は加算しない)。
 */
export function clientToGridPosition(args: ClientToGridPositionArgs): GridPosition {
  const { clientX, clientY, trackRect, gutterPx, rowHeightPx, rowMinutes, dayCount } = args;
  const dayWidth = (trackRect.width - gutterPx) / dayCount;
  const rawDayOffset = Math.floor((clientX - trackRect.left - gutterPx) / dayWidth);
  const dayOffset = Math.min(dayCount - 1, Math.max(0, Number.isFinite(rawDayOffset) ? rawDayOffset : 0));
  // scrollTop は足さない (rect.top が既にスクロール込み) — ファイル冒頭の【地雷】参照
  const yWithinTrack = clientY - trackRect.top;
  const rawMinutes = (yWithinTrack / rowHeightPx) * rowMinutes;
  return { dayOffset, minutes: snapMinutes(rawMinutes, rowMinutes), rawMinutes };
}
