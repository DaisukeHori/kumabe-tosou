import { describe, expect, it } from "vitest";

import { resolveStripWheel } from "@/components/motion/strip-wheel";

describe("resolveStripWheel", () => {
  it("縦優勢 (|dY|>|dX|) で deltaY を返す (正)", () => {
    expect(
      resolveStripWheel({
        deltaX: 0,
        deltaY: 40,
        scrollLeft: 50,
        clientWidth: 200,
        scrollWidth: 1000,
      }),
    ).toBe(40);
  });

  it("縦優勢 (|dY|>|dX|) で deltaY を返す (負)", () => {
    expect(
      resolveStripWheel({
        deltaX: 0,
        deltaY: -40,
        scrollLeft: 50,
        clientWidth: 200,
        scrollWidth: 1000,
      }),
    ).toBe(-40);
  });

  it("横優勢 (|dX|>|dY|) は null", () => {
    expect(
      resolveStripWheel({
        deltaX: 50,
        deltaY: 10,
        scrollLeft: 50,
        clientWidth: 200,
        scrollWidth: 1000,
      }),
    ).toBeNull();
  });

  it("等値 (|dX|===|dY|) は null (変換しない)", () => {
    expect(
      resolveStripWheel({
        deltaX: 20,
        deltaY: 20,
        scrollLeft: 50,
        clientWidth: 200,
        scrollWidth: 1000,
      }),
    ).toBeNull();
  });

  it("左端 (scrollLeft<=0) × 上方向 (deltaY<0) は null", () => {
    expect(
      resolveStripWheel({
        deltaX: 0,
        deltaY: -10,
        scrollLeft: 0,
        clientWidth: 200,
        scrollWidth: 1000,
      }),
    ).toBeNull();
  });

  it("右端 (scrollLeft+clientWidth>=scrollWidth-1) × 下方向 (deltaY>0) は null", () => {
    expect(
      resolveStripWheel({
        deltaX: 0,
        deltaY: 10,
        scrollLeft: 799,
        clientWidth: 200,
        scrollWidth: 1000,
      }),
    ).toBeNull();
  });

  it("端でも逆方向は変換する (左端×下方向)", () => {
    expect(
      resolveStripWheel({
        deltaX: 0,
        deltaY: 10,
        scrollLeft: 0,
        clientWidth: 200,
        scrollWidth: 1000,
      }),
    ).toBe(10);
  });

  it("端でも逆方向は変換する (右端×上方向)", () => {
    expect(
      resolveStripWheel({
        deltaX: 0,
        deltaY: -10,
        scrollLeft: 800,
        clientWidth: 200,
        scrollWidth: 1000,
      }),
    ).toBe(-10);
  });
});
