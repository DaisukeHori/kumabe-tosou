import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveDragCommit } from "@/app/admin/calendar/calendar-grid";
import type { WorkBlockView } from "@/modules/scheduling/contracts";

/**
 * canonical: 週グリッド DnD の「1 回のドラッグ = 1 回の Server Action」回帰防止。
 *
 * 【背景】commitDrag が `setDragState((prev) => { ... onPlaceBlock(...) ... })` のように、
 * state updater の **中** で副作用 (親 CalendarBoard の Server Action 呼び出し) を実行していた。
 * React 18 の Strict Mode (next dev の既定 ON) は updater の純粋性を検査するため意図的に
 * updater を 2 回呼ぶので、同一引数 (block_id / starts_at / ends_at / expected_updated_at) の
 * Server Action が 2 回送信され、1 回目は成功する一方 2 回目は expected_updated_at が古くなって
 * 楽観ロックに弾かれ、ドラッグのたびに「他の変更と競合しました」(KMB-E103) の失敗トーストが出た。
 * 同じ原因で「Cannot update a component (CalendarBoard) while rendering a different component
 * (CalendarGrid)」の警告も発生していた。
 *
 * 【修正】何をするかの判断を純関数 resolveDragCommit に切り出し、実行 (onPlaceBlock /
 * onCreateRange) はイベントハンドラ本体で 1 回だけ行う。ここではその純関数の仕様と、
 * 「updater の中で副作用を呼んでいない」という構造そのものをソース走査で固定する。
 */

function fakeBlock(id: string, updatedAt: string): WorkBlockView {
  return { id, updated_at: updatedAt } as unknown as WorkBlockView;
}

const WEEK_START = "2026-09-07"; // 月曜

describe("resolveDragCommit", () => {
  it("move: preview の日/開始分/長さから starts_at・ends_at (JST 指定を UTC ISO 化) と expected_updated_at を組み立てる", () => {
    const commit = resolveDragCommit(
      {
        drag: { kind: "move" as const, block: fakeBlock("b1", "2026-09-01T00:00:00Z") },
        pointerId: 1,
        grabOffsetMinutes: 0,
        preview: { dayOffset: 2, startMinutes: 10 * 60, durationMinutes: 90 }, // 水曜 10:00〜11:30
      },
      WEEK_START,
      true,
    );
    expect(commit).toEqual({
      kind: "place",
      blockId: "b1",
      startsAt: "2026-09-09T01:00:00.000Z",
      endsAt: "2026-09-09T02:30:00.000Z",
      expectedUpdatedAt: "2026-09-01T00:00:00Z",
    });
  });

  it("resize / tray も move と同じ place 指示になる (kind 依存の分岐は create のみ)", () => {
    for (const kind of ["resize", "tray"] as const) {
      const commit = resolveDragCommit(
        {
          drag: { kind, block: fakeBlock("b2", "u2") },
          pointerId: 1,
          grabOffsetMinutes: 0,
          preview: { dayOffset: 0, startMinutes: 9 * 60, durationMinutes: 120 },
        },
        WEEK_START,
        false, // moved 判定は place には影響しない (リサイズ/トレイ配置は必ず確定させる)
      );
      expect(commit).toEqual({
        kind: "place",
        blockId: "b2",
        startsAt: "2026-09-07T00:00:00.000Z",
        endsAt: "2026-09-07T02:00:00.000Z",
        expectedUpdatedAt: "u2",
      });
    }
  });

  it("create: moved なら日付と選択範囲を返す", () => {
    expect(
      resolveDragCommit(
        {
          drag: { kind: "create" as const, anchorMinutes: 540 },
          pointerId: 1,
          grabOffsetMinutes: 0,
          preview: { dayOffset: 5, startMinutes: 540, durationMinutes: 90 },
        },
        WEEK_START,
        true,
      ),
    ).toEqual({ kind: "create", date: "2026-09-12", startMinutes: 540, durationMinutes: 90 });
  });

  it("create: 4px 未満のクリック (moved=false) では何も作成しない", () => {
    expect(
      resolveDragCommit(
        {
          drag: { kind: "create" as const, anchorMinutes: 540 },
          pointerId: 1,
          grabOffsetMinutes: 0,
          preview: { dayOffset: 0, startMinutes: 540, durationMinutes: 30 },
        },
        WEEK_START,
        false,
      ),
    ).toEqual({ kind: "none" });
  });

  it("create: Esc キャンセル済み (canceled) なら moved でも何も作成しない", () => {
    expect(
      resolveDragCommit(
        {
          drag: { kind: "create" as const, anchorMinutes: 540 },
          pointerId: 1,
          grabOffsetMinutes: 0,
          preview: { dayOffset: 0, startMinutes: 540, durationMinutes: 90 },
          canceled: true,
        },
        WEEK_START,
        true,
      ),
    ).toEqual({ kind: "none" });
  });

  it("dragState が無い / preview が無い場合は none", () => {
    expect(resolveDragCommit(null, WEEK_START, true)).toEqual({ kind: "none" });
    expect(
      resolveDragCommit(
        { drag: { kind: "move" as const, block: fakeBlock("b3", "u3") }, pointerId: 1, grabOffsetMinutes: 0, preview: null },
        WEEK_START,
        true,
      ),
    ).toEqual({ kind: "none" });
  });
});

/**
 * 構造の固定 (Strict Mode 二重送信の再発防止)。Vitest は node 環境で React のレンダーを回さないため、
 * 「updater の中で副作用を呼ばない」という不変条件はソース走査で担保する。
 */
describe("calendar-grid.tsx の構造 (Strict Mode 二重実行対策)", () => {
  const source = readFileSync(path.resolve(__dirname, "../src/app/admin/calendar/calendar-grid.tsx"), "utf8");

  it("setDragState は setDrag ラッパー内でのみ呼ばれる (ref ミラーを迂回する更新経路を作らない)", () => {
    const calls = source.split("\n").filter((line) => /^\s*setDragState\(/.test(line));
    expect(calls).toHaveLength(1); // setDrag() の実装 1 箇所のみ
  });

  it("state updater (setDrag((prev) => ...)) の中で onPlaceBlock / onCreateRange を呼んでいない", () => {
    // setDrag((prev) => { ... }); の本文をすべて取り出し、副作用呼び出しが含まれないことを確認する
    const bodies = [...source.matchAll(/setDrag\(\(prev\)\s*=>\s*\{([\s\S]*?)\n {4}\}\);/g)].map((m) => m[1]);
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).not.toMatch(/onPlaceBlock\(/);
      expect(body).not.toMatch(/onCreateRange\(/);
      expect(body).not.toMatch(/pointerStartRef\.current\s*=/);
    }
  });

  it("commitDrag は dragStateRef から読み、副作用を updater の外で 1 回だけ呼ぶ", () => {
    const body = source.slice(source.indexOf("  function commitDrag("), source.indexOf("  useEffect(() => {\n    if (!dragState) return;"));
    expect(body).toMatch(/const prev = dragStateRef\.current;/);
    expect(body).not.toMatch(/setDrag\(\(prev\)/);
    expect(body.match(/onPlaceBlock\(/g) ?? []).toHaveLength(1);
    expect(body.match(/onCreateRange\(/g) ?? []).toHaveLength(1);
  });
});
