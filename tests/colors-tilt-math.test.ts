import { describe, expect, it } from "vitest";

import { TILT_RESET, computeTilt } from "@/components/motion/tilt-math";

describe("computeTilt (legacy main.js:172-183 正典)", () => {
  it("中心 (0.5, 0.5) は無回転・グレア中央", () => {
    expect(computeTilt(0.5, 0.5)).toEqual({
      rxDeg: "0.00deg",
      ryDeg: "0.00deg",
      gx: "50.0%",
      gy: "50.0%",
    });
  });
  it("左上 (0, 0) は rx=+3deg / ry=-3.5deg", () => {
    expect(computeTilt(0, 0)).toEqual({
      rxDeg: "3.00deg",
      ryDeg: "-3.50deg",
      gx: "0.0%",
      gy: "0.0%",
    });
  });
  it("右下 (1, 1) は rx=-3deg / ry=+3.5deg", () => {
    const v = computeTilt(1, 1);
    expect(v.rxDeg).toBe("-3.00deg");
    expect(v.ryDeg).toBe("3.50deg");
  });
  it("振れ幅は ±3deg / ±3.5deg (正典 6deg/7deg)", () => {
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      expect(Math.abs(parseFloat(computeTilt(p, p).rxDeg))).toBeLessThanOrEqual(3);
      expect(Math.abs(parseFloat(computeTilt(p, p).ryDeg))).toBeLessThanOrEqual(3.5);
    }
  });
  it("リセット値は legacy mouseleave と同値", () => {
    expect(TILT_RESET).toEqual({
      rxDeg: "0deg",
      ryDeg: "0deg",
      gx: "30%",
      gy: "22%",
    });
  });
});
