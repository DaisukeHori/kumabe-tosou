/**
 * G10 紙の微細ノイズ (legacy/css/style.css:1333-1341 body::before の移植)。
 * body は /admin と共有のため body::before は使わず、公開サイト側レイアウト
 * ((site) と (editor)) が描画する固定背景レイヤとして実装する。
 * Server Component (JS なし) — SSG 非退行。z-index:-1 / pointer-events:none で
 * コンテンツ・ビジュアルエディタのホットスポット操作に一切干渉しない。
 */
export function PaperNoise() {
  return <div className="kt-paper-noise" aria-hidden="true" />;
}
