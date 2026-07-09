import { describe, expect, it } from "vitest";

import { computeScale, mapChildRectToParent } from "@/app/admin/visual/coordinate-mapping";

/**
 * canonical: docs/design/visual-media-editor.md §5.2 (ホットスポット座標追従)。
 * DOM 非依存の純関数 (iframe rect + 内側 rect + scale 合成) の単体テスト。
 */

describe("mapChildRectToParent", () => {
  it("scale=1 かつ iframe が原点にある場合、内側 rect がそのまま親座標になる", () => {
    const iframeRect = { top: 0, left: 0, width: 1280, height: 2000 };
    const innerRect = { top: 100, left: 50, width: 300, height: 200 };
    expect(mapChildRectToParent(iframeRect, innerRect, 1)).toEqual({
      top: 100,
      left: 50,
      width: 300,
      height: 200,
    });
  });

  it("iframe の位置オフセットを加算する", () => {
    const iframeRect = { top: 40, left: 20, width: 1280, height: 2000 };
    const innerRect = { top: 10, left: 5, width: 100, height: 80 };
    expect(mapChildRectToParent(iframeRect, innerRect, 1)).toEqual({
      top: 50,
      left: 25,
      width: 100,
      height: 80,
    });
  });

  it("scale<1 (縮小表示) は内側 rect のローカル座標・サイズに一律で乗算する", () => {
    const iframeRect = { top: 0, left: 0, width: 640, height: 1000 };
    const innerRect = { top: 200, left: 100, width: 400, height: 300 };
    const scale = 0.5;
    expect(mapChildRectToParent(iframeRect, innerRect, scale)).toEqual({
      top: 100,
      left: 50,
      width: 200,
      height: 150,
    });
  });

  it("iframe オフセット + scale を両方合成する (実運用に近いケース)", () => {
    const iframeRect = { top: 120, left: 60, width: 800, height: 1500 };
    const innerRect = { top: 400, left: 200, width: 1280, height: 720 };
    const scale = 800 / 1280; // computeScale(800, 1280) と同じ比率

    const result = mapChildRectToParent(iframeRect, innerRect, scale);

    expect(result.left).toBeCloseTo(60 + 200 * scale);
    expect(result.top).toBeCloseTo(120 + 400 * scale);
    expect(result.width).toBeCloseTo(1280 * scale);
    expect(result.height).toBeCloseTo(720 * scale);
  });
});

describe("computeScale", () => {
  it("コンテナ幅 / intrinsic 幅を返す", () => {
    expect(computeScale(640, 1280)).toBe(0.5);
    expect(computeScale(1280, 1280)).toBe(1);
    expect(computeScale(1920, 1280)).toBe(1.5);
  });

  it("コンテナ幅が 0 以下 (ResizeObserver 初回コールバック前など) は等倍にフォールバックする", () => {
    expect(computeScale(0, 1280)).toBe(1);
    expect(computeScale(-10, 1280)).toBe(1);
  });

  it("intrinsic 幅が不正な場合も等倍にフォールバックする", () => {
    expect(computeScale(640, 0)).toBe(1);
    expect(computeScale(640, Number.NaN)).toBe(1);
  });

  it("非有限値 (Infinity/NaN) の混入も等倍にフォールバックする", () => {
    expect(computeScale(Number.POSITIVE_INFINITY, 1280)).toBe(1);
    expect(computeScale(640, Number.POSITIVE_INFINITY)).toBe(1);
  });
});
