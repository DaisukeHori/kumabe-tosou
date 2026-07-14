import { describe, expect, it } from "vitest";

import {
  applyEscapeCancel,
  createSelection,
  shouldCancelDragOnEscape,
  shouldCommitCreate,
  shouldIgnoreBlockPointerUp,
} from "@/app/admin/calendar/calendar-grid";
import type { WorkBlockView } from "@/modules/scheduling/contracts";

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

/**
 * canonical: Issue #95 敵対的レビュー2件が独立に指摘した MAJOR バグの回帰防止。
 *
 * Esc キャンセルを全 DragKind (tray/move/resize/create) に適用すると、keydown (Esc) が
 * pointerup と非同期に dragState を null 化するため、「ボタンを離す前に Esc → 別ブロック上で
 * ボタンを離す」という操作順で handleBlockPointerUp の「dragState が無い = 単純クリック」分岐に
 * 落ち、無関係なブロックの詳細ダイアログが誤って開いてしまう回帰を招く。
 * 修正方針は Issue 自身が代替案として提示している「Esc キャンセルは create 限定」。
 *
 * shouldCancelDragOnEscape は calendar-grid.tsx の handleKeyDown が実際に使う判定ロジックそのもの
 * (DOM/pointer/keydown イベントの実機シミュレーションは本リポジトリの Vitest 環境
 * (environment: "node", jsdom 未導入) では困難なため、条件分岐を純関数として抽出し直接検証する)。
 */
describe("shouldCancelDragOnEscape", () => {
  it("create ドラッグ中は true (Esc でプレビューを閉じてよい)", () => {
    expect(shouldCancelDragOnEscape("create")).toBe(true);
  });

  it("move ドラッグ中は false (Esc は無視 — 既存挙動を維持)", () => {
    expect(shouldCancelDragOnEscape("move")).toBe(false);
  });

  it("resize ドラッグ中は false (Esc は無視 — 既存挙動を維持)", () => {
    expect(shouldCancelDragOnEscape("resize")).toBe(false);
  });

  it("tray (未配置トレイからの外部ドラッグ) 中は false (Esc は無視 — 既存挙動を維持)", () => {
    expect(shouldCancelDragOnEscape("tray")).toBe(false);
  });
});

/** テスト用の最小 WorkBlockView フィクスチャ (id 以外のフィールドは本テストで参照しない)。 */
function fakeBlock(id: string): WorkBlockView {
  return { id } as unknown as WorkBlockView;
}

/**
 * canonical: Issue #95 敵対的レビュー (2件目) — 「create 自身の中に残っていたバグ」の回帰防止。
 *
 * shouldCancelDragOnEscape により Esc キャンセルを create 限定にしても、handleKeyDown が
 * dragState を直接 `setDragState(null)` していると、create ドラッグ中に既存ブロックの <button>
 * 上へカーソルを移動した状態で Esc → 動かさず pointerup、という操作順で
 * handleBlockPointerUp の「dragState が無い = 単純クリック」分岐に落ち、無関係なブロックの
 * 詳細ダイアログが誤って開いてしまう。
 *
 * 修正 (最小侵襲パターン): Esc 押下時は dragState を null にせず canceled フラグを立てるだけに
 * 留め (applyEscapeCancel)、実際の null 化は対応する pointerup (commitDrag 内の
 * shouldCommitCreate) に委ねる。この結果、handleBlockPointerUp 時点でも dragState は truthy な
 * ままなので、shouldIgnoreBlockPointerUp の move 判定に落ちて無害化される。
 */
describe("applyEscapeCancel", () => {
  it("create ドラッグ中は canceled:true を付与するが dragState 自体は null にしない (truthy を維持)", () => {
    const dragState = {
      drag: { kind: "create" as const, anchorMinutes: 540 },
      pointerId: 1,
      grabOffsetMinutes: 0,
      preview: { dayOffset: 0, startMinutes: 540, durationMinutes: 30 },
    };
    const result = applyEscapeCancel(dragState);
    expect(result).not.toBeNull();
    expect(result?.canceled).toBe(true);
    expect(result?.drag.kind).toBe("create");
  });

  it("move ドラッグ中は変更されずそのまま返る (Esc は無視 — 既存挙動を維持)", () => {
    const dragState = {
      drag: { kind: "move" as const, block: fakeBlock("block-1") },
      pointerId: 1,
      grabOffsetMinutes: 0,
      preview: { dayOffset: 0, startMinutes: 540, durationMinutes: 60 },
    };
    const result = applyEscapeCancel(dragState);
    expect(result).toBe(dragState);
    expect(result?.canceled).toBeUndefined();
  });

  it("resize/tray ドラッグ中も変更されずそのまま返る (Esc は無視 — 既存挙動を維持)", () => {
    const resizeState = {
      drag: { kind: "resize" as const, block: fakeBlock("block-2") },
      pointerId: 1,
      grabOffsetMinutes: 0,
      preview: { dayOffset: 0, startMinutes: 540, durationMinutes: 60 },
    };
    const trayState = {
      drag: { kind: "tray" as const, block: fakeBlock("block-3") },
      pointerId: 2,
      grabOffsetMinutes: 0,
      preview: { dayOffset: 0, startMinutes: 540, durationMinutes: 60 },
    };
    expect(applyEscapeCancel(resizeState)).toBe(resizeState);
    expect(applyEscapeCancel(trayState)).toBe(trayState);
  });

  it("dragState が null の場合は null を返す", () => {
    expect(applyEscapeCancel(null)).toBeNull();
  });
});

