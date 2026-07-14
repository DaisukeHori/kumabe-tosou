import { describe, expect, it } from "vitest";

/**
 * canonical: docs/design/crm-suite/03-scheduling.md §7.4 (自動提案配置 greedy earliest-fit)。
 * scheduling/internal/auto-place.ts (DB 非依存の純関数) の単体テスト。
 * 実装計画書 (worktree issue-53.md) §13.2 の必須ケース:
 *  earliest-fit / 30分スナップ / 営業時間外 (09:00-18:00 JST) 回避 /
 *  非拘束の夜間跨ぎ (連続スパン、重複制約なし) / 14日探索打ち切り (それ以降は提案なし) /
 *  busy帯回避 (#53 時点では busy=[] 固定でも動くケースが必須。加えて busy 帯が実データで
 *  渡された場合の回避挙動も、コード自体は既に対応しているためボーナスとして検証しておく —
 *  #54 が externalBusy に実データを繋いだ際の回帰防止になる)。
 *
 * 期待値は「JST の年月日時分」を独立した Date.UTC ベースの oracle 関数 (jstIso — auto-place.ts
 * の JST_OFFSET_MS トリックとは別実装) で計算しており、実装のコピペにならないようにしている。
 */

import { AUTO_PLACE_MAX_LOOKAHEAD_DAYS, proposePlacements, type AutoPlaceTarget } from "@/modules/scheduling/internal/auto-place";

/** JST の年月日時分 → UTC ISO 文字列 (Date.UTC(y,m-1,d,h-9,min) — auto-place.ts の
 *  isoToJstMs/jstMsToIso とは独立した計算経路。JST = UTC+9 固定オフセットなので h-9 で足りる)。 */
function jstIso(y: number, m: number, d: number, h: number, min = 0): string {
  return new Date(Date.UTC(y, m - 1, d, h - 9, min)).toISOString();
}

