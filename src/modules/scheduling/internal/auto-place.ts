/**
 * 自動提案配置 (canonical: docs/design/crm-suite/03-scheduling.md §7.4)。
 * greedy earliest-fit の決定的アルゴリズム。DB 非依存の純関数のみ (提案を生成するだけ — 永続化は
 * facade/repository の責務。proposeBlockPlacement は「提案のみ生成し、確定は admin が置く」§7.4)。
 *
 * 実装方針: すべての時刻計算を「JST 相当 ms」(UTC ms + 9h) の 1 本の数直線上で行い、
 * 入出力の境界 (ISO 文字列 ⇔ ms) だけで変換する (03-scheduling.md §7.2 の
 * 「Asia/Tokyo 変換はコード側 1 箇所」の精神を踏襲 — capacity.ts とは別ファイルだが同じ設計原則)。
 * JST は UTC+9 固定オフセット (DST なし) のため、この単純な加減算で厳密に正しい。
 */

import type { PlacementProposal } from "../contracts";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SNAP_MS = 30 * 60 * 1000; // 30 分スナップ (§7.4 手順 3)
const JST_OFFSET_MS = 9 * HOUR_MS;
const BUSINESS_START_HOUR = 9;
const BUSINESS_END_HOUR = 18;

/** 14 日先まで探索して置けなければそのブロック以降は提案なし (§7.4 手順 6) */
export const AUTO_PLACE_MAX_LOOKAHEAD_DAYS = 14;

export type AutoPlaceTarget = {
  block_id: string;
  planned_hours: number;
  consumes_capacity: boolean;
  /** 提案生成時点の block.updated_at (楽観排他の透過用 — PlacementProposal.expected_updated_at) */
  updated_at: string;
};

export type AutoPlaceBusyInterval = { starts_at: string; ends_at: string };

export type AutoPlaceInput = {
  /** 対象 backlog ブロック。入力順 = 提案順を保持 (§7.4 手順 5 — 依存グラフを持たない) */
  targets: AutoPlaceTarget[];
  /** この時刻以降に置く (通常 = 今) */
  from: string;
  /** 既存配置ブロック (拘束のみ。§7.4 手順 3) */
  existingBookedBlocks: AutoPlaceBusyInterval[];
  /** 外部 busy 帯 (#53 時点は getExternalBusy が常に [] を返すため常に空配列で渡される。
   *  #54 以降で実データが入る想定でパラメータ自体は用意しておく) */
  externalBusy: AutoPlaceBusyInterval[];
};

function isoToJstMs(iso: string): number {
  return new Date(iso).getTime() + JST_OFFSET_MS;
}

function jstMsToIso(jstMs: number): string {
  return new Date(jstMs - JST_OFFSET_MS).toISOString();
}

function jstDayStart(jstMs: number): number {
  return Math.floor(jstMs / DAY_MS) * DAY_MS;
}

function snapUpToHalfHour(jstMs: number): number {
  return Math.ceil(jstMs / SNAP_MS) * SNAP_MS;
}

type Interval = { start: number; end: number };

/**
 * [searchFrom, windowEnd) の範囲内で、busy (JST ms の区間集合) と非重複な durationMs 以上の
 * 空きの開始時刻を 30 分スナップで earliest-fit 探索する。見つからなければ null。
 */
function findEarliestGapStart(
  searchFrom: number,
  windowEnd: number,
  durationMs: number,
  busy: readonly Interval[],
): number | null {
  const relevant = busy
    .filter((b) => b.end > searchFrom && b.start < windowEnd)
    .sort((a, b) => a.start - b.start);

  let cursor = snapUpToHalfHour(searchFrom);
  for (const b of relevant) {
    if (b.start - cursor >= durationMs) {
      return cursor;
    }
    if (b.end > cursor) cursor = snapUpToHalfHour(b.end);
  }
  if (windowEnd - cursor >= durationMs) return cursor;
  return null;
}

/**
 * greedy earliest-fit (§7.4)。
 * - 拘束ブロック (consumes_capacity=true): 09:00〜18:00 JST の営業時間帯内、30 分スナップで
 *   既存拘束ブロック・外部 busy 帯・同一バッチの先行提案 (拘束のみ) と非重複な空きに配置。
 *   1 日の残り時間を超える場合は翌営業日に送る (分割しない)。14 日以内に置けなければ、
 *   このブロック以降は提案を打ち切る (§7.4 手順 6)。
 * - 非拘束ブロック (consumes_capacity=false): 直前の提案ブロック終了時刻から planned_hours 分の
 *   連続スパン。営業時間・重複制約なし (夜間・週末を跨いでよい)。
 */
export function proposePlacements(input: AutoPlaceInput): PlacementProposal[] {
  let cursorJst = isoToJstMs(input.from);
  const busyForBatch: Interval[] = [
    ...input.existingBookedBlocks.map((b) => ({ start: isoToJstMs(b.starts_at), end: isoToJstMs(b.ends_at) })),
    ...input.externalBusy.map((b) => ({ start: isoToJstMs(b.starts_at), end: isoToJstMs(b.ends_at) })),
  ];

  const results: PlacementProposal[] = [];

  for (const target of input.targets) {
    const durationMs = Math.round(target.planned_hours * HOUR_MS);

    if (!target.consumes_capacity) {
      const startJst = cursorJst;
      const endJst = startJst + durationMs;
      results.push({
        block_id: target.block_id,
        starts_at: jstMsToIso(startJst),
        ends_at: jstMsToIso(endJst),
        expected_updated_at: target.updated_at,
      });
      cursorJst = endJst;
      continue;
    }

    let placed = false;
    for (let dayOffset = 0; dayOffset < AUTO_PLACE_MAX_LOOKAHEAD_DAYS; dayOffset++) {
      const dayStart = jstDayStart(cursorJst) + dayOffset * DAY_MS;
      const bizOpen = dayStart + BUSINESS_START_HOUR * HOUR_MS;
      const bizClose = dayStart + BUSINESS_END_HOUR * HOUR_MS;
      const searchFrom = dayOffset === 0 ? Math.max(bizOpen, cursorJst) : bizOpen;
      if (searchFrom >= bizClose) continue;

      const slotStart = findEarliestGapStart(searchFrom, bizClose, durationMs, busyForBatch);
      if (slotStart === null) continue;

      const slotEnd = slotStart + durationMs;
      results.push({
        block_id: target.block_id,
        starts_at: jstMsToIso(slotStart),
        ends_at: jstMsToIso(slotEnd),
        expected_updated_at: target.updated_at,
      });
      busyForBatch.push({ start: slotStart, end: slotEnd });
      cursorJst = slotEnd;
      placed = true;
      break;
    }
    if (!placed) break; // 14 日以内に置けない → このブロック以降は提案なし (§7.4 手順 6)
  }

  return results;
}