describe("shouldCommitCreate", () => {
  it("canceled:true の場合は moved の値に関わらず何も作成しない (Esc キャンセル後の pointerup で誤作成しない)", () => {
    expect(shouldCommitCreate(true, true)).toBe(false);
    expect(shouldCommitCreate(true, false)).toBe(false);
  });

  it("canceled でなく moved の場合のみ作成する (既存の click-vs-drag 閾値挙動を維持)", () => {
    expect(shouldCommitCreate(false, true)).toBe(true);
    expect(shouldCommitCreate(undefined, true)).toBe(true);
    expect(shouldCommitCreate(false, false)).toBe(false);
    expect(shouldCommitCreate(undefined, false)).toBe(false);
  });
});

describe("shouldIgnoreBlockPointerUp", () => {
  it("create ドラッグ中 (Esc キャンセル済みでも dragState は truthy) は move 対象ではないため無視する — 無関係なブロックの詳細を誤って開かない", () => {
    const createDrag = { kind: "create" as const, anchorMinutes: 540 };
    expect(shouldIgnoreBlockPointerUp(createDrag, "unrelated-block-id")).toBe(true);
  });

  it("move 中で対象ブロック自身の pointerup は無視しない (通常のクリック確定処理を継続)", () => {
    const moveDrag = { kind: "move" as const, block: fakeBlock("block-1") };
    expect(shouldIgnoreBlockPointerUp(moveDrag, "block-1")).toBe(false);
  });

  it("move 中でも別ブロックの pointerup は無視する", () => {
    const moveDrag = { kind: "move" as const, block: fakeBlock("block-1") };
    expect(shouldIgnoreBlockPointerUp(moveDrag, "block-2")).toBe(true);
  });

  it("resize/tray 中は move ではないため常に無視する", () => {
    const resizeDrag = { kind: "resize" as const, block: fakeBlock("block-1") };
    const trayDrag = { kind: "tray" as const, block: fakeBlock("block-1") };
    expect(shouldIgnoreBlockPointerUp(resizeDrag, "block-1")).toBe(true);
    expect(shouldIgnoreBlockPointerUp(trayDrag, "block-1")).toBe(true);
  });

  it("回帰再現: create ドラッグ中に Esc → 動かさず既存ブロック上で pointerup しても詳細ダイアログは開かない", () => {
    // 1. 空白でドラッグ開始 (create)
    const dragState = {
      drag: { kind: "create" as const, anchorMinutes: 540 },
      pointerId: 1,
      grabOffsetMinutes: 0,
      preview: { dayOffset: 0, startMinutes: 540, durationMinutes: 30 },
    };
    // 2. カーソルが既存ブロックの <button> 上にある状態で Esc → canceled フラグが立つのみ
    //    (setDragState(null) はしない)
    const afterEscape = applyEscapeCancel(dragState);
    expect(afterEscape).not.toBeNull(); // dragState は truthy のまま = handleBlockPointerUp の
    // 「dragState が無い = 単純クリック」分岐 (!dragState) には入らない

    // 3. 動かさずそのまま pointerup → handleBlockPointerUp が呼ばれるが、shouldIgnoreBlockPointerUp
    //    が true を返すため無関係なブロックの詳細は開かない
    expect(shouldIgnoreBlockPointerUp(afterEscape!.drag, "unrelated-existing-block-id")).toBe(true);

    // 4. 対応する document 側の pointerup (commitDrag) では canceled のため何も作成されない
    expect(shouldCommitCreate(afterEscape!.canceled, false)).toBe(false);
  });
});