function target(overrides: Partial<AutoPlaceTarget> & Pick<AutoPlaceTarget, "block_id">): AutoPlaceTarget {
  return {
    planned_hours: 1,
    consumes_capacity: true,
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("proposePlacements (拘束ブロック — earliest-fit / 30分スナップ / 営業時間)", () => {
  it("営業時間前 (08:15) からの要求は 09:00 (営業開始) にスナップして配置する", () => {
    const result = proposePlacements({
      targets: [target({ block_id: "a", planned_hours: 1.5 })],
      from: jstIso(2026, 7, 13, 8, 15), // 月曜 08:15 JST
      existingBookedBlocks: [],
      externalBusy: [],
    });
    expect(result).toEqual([
      {
        block_id: "a",
        starts_at: jstIso(2026, 7, 13, 9, 0),
        ends_at: jstIso(2026, 7, 13, 10, 30),
        expected_updated_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("30分刻みでない開始時刻 (09:15) は次の30分単位 (09:30) に切り上げてスナップする", () => {
    const result = proposePlacements({
      targets: [target({ block_id: "a", planned_hours: 1 })],
      from: jstIso(2026, 7, 13, 9, 15),
      existingBookedBlocks: [],
      externalBusy: [],
    });
    expect(result[0]?.starts_at).toBe(jstIso(2026, 7, 13, 9, 30));
    expect(result[0]?.ends_at).toBe(jstIso(2026, 7, 13, 10, 30));
  });

  it("当日の残り時間が足りない (17:30 開始・1h 要求) 場合は翌営業日 09:00 へ送る (営業時間外回避・分割しない)", () => {
    const result = proposePlacements({
      targets: [target({ block_id: "a", planned_hours: 1 })],
      from: jstIso(2026, 7, 13, 17, 30), // 月曜 17:30 JST (18:00 まで 30分しかない)
      existingBookedBlocks: [],
      externalBusy: [],
    });
    expect(result).toEqual([
      {
        block_id: "a",
        starts_at: jstIso(2026, 7, 14, 9, 0), // 翌営業日 (火曜) 09:00
        ends_at: jstIso(2026, 7, 14, 10, 0),
        expected_updated_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("同一バッチの先行提案 (拘束) と非重複になるよう連続配置する", () => {
    const result = proposePlacements({
      targets: [
        target({ block_id: "a", planned_hours: 2 }),
        target({ block_id: "b", planned_hours: 2 }),
      ],
      from: jstIso(2026, 7, 13, 9, 0),
      existingBookedBlocks: [],
      externalBusy: [],
    });
    expect(result).toEqual([
      {
        block_id: "a",
        starts_at: jstIso(2026, 7, 13, 9, 0),
        ends_at: jstIso(2026, 7, 13, 11, 0),
        expected_updated_at: "2026-01-01T00:00:00.000Z",
      },
      {
        block_id: "b",
        starts_at: jstIso(2026, 7, 13, 11, 0),
        ends_at: jstIso(2026, 7, 13, 13, 0),
        expected_updated_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("busy 帯が空 (#53 時点の固定値) でも正しく動作する (existingBookedBlocks=[] かつ externalBusy=[])", () => {
    const result = proposePlacements({
      targets: [target({ block_id: "a", planned_hours: 1 })],
      from: jstIso(2026, 7, 13, 9, 0),
      existingBookedBlocks: [],
      externalBusy: [],
    });
    expect(result).toHaveLength(1);
  });

  it("busy帯回避 (ボーナス — #54 で externalBusy に実データが入った際の回帰防止): 既存拘束ブロックと重なる枠を避けて次の空きに配置する", () => {
    const result = proposePlacements({
      targets: [target({ block_id: "a", planned_hours: 1 })],
      from: jstIso(2026, 7, 13, 9, 0),
      existingBookedBlocks: [
        { starts_at: jstIso(2026, 7, 13, 9, 0), ends_at: jstIso(2026, 7, 13, 10, 0) },
      ],
      externalBusy: [],
    });
    expect(result).toEqual([
      {
        block_id: "a",
        starts_at: jstIso(2026, 7, 13, 10, 0),
        ends_at: jstIso(2026, 7, 13, 11, 0),
        expected_updated_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it(`${AUTO_PLACE_MAX_LOOKAHEAD_DAYS} 日先まで探索して置けなければ、このブロック以降は提案なし (打ち切り)`, () => {
    // from の日から AUTO_PLACE_MAX_LOOKAHEAD_DAYS 日分、営業時間 (09:00-18:00 JST) を隙間なく埋める
    const fullyBooked = Array.from({ length: AUTO_PLACE_MAX_LOOKAHEAD_DAYS }, (_, n) => ({
      starts_at: jstIso(2026, 7, 13 + n, 9, 0),
      ends_at: jstIso(2026, 7, 13 + n, 18, 0),
    }));
    const result = proposePlacements({
      targets: [
        target({ block_id: "unplaceable", planned_hours: 1 }),
        target({ block_id: "would-be-placeable-if-reached", planned_hours: 1 }),
      ],
      from: jstIso(2026, 7, 13, 9, 0),
      existingBookedBlocks: fullyBooked,
      externalBusy: [],
    });
    // 1 つ目が 14 日以内に置けない → break により 2 つ目 (単独なら容易に置けるはず) も提案されない
    expect(result).toEqual([]);
  });

  it("14日以内 (13日分だけ埋まっている) なら探索を打ち切らずに配置できる (打ち切り境界の反証テスト)", () => {
    const almostFullyBooked = Array.from({ length: AUTO_PLACE_MAX_LOOKAHEAD_DAYS - 1 }, (_, n) => ({
      starts_at: jstIso(2026, 7, 13 + n, 9, 0),
      ends_at: jstIso(2026, 7, 13 + n, 18, 0),
    }));
    const result = proposePlacements({
      targets: [target({ block_id: "a", planned_hours: 1 })],
      from: jstIso(2026, 7, 13, 9, 0),
      existingBookedBlocks: almostFullyBooked,
      externalBusy: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.starts_at).toBe(jstIso(2026, 7, 13 + (AUTO_PLACE_MAX_LOOKAHEAD_DAYS - 1), 9, 0));
  });
});

describe("proposePlacements (非拘束ブロック — 直前ブロック終了時刻から連続スパン、重複制約なし)", () => {
  it("夜間・日跨ぎでも営業時間制約なしで planned_hours 分の連続スパンを置く", () => {
    const result = proposePlacements({
      targets: [target({ block_id: "a", planned_hours: 10, consumes_capacity: false })],
      from: jstIso(2026, 7, 13, 17, 0), // 月曜 17:00 JST + 10h = 火曜 03:00 JST (夜間跨ぎ)
      existingBookedBlocks: [],
      externalBusy: [],
    });
    expect(result).toEqual([
      {
        block_id: "a",
        starts_at: jstIso(2026, 7, 13, 17, 0), // 30分スナップされず from そのまま
        ends_at: jstIso(2026, 7, 14, 3, 0),
        expected_updated_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("既存拘束ブロックと時間帯が重なっていても配置される (非拘束は重複制約なし)", () => {
    const result = proposePlacements({
      targets: [target({ block_id: "a", planned_hours: 2, consumes_capacity: false })],
      from: jstIso(2026, 7, 13, 9, 0),
      existingBookedBlocks: [
        { starts_at: jstIso(2026, 7, 13, 9, 0), ends_at: jstIso(2026, 7, 13, 18, 0) }, // 終日埋まっていても無視
      ],
      externalBusy: [],
    });
    expect(result).toEqual([
      {
        block_id: "a",
        starts_at: jstIso(2026, 7, 13, 9, 0),
        ends_at: jstIso(2026, 7, 13, 11, 0),
        expected_updated_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("拘束ブロックの直後 (バッチ内カーソル) から非拘束ブロックが連続配置される (入力順保持)", () => {
    const result = proposePlacements({
      targets: [
        target({ block_id: "consuming", planned_hours: 2, consumes_capacity: true }),
        target({ block_id: "non-consuming", planned_hours: 3, consumes_capacity: false }),
      ],
      from: jstIso(2026, 7, 13, 9, 0),
      existingBookedBlocks: [],
      externalBusy: [],
    });
    expect(result.map((r) => r.block_id)).toEqual(["consuming", "non-consuming"]);
    expect(result[0]?.ends_at).toBe(jstIso(2026, 7, 13, 11, 0));
    // 非拘束の開始は拘束ブロックの終了時刻そのまま (スナップなし)
    expect(result[1]?.starts_at).toBe(jstIso(2026, 7, 13, 11, 0));
    expect(result[1]?.ends_at).toBe(jstIso(2026, 7, 13, 14, 0));
  });
});
