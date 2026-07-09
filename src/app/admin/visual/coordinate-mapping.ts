/**
 * /admin/visual のホットスポット座標写像 (canonical: docs/design/visual-media-editor.md §5.2)。
 *
 * 「iframe rect + 内側 rect + scroll + scale 合成で親座標系へ写像する」ロジックを DOM 非依存の
 * 純関数として切り出す (テスト容易性のため。visual-editor.tsx から呼ばれる)。
 *
 * 前提:
 * - `iframeRect` / `innerRect` は呼び出し側が `getBoundingClientRect()` で取得した最新値を渡す。
 *   getBoundingClientRect() は呼び出し時点のスクロール位置を常に反映するため、
 *   「scroll 追従」は本関数の外側 (呼び出しタイミング = 再測定トリガー) の責務であり、
 *   本関数自体はスクロール量を明示的な引数に取らない。
 * - iframe には `transform: scale(scale)` / `transform-origin: 0 0` を適用する想定
 *   (visual-editor.tsx)。iframe 自身の getBoundingClientRect() (= iframeRect) は
 *   transform 適用後 (縮小後) の座標・サイズを返すため、内側要素のローカル座標
 *   (innerRect, iframe 内ドキュメントの素の px 単位) に scale を掛けてから
 *   iframeRect.left/top を加算するだけで親座標系に写像できる
 *   (transform-origin が 0 0 のため、iframeRect.left/top は「ローカル原点 (0,0) が
 *   写像される先」と一致する)。
 */

export type Rect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

/**
 * iframe 内の要素の rect (iframe 自身のビューポート座標系、素の px) を、
 * 親ドキュメントの座標系へ写像する。
 */
export function mapChildRectToParent(iframeRect: Rect, innerRect: Rect, scale: number): Rect {
  return {
    left: iframeRect.left + innerRect.left * scale,
    top: iframeRect.top + innerRect.top * scale,
    width: innerRect.width * scale,
    height: innerRect.height * scale,
  };
}

/**
 * 「幅固定 (INTRINSIC_WIDTH) + transform scale」方式 (§5.2 の「縮小表示」実装) における
 * scale 係数。wrapper (コンテナ) の実測幅を intrinsicWidth で割るだけの単純計算だが、
 * ResizeObserver 初回コールバック前 (幅 0) や不正値からの防御のため 0 より大きい
 * 有限値のみ許可し、それ以外は 1 (等倍) にフォールバックする。
 */
export function computeScale(containerWidth: number, intrinsicWidth: number): number {
  if (!Number.isFinite(containerWidth) || !Number.isFinite(intrinsicWidth)) return 1;
  if (containerWidth <= 0 || intrinsicWidth <= 0) return 1;
  return containerWidth / intrinsicWidth;
}
