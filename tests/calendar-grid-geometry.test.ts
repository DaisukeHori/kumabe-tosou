import { describe, expect, it } from "vitest";

import { clientToGridPosition, snapMinutes } from "@/app/admin/calendar/_ui/grid-geometry";

/**
 * /admin/calendar 週グリッドの座標変換 (src/app/admin/calendar/_ui/grid-geometry.ts)。
 *
 * 回帰の本体: 旧実装は「スクロールコンテナの中身」の rect.top を基準にしながら、さらに
 * scrollTop を加算していたためスクロール量が二重に足され、初期スクロール (07:00) の分だけ
 * 常に約 7 時間下がった位置が選択された。ここでは rect.top が負 (= スクロール済み) の
 * ケースでも同じ分が出ることを固定する。
 */

const ROW_MINUTES = 30;
const ROW_HEIGHT_PX = 22;
const GUTTER_PX = 48;
const ROWS_PER_DAY = 48;
/** 07:00 までスクロールしたときのスクロール量 (px) */
const SCROLL_7H_PX = 7 * (60 / ROW_MINUTES) * ROW_HEIGHT_PX;

const TRACK_WIDTH = GUTTER_PX + 7 * 100; // 日カラム 1 本 = 100px
const TRACK_LEFT = 200;

function position(clientX: number, clientY: number, trackTop: number) {
  return clientToGridPosition({
    clientX,
    clientY,
    trackRect: { left: TRACK_LEFT, top: trackTop, width: TRACK_WIDTH },
    gutterPx: GUTTER_PX,
    rowHeightPx: ROW_HEIGHT_PX,
    rowMinutes: ROW_MINUTES,
    dayCount: 7,
  });
}

/** 日内分 → トラック先頭からの Y (px) */
function yOfMinutes(minutes: number): number {
  return (minutes / ROW_MINUTES) * ROW_HEIGHT_PX;
}

describe("clientToGridPosition — 縦方向 (時刻)", () => {
  it("スクロール 0 のとき 09:00 の位置は 540 分になる", () => {
    const trackTop = 100; // スクロールしていない = 中身の上端が viewport 内
    const pos = position(TRACK_LEFT + GUTTER_PX + 10, trackTop + yOfMinutes(9 * 60), trackTop);
    expect(pos.minutes).toBe(9 * 60);
    expect(pos.rawMinutes).toBeCloseTo(9 * 60, 6);
  });

  it("7 時間スクロール相当 (rect.top が負) でも同じ 540 分になる — scrollTop の二重加算をしない", () => {
    // 中身の上端はスクロール量だけ上 (負方向) へ動く
    const trackTop = 100 - SCROLL_7H_PX;
    const clientY = trackTop + yOfMinutes(9 * 60); // 09:00 の行が実際に見えている位置
    const pos = position(TRACK_LEFT + GUTTER_PX + 10, clientY, trackTop);
    expect(pos.minutes).toBe(9 * 60);
  });

  it("旧実装のように scrollTop を足すと約 7 時間ずれることの逆確認 (ずれない)", () => {
    const trackTop = 100 - SCROLL_7H_PX;
    const clientY = trackTop + yOfMinutes(10 * 60); // 10:00
    const pos = position(TRACK_LEFT + GUTTER_PX + 10, clientY, trackTop);
    expect(pos.minutes).toBe(10 * 60);
    // 二重加算していれば 10:00 + 7h = 17:00 (1020 分) になっていた
    expect(pos.minutes).not.toBe(17 * 60);
  });

  it("トラック外 (上/下) は 0〜23:30 にクランプされる", () => {
    const trackTop = 0;
    expect(position(TRACK_LEFT + GUTTER_PX + 10, -500, trackTop).minutes).toBe(0);
    const belowY = yOfMinutes(ROWS_PER_DAY * ROW_MINUTES) + 500;
    expect(position(TRACK_LEFT + GUTTER_PX + 10, belowY, trackTop).minutes).toBe(24 * 60 - ROW_MINUTES);
  });
});

describe("clientToGridPosition — 曜日カラム判定", () => {
  const trackTop = 0;
  const y = yOfMinutes(9 * 60);

  it("ガターを除いた幅を 7 等分して日オフセットを返す", () => {
    for (let day = 0; day < 7; day++) {
      const x = TRACK_LEFT + GUTTER_PX + day * 100 + 50; // カラム中央
      expect(position(x, y, trackTop).dayOffset).toBe(day);
    }
  });

  it("カラム境界はその右側のカラムに属する", () => {
    expect(position(TRACK_LEFT + GUTTER_PX + 99.9, y, trackTop).dayOffset).toBe(0);
    expect(position(TRACK_LEFT + GUTTER_PX + 100, y, trackTop).dayOffset).toBe(1);
  });

  it("ガター上や左外は 0、右外は 6 にクランプされる", () => {
    expect(position(TRACK_LEFT + 10, y, trackTop).dayOffset).toBe(0); // ガター上
    expect(position(TRACK_LEFT - 500, y, trackTop).dayOffset).toBe(0);
    expect(position(TRACK_LEFT + TRACK_WIDTH + 500, y, trackTop).dayOffset).toBe(6);
  });
});

describe("snapMinutes — 30 分スナップ", () => {
  it("最も近い 30 分境界へ四捨五入する", () => {
    expect(snapMinutes(0, 30)).toBe(0);
    expect(snapMinutes(14, 30)).toBe(0);
    expect(snapMinutes(15, 30)).toBe(30);
    expect(snapMinutes(44, 30)).toBe(30);
    expect(snapMinutes(46, 30)).toBe(60);
    expect(snapMinutes(9 * 60 + 20, 30)).toBe(9 * 60 + 30);
  });

  it("0〜23:30 にクランプする", () => {
    expect(snapMinutes(-120, 30)).toBe(0);
    expect(snapMinutes(24 * 60, 30)).toBe(24 * 60 - 30);
    expect(snapMinutes(99_999, 30)).toBe(24 * 60 - 30);
  });

  it("clientToGridPosition の minutes は rawMinutes をスナップした値と一致する", () => {
    const trackTop = 100 - SCROLL_7H_PX;
    const pos = position(TRACK_LEFT + GUTTER_PX + 10, trackTop + yOfMinutes(9 * 60) + 5, trackTop);
    expect(pos.minutes).toBe(snapMinutes(pos.rawMinutes, ROW_MINUTES));
  });
});
