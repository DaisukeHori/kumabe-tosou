import { describe, expect, it } from "vitest";

import { computeStackedBarChart, type StackedBarInput } from "@/app/admin/costs/chart";

/**
 * /admin/costs (設計書 §9) の日別積み上げ棒グラフ — 座標計算 (純関数)。
 * SVG 自作 (recharts 等の依存を追加しない) のため、レンダリングと切り離して
 * 座標計算のみを検証する。
 */
describe("computeStackedBarChart", () => {
  it("1本の棒 (1セグメント) は高さ0から height まで満たす", () => {
    const data: StackedBarInput[] = [{ date: "2026-07-10", segments: [{ provider: "openai", value: 100 }] }];
    const layout = computeStackedBarChart(data, { width: 100, height: 50, gap: 0 });

    expect(layout.maxValue).toBe(100);
    expect(layout.bars).toHaveLength(1);
    const bar = layout.bars[0];
    expect(bar.x).toBe(0);
    expect(bar.barWidth).toBe(100);
    expect(bar.segments).toEqual([{ provider: "openai", value: 100, x: 0, y: 0, width: 100, height: 50 }]);
  });

  it("最大値を持つ棒が height いっぱいになるよう正規化する (相対値)", () => {
    const data: StackedBarInput[] = [
      { date: "d1", segments: [{ provider: "openai", value: 50 }] },
      { date: "d2", segments: [{ provider: "openai", value: 100 }] },
    ];
    const layout = computeStackedBarChart(data, { width: 100, height: 50, gap: 0 });

    expect(layout.maxValue).toBe(100);
    expect(layout.bars[0].segments[0].height).toBe(25); // 50/100 * 50
    expect(layout.bars[1].segments[0].height).toBe(50); // 100/100 * 50
  });

  it("複数セグメントは下から順に積み上げる (segments[0] が最下段)", () => {
    const data: StackedBarInput[] = [
      {
        date: "2026-07-10",
        segments: [
          { provider: "openai", value: 30 },
          { provider: "anthropic", value: 20 },
        ],
      },
    ];
    const layout = computeStackedBarChart(data, { width: 100, height: 50, gap: 0 });
    const [openai, anthropic] = layout.bars[0].segments;

    // openai (最下段): 30/50 * 50 = 30 の高さ、下端 (y=50) に接する
    expect(openai).toEqual({ provider: "openai", value: 30, x: 0, y: 20, width: 100, height: 30 });
    // anthropic (2段目): openai の上端 (y=20) から更に 20/50*50=20 積み上がる
    expect(anthropic).toEqual({ provider: "anthropic", value: 20, x: 0, y: 0, width: 100, height: 20 });
  });

  it("棒の間に gap を挟んで等幅配置する", () => {
    const data: StackedBarInput[] = [
      { date: "d1", segments: [{ provider: "openai", value: 10 }] },
      { date: "d2", segments: [{ provider: "openai", value: 10 }] },
      { date: "d3", segments: [{ provider: "openai", value: 10 }] },
    ];
    const layout = computeStackedBarChart(data, { width: 100, height: 20, gap: 2 });

    // barWidth = (100 - 2*2) / 3 = 32
    expect(layout.bars[0].barWidth).toBeCloseTo(32);
    expect(layout.bars[0].x).toBe(0);
    expect(layout.bars[1].x).toBeCloseTo(34); // barWidth + gap
    expect(layout.bars[2].x).toBeCloseTo(68);
  });

  it("全データが 0 でもゼロ除算にならず高さ0を返す (maxValue は 1 にフォールバック)", () => {
    const data: StackedBarInput[] = [{ date: "2026-07-10", segments: [{ provider: "openai", value: 0 }] }];
    const layout = computeStackedBarChart(data, { width: 100, height: 50, gap: 0 });

    expect(layout.maxValue).toBe(1);
    expect(layout.bars[0].segments[0].height).toBe(0);
  });

  it("空データは空の bars を返す", () => {
    const layout = computeStackedBarChart([], { width: 100, height: 50 });
    expect(layout.bars).toEqual([]);
    expect(layout.maxValue).toBe(1);
  });

  it("欠損日 (segments が空配列の棒) は他の棒に影響を与えず高さ0のまま描画される", () => {
    const data: StackedBarInput[] = [
      { date: "d1", segments: [{ provider: "openai", value: 100 }] },
      { date: "d2", segments: [] }, // データ欠損日
    ];
    const layout = computeStackedBarChart(data, { width: 100, height: 50, gap: 0 });

    expect(layout.maxValue).toBe(100); // 欠損日の合計0はmaxValueに影響しない
    expect(layout.bars[1].segments).toEqual([]);
    expect(layout.bars[0].segments[0].height).toBe(50);
  });

  it("gap を指定しない場合は既定値 2 が使われる", () => {
    const data: StackedBarInput[] = [
      { date: "d1", segments: [{ provider: "openai", value: 10 }] },
      { date: "d2", segments: [{ provider: "openai", value: 10 }] },
    ];
    const layout = computeStackedBarChart(data, { width: 100, height: 50 });
    // barWidth = (100 - 2*1)/2 = 49、2本目の x = 49 + 2 = 51
    expect(layout.bars[0].barWidth).toBeCloseTo(49);
    expect(layout.bars[1].x).toBeCloseTo(51);
  });

  it("NaN・Infinity を生まない (座標は常に有限の数値)", () => {
    const data: StackedBarInput[] = [
      { date: "d1", segments: [{ provider: "openai", value: 0 }] },
      { date: "d2", segments: [] },
      { date: "d3", segments: [{ provider: "anthropic", value: 42 }] },
    ];
    const layout = computeStackedBarChart(data, { width: 300, height: 80, gap: 2 });
    for (const bar of layout.bars) {
      expect(Number.isFinite(bar.x)).toBe(true);
      expect(Number.isFinite(bar.barWidth)).toBe(true);
      for (const seg of bar.segments) {
        expect(Number.isFinite(seg.x)).toBe(true);
        expect(Number.isFinite(seg.y)).toBe(true);
        expect(Number.isFinite(seg.height)).toBe(true);
        expect(seg.height).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
