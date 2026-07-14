import { describe, expect, it } from "vitest";

import { createSelection } from "@/app/admin/calendar/calendar-grid";

/**
 * canonical: GitHub Issue #95 設計 §F。
 *
 * createSelection (calendar-grid.tsx) は、週グリッドの空白ドラッグ作成の選択範囲を計算する
 * 純関数。anchorMinutes (pointerdown 時点、30 分丸め済み) と currentMinutes (pointermove の
 * 生の連続値) から [startMinutes, startMinutes+durationMinutes) を返す。DOM に一切依存しない。
 */
describe("createSelection", () => {
  it("下方向ドラッグ: anchor から下へ伸ばした分だけ選択範囲が広がる", () => {
    // 09:00 (540分) で押下 → 10:20 (620分) までドラッグ (10:00-10:30 のセルへ食い込む)
    expect(createSelection(540, 620)).toEqual({ startMinutes: 540, durationMinutes: 90 }); // 09:00〜10:30
  });

  it("上方向ドラッグ: anchor の初期セルを含んだまま上へ選択が伸びる", () => {
    // 10:00 (600分) で押下 → 09:10 (550分) まで上へドラッグ
    expect(createSelection(600, 550)).toEqual({ startMinutes: 540, durationMinutes: 90 }); // 09:00〜10:30
  });

  it("同一セル内でのわずかな移動は最低 30 分を維持する", () => {
    expect(createSelection(540, 545)).toEqual({ startMinutes: 540, durationMinutes: 30 }); // 09:00〜09:30
  });

  it("anchor と current が完全一致でも最低 30 分を返す", () => {
    expect(createSelection(600, 600)).toEqual({ startMinutes: 600, durationMinutes: 30 });
  });

  it("0:00 より上へのドラッグは 0 分にクランプする", () => {
    // 00:10 (10分) で押下 → 画面外上方 (負の分) までドラッグ
    expect(createSelection(10, -120)).toEqual({ startMinutes: 0, durationMinutes: 30 });
  });

  it("24:00 を超える下方向ドラッグは日末 (24:00) にクランプする", () => {
    // 23:30 (1410分) で押下 → 画面外下方 (24:00 超) までドラッグ
    expect(createSelection(1410, 1600)).toEqual({ startMinutes: 1410, durationMinutes: 30 });
  });

  it("スナップ境界値: current がちょうど 30 分境界のとき次のセルへ拡張しない", () => {
    // 09:00 で押下 → ちょうど 09:30 (境界値) までドラッグ → 09:00-09:30 の1コマのみ
    expect(createSelection(540, 570)).toEqual({ startMinutes: 540, durationMinutes: 30 });
  });

  it("スナップ境界値: current が境界を 1 分でも超えると次のセルへ拡張する", () => {
    // 09:00 で押下 → 09:30 の 1 分先 (571分) までドラッグ → 09:00-10:00 の2コマ
    expect(createSelection(540, 571)).toEqual({ startMinutes: 540, durationMinutes: 60 });
  });

  it("anchor 自体が 30 分丸めされていない値でも floor される", () => {
    // beginCreate は snapDownToHalfHour 済みの値を渡す想定だが、純関数自体は未丸めの入力も
    // 安全に floor する (契約の頑健性)
    expect(createSelection(555, 555)).toEqual({ startMinutes: 540, durationMinutes: 30 });
  });
});
