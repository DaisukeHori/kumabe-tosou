import type { HelpAnnotation, HelpScreenshot } from "./types";

/**
 * 撮影スクリプトが書き出す注釈座標 JSON (public/help/<slug>/<name>.json) の形。
 * boxes は data-help="<key>" が付いた要素の位置 (元画像ピクセル)。
 */
export type HelpShotBox = { x: number; y: number; w: number; h: number };
export type HelpShotJson = {
  width: number;
  height: number;
  boxes: Record<string, HelpShotBox>;
};

/**
 * 注釈は「手打ち座標禁止」(設計書 §5)。ヘルプ本文は必ずこのヘルパを通して、
 * 撮影時に記録された実際の要素位置から注釈を組み立てる。
 * 撮り直して要素の位置が変わっても、JSON が更新されれば注釈も自動で追従する。
 */
export function createAnnotator(shot: HelpShotJson) {
  function boxOf(key: string): HelpShotBox {
    const found = shot.boxes[key];
    if (!found) {
      const known = Object.keys(shot.boxes).join(", ");
      throw new Error(
        `注釈キー "${key}" が撮影 JSON にありません。data-help 属性と撮影スクリプトの anchors を確認してください (記録済み: ${known})`,
      );
    }
    return found;
  }

  return {
    /** 要素を赤枠で囲む (番号付き)。 */
    box(key: string, number?: number, label?: string): HelpAnnotation {
      const b = boxOf(key);
      return { kind: "box", x: b.x, y: b.y, w: b.w, h: b.h, number, label };
    },
    /** 要素の左上に番号バッジだけを置く (枠を出すと画面が見づらいとき)。 */
    badge(key: string, number: number): HelpAnnotation {
      const b = boxOf(key);
      return { kind: "badge", x: b.x, y: b.y, number };
    },
    /** 要素から要素へ矢印を引く (「ここを押すとここが変わる」の説明用)。 */
    arrow(fromKey: string, toKey: string, label?: string): HelpAnnotation {
      const from = boxOf(fromKey);
      const to = boxOf(toKey);
      const start = center(from);
      const end = borderPointToward(to, start);
      return { kind: "arrow", x: start.x, y: start.y, toX: end.x, toY: end.y, label };
    },
    /** 画像 1 枚分の HelpScreenshot を組み立てる (幅・高さは JSON から取る)。 */
    screenshot(input: {
      src: string;
      alt: string;
      annotations: HelpAnnotation[];
      caption?: string;
    }): HelpScreenshot {
      return {
        src: input.src,
        alt: input.alt,
        width: shot.width,
        height: shot.height,
        annotations: input.annotations,
        caption: input.caption,
      };
    },
  };
}

function center(b: HelpShotBox): { x: number; y: number } {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** 矢印の先端を、相手の枠の中ではなく枠の縁で止めるための交点計算。 */
function borderPointToward(target: HelpShotBox, from: { x: number; y: number }): { x: number; y: number } {
  const c = center(target);
  const dx = from.x - c.x;
  const dy = from.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const halfW = target.w / 2;
  const halfH = target.h / 2;
  // 中心から from 方向へ伸ばして、先に当たる辺 (縦か横か) で止める。
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : halfW / Math.abs(dx);
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : halfH / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}
