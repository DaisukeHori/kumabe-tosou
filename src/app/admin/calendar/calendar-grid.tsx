"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import type { PlacementProposal, WorkBlockView } from "@/modules/scheduling/contracts";

import {
  addDaysJst,
  formatDateOnlyLabel,
  isoPlusMinutes,
  isoToJstShifted,
  jstDateTimeToIso,
  jstMinutesOfDay,
  todayJstDateOnly,
  type DateOnly,
} from "./_ui/jst-time";

/**
 * /admin/calendar 週グリッド (03-scheduling.md §10.2 の DnD 本体)。
 *
 * Pointer Events 自作 DnD (30 分スナップ・移動・下端リサイズ)。DnD ライブラリは追加しない
 * (§1.4 の既存文化を踏襲 — worktree 実装計画書の厳守事項)。
 *
 * 【設計判断】§10.2 の「07:00〜21:00 表示・全日スクロール」は、グリッド自体は 00:00〜24:00
 * (48 行) を保持しつつ、初期スクロール位置を 07:00 に合わせ、ユーザーが上下スクロールすれば
 * 早朝/深夜のブロックも見える、という解釈で実装する (「全日スクロール」の文言が 00:00-24:00 の
 * 存在を前提にしていると読めるため)。これにより非拘束ブロック (乾燥待ち) が夜間・日跨ぎで
 * 配置されても (auto-place.ts の非拘束スパン仕様どおり) グリッド上で欠落せず表示できる
 * (安全側の解釈 — 機能を壊さない)。
 */

/**
 * sync_status → ドット色 (03-scheduling.md §10.2「札の右下に provider アイコン + sync_status
 * ドット」の最小実装 — #54 の小追記)。orphaned は管理画面 (/admin/calendar/connections) 側で
 * のみ扱う状態のため週グリッドのドット表現には含めない (§10.2 表に無い)。
 */
const SYNC_DOT_COLOR: Record<string, string> = {
  synced: "bg-emerald-500",
  pending_push: "bg-amber-500",
  conflict: "bg-orange-500",
  deleted_externally: "bg-destructive",
};

/** ブロックが持つ sync 情報のうち表示優先度が最も高いものを 1 件選ぶ (deleted_externally > conflict > pending_push > synced)。 */
function pickPrimarySync(sync: WorkBlockView["sync"]): WorkBlockView["sync"][number] | null {
  if (sync.length === 0) return null;
  const priority = ["deleted_externally", "conflict", "pending_push", "synced"];
  return [...sync].sort((a, b) => priority.indexOf(a.sync_status) - priority.indexOf(b.sync_status))[0];
}

const ROW_MINUTES = 30;
const ROWS_PER_DAY = (24 * 60) / ROW_MINUTES; // 48
const ROW_HEIGHT_PX = 22;
const DAY_TOTAL_MIN = 24 * 60;
export const GRID_VIEWPORT_HOURS = 14; // 07:00-21:00 相当の初期可視高さ
const VIEWPORT_HEIGHT_PX = GRID_VIEWPORT_HOURS * (60 / ROW_MINUTES) * ROW_HEIGHT_PX;
const INITIAL_SCROLL_HOUR = 7;

type DragKind =
  | { kind: "tray"; block: WorkBlockView }
  | { kind: "move"; block: WorkBlockView }
  | { kind: "resize"; block: WorkBlockView };

type DragState = {
  drag: DragKind;
  pointerId: number;
  /** move の場合: pointerdown 時点で掴んだ位置が block 先頭から何分だったか (スナップ計算の基準) */
  grabOffsetMinutes: number;
  /** 現在のプレビュー位置 (週内の日オフセット 0-6 と、日内開始分) */
  preview: { dayOffset: number; startMinutes: number; durationMinutes: number } | null;
};

export type CalendarGridHandle = {
  /** 未配置トレイの pointerdown をグリッドの DnD エンジンへ橋渡しする (calendar-board.tsx から呼ぶ) */
  beginExternalDrag: (block: WorkBlockView, pointerId: number, clientX: number, clientY: number) => void;
};

type DaySegment = { block: WorkBlockView; dayOffset: number; startMinutes: number; endMinutes: number };
type ProposalSegment = { proposal: PlacementProposal; label: string; color: string; dayOffset: number; startMinutes: number; endMinutes: number };

function segmentsForWeek(blocks: WorkBlockView[], weekStart: DateOnly): DaySegment[] {
  const segments: DaySegment[] = [];
  for (const block of blocks) {
    if (!block.starts_at || !block.ends_at) continue;
    const startMs = new Date(block.starts_at).getTime();
    const endMs = new Date(block.ends_at).getTime();
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const dayDate = addDaysJst(weekStart, dayOffset);
      const dayStartMs = new Date(`${dayDate}T00:00:00+09:00`).getTime();
      const dayEndMs = dayStartMs + DAY_TOTAL_MIN * 60_000;
      const segStart = Math.max(startMs, dayStartMs);
      const segEnd = Math.min(endMs, dayEndMs);
      if (segEnd <= segStart) continue;
      segments.push({
        block,
        dayOffset,
        startMinutes: (segStart - dayStartMs) / 60_000,
        endMinutes: (segEnd - dayStartMs) / 60_000,
      });
    }
  }
  return segments;
}

function proposalSegmentsForWeek(
  proposals: PlacementProposal[],
  blocksById: Map<string, WorkBlockView>,
  weekStart: DateOnly,
): ProposalSegment[] {
  const segments: ProposalSegment[] = [];
  for (const proposal of proposals) {
    const source = blocksById.get(proposal.block_id);
    const startMs = new Date(proposal.starts_at).getTime();
    const endMs = new Date(proposal.ends_at).getTime();
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const dayDate = addDaysJst(weekStart, dayOffset);
      const dayStartMs = new Date(`${dayDate}T00:00:00+09:00`).getTime();
      const dayEndMs = dayStartMs + DAY_TOTAL_MIN * 60_000;
      const segStart = Math.max(startMs, dayStartMs);
      const segEnd = Math.min(endMs, dayEndMs);
      if (segEnd <= segStart) continue;
      segments.push({
        proposal,
        label: source?.title || source?.work_type_label || "提案",
        color: source?.color ?? "#999999",
        dayOffset,
        startMinutes: (segStart - dayStartMs) / 60_000,
        endMinutes: (segEnd - dayStartMs) / 60_000,
      });
    }
  }
  return segments;
}

function snapMinutes(minutes: number): number {
  return Math.min(DAY_TOTAL_MIN - ROW_MINUTES, Math.max(0, Math.round(minutes / ROW_MINUTES) * ROW_MINUTES));
}

export const CalendarGrid = forwardRef<CalendarGridHandle, {
  weekStart: DateOnly;
  blocks: WorkBlockView[];
  proposals: PlacementProposal[];
  proposalSourceBlocks: WorkBlockView[];
  selectedBlockId: string | null;
  onSelectBlock: (id: string) => void;
  onOpenDetail: (id: string) => void;
  onPlaceBlock: (blockId: string, startsAtIso: string, endsAtIso: string, expectedUpdatedAt: string) => void;
}>(function CalendarGrid(
  { weekStart, blocks, proposals, proposalSourceBlocks, selectedBlockId, onSelectBlock, onOpenDetail, onPlaceBlock },
  ref,
) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const columnsRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  // 初期スクロール位置を 07:00 に合わせる (§10.2「07:00〜21:00 表示・全日スクロール」)
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = INITIAL_SCROLL_HOUR * (60 / ROW_MINUTES) * ROW_HEIGHT_PX;
    }
  }, []);

  function clientToPosition(clientX: number, clientY: number): { dayOffset: number; minutes: number } | null {
    const rect = columnsRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const dayWidth = rect.width / 7;
    const dayOffset = Math.min(6, Math.max(0, Math.floor((clientX - rect.left) / dayWidth)));
    const scrollTop = bodyRef.current?.scrollTop ?? 0;
    const yWithinTrack = clientY - rect.top + scrollTop;
    const minutes = snapMinutes((yWithinTrack / ROW_HEIGHT_PX) * ROW_MINUTES);
    return { dayOffset, minutes };
  }

  function updatePreview(clientX: number, clientY: number) {
    setDragState((prev) => {
      if (!prev || !prev.preview) return prev;
      const pos = clientToPosition(clientX, clientY);
      if (!pos) return prev;
      if (prev.drag.kind === "resize") {
        const duration = Math.max(ROW_MINUTES, pos.minutes - prev.preview.startMinutes);
        return { ...prev, preview: { ...prev.preview, durationMinutes: duration } };
      }
      const duration = prev.drag.block.planned_hours * 60 || ROW_MINUTES;
      const startMinutes = snapMinutes(pos.minutes - prev.grabOffsetMinutes);
      return { ...prev, preview: { dayOffset: pos.dayOffset, startMinutes, durationMinutes: duration } };
    });
  }

  function commitDrag() {
    setDragState((prev) => {
      if (!prev || !prev.preview) return null;
      const dayDate = addDaysJst(weekStart, prev.preview.dayOffset);
      const startsAt = jstDateTimeToIso(dayDate, 0, 0);
      const startsAtWithMinutes = isoPlusMinutes(startsAt, prev.preview.startMinutes);
      const endsAt = isoPlusMinutes(startsAtWithMinutes, prev.preview.durationMinutes);
      onPlaceBlock(prev.drag.block.id, startsAtWithMinutes, endsAt, prev.drag.block.updated_at);
      return null;
    });
  }

  useEffect(() => {
    if (!dragState) return;
    function handleMove(e: PointerEvent) {
      if (e.pointerId !== dragState?.pointerId) return;
      updatePreview(e.clientX, e.clientY);
    }
    function handleUp(e: PointerEvent) {
      if (e.pointerId !== dragState?.pointerId) return;
      commitDrag();
    }
    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
    document.addEventListener("pointercancel", handleUp);
    return () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
      document.removeEventListener("pointercancel", handleUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragState?.pointerId]);

  useImperativeHandle(ref, () => ({
    beginExternalDrag(block, pointerId, clientX, clientY) {
      const pos = clientToPosition(clientX, clientY) ?? { dayOffset: 0, minutes: 9 * 60 };
      setDragState({
        drag: { kind: "tray", block },
        pointerId,
        grabOffsetMinutes: 0,
        preview: { dayOffset: pos.dayOffset, startMinutes: pos.minutes, durationMinutes: Math.max(ROW_MINUTES, block.planned_hours * 60) },
      });
    },
  }));

  function beginMove(block: WorkBlockView, e: React.PointerEvent) {
    if (!block.starts_at) return;
    const pos = clientToPosition(e.clientX, e.clientY);
    const startMinutes = jstMinutesOfDay(block.starts_at);
    const grabOffsetMinutes = pos ? pos.minutes - startMinutes : 0;
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    onSelectBlock(block.id);
    setDragState({
      drag: { kind: "move", block },
      pointerId: e.pointerId,
      grabOffsetMinutes,
      preview: {
        dayOffset: weekdayOffset(weekStart, block.starts_at),
        startMinutes,
        durationMinutes: block.planned_hours * 60 || ROW_MINUTES,
      },
    });
  }

  function beginResize(block: WorkBlockView, e: React.PointerEvent) {
    e.stopPropagation();
    if (!block.starts_at || !block.ends_at) return;
    const startMinutes = jstMinutesOfDay(block.starts_at);
    const endMinutes = jstMinutesOfDay(block.ends_at);
    setDragState({
      drag: { kind: "resize", block },
      pointerId: e.pointerId,
      grabOffsetMinutes: 0,
      preview: {
        dayOffset: weekdayOffset(weekStart, block.starts_at),
        startMinutes,
        durationMinutes: Math.max(ROW_MINUTES, endMinutes - startMinutes),
      },
    });
  }

  function handleBlockPointerUp(block: WorkBlockView, e: React.PointerEvent) {
    if (!dragState) {
      // ドラッグが一度も発生していない (pointerdown 直後に pointerup) = クリックとして詳細を開く
      onSelectBlock(block.id);
      onOpenDetail(block.id);
      return;
    }
    // 【地雷】pointerup はリリース時にカーソル直下にある要素へネイティブにバブルするため、
    // (1) トレイからの外部ドラッグ (kind='tray') や (2) 下端リサイズ中 (kind='resize') に
    // 別のブロックの <button> の上でポインタを離した場合や、(3) リサイズ中に自分自身の
    // <button> の上で離した場合にも、このハンドラが「無関係な block」引数で呼ばれ得る。
    // click-vs-drag 判定 (setDragState(null) による確定前キャンセル) は「今まさに move 中の
    // 対象ブロックそのもの」の pointerup でのみ行う。それ以外は何もせず、document 側の
    // pointerup リスナー (commitDrag) に確定処理を完全に委ねる — 誤って他ブロックの詳細を開いたり
    // トレイ配置/リサイズの結果を握り潰したりしないための安全策。
    if (dragState.drag.kind !== "move" || dragState.drag.block.id !== block.id) return;
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    const moved = start && (Math.abs(e.clientX - start.x) > 4 || Math.abs(e.clientY - start.y) > 4);
    if (!moved) {
      setDragState(null);
      onSelectBlock(block.id);
      onOpenDetail(block.id);
    }
  }

  const segments = segmentsForWeek(blocks, weekStart);
  const proposalBlocksById = new Map(proposalSourceBlocks.map((b) => [b.id, b]));
  const proposalSegments = proposalSegmentsForWeek(proposals, proposalBlocksById, weekStart);
  const today = todayJstDateOnly();

  return (
    <div className="overflow-hidden rounded-xl border border-admin-card-border bg-card shadow-md">
      <div className="grid grid-cols-[48px_repeat(7,1fr)] border-b border-border bg-admin-canvas-deep/60 text-xs">
        <div />
        {Array.from({ length: 7 }, (_, i) => addDaysJst(weekStart, i)).map((d) => (
          <div key={d} className={cn("border-l border-border px-1 py-1.5 text-center font-medium", d === today && "text-soul")}>
            {formatDateOnlyLabel(d)}
          </div>
        ))}
      </div>
      <div ref={bodyRef} className="relative overflow-y-auto" style={{ height: VIEWPORT_HEIGHT_PX }}>
        <div ref={columnsRef} className="relative grid grid-cols-[48px_repeat(7,1fr)]" style={{ height: ROWS_PER_DAY * ROW_HEIGHT_PX }}>
          {/* 時刻ガター */}
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="absolute right-1 -translate-y-1/2 text-[10px] text-muted-foreground"
                style={{ top: h * 2 * ROW_HEIGHT_PX }}
              >
                {String(h).padStart(2, "0")}:00
              </div>
            ))}
          </div>
          {Array.from({ length: 7 }, (_, dayOffset) => (
            <div key={dayOffset} className="relative border-l border-border">
              {Array.from({ length: ROWS_PER_DAY }, (_, row) => (
                <div
                  key={row}
                  className={cn("border-b border-border/50", row % 2 === 1 && "border-b-border")}
                  style={{ height: ROW_HEIGHT_PX }}
                />
              ))}
              {segments
                .filter((s) => s.dayOffset === dayOffset)
                .map((seg) => {
                  // sync 状態ドット (03-scheduling.md §10.2「札の右下に provider アイコン +
                  // sync_status ドット」— #54 の小追記。calendar-board.tsx 経由でこの
                  // CalendarGrid が実データを描画する箇所)。
                  const primarySync = pickPrimarySync(seg.block.sync);
                  const hasDeletedExternally = seg.block.sync.some((s) => s.sync_status === "deleted_externally");
                  return (
                    <button
                      key={`${seg.block.id}-${seg.dayOffset}`}
                      type="button"
                      onPointerDown={(e) => beginMove(seg.block, e)}
                      onPointerUp={(e) => handleBlockPointerUp(seg.block, e)}
                      onFocus={() => onSelectBlock(seg.block.id)}
                      onKeyDown={(e) => {
                        // Enter/Space によるキーボード操作専用の経路 (C12: Tab でフォーカスした
                        // ブロックを選択・詳細を開けること)。ネイティブ <button> の Enter/Space は
                        // デフォルトで click を合成するが、resize ハンドル (button の子要素) への
                        // pointerdown → button 内での pointerup でも同じ合成 click が発火し得るため
                        // (地雷: handleBlockPointerUp の click-vs-drag 判定を素通りしてしまう)、
                        // onClick は使わずここで preventDefault してキーボード専用に閉じる。
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelectBlock(seg.block.id);
                          onOpenDetail(seg.block.id);
                        }
                      }}
                      title={hasDeletedExternally ? "外部カレンダー側で削除されています。クリックして解決してください。" : undefined}
                      className={cn(
                        "absolute inset-x-0.5 z-10 overflow-hidden rounded-md border px-1 py-0.5 text-left text-[11px] leading-tight shadow-sm",
                        seg.block.id === selectedBlockId ? "border-l-4 border-l-soul" : "border-transparent",
                        !seg.block.consumes_capacity && "opacity-60",
                        hasDeletedExternally && "border-2 border-dashed border-destructive",
                      )}
                      style={{
                        top: (seg.startMinutes / ROW_MINUTES) * ROW_HEIGHT_PX,
                        height: Math.max(ROW_HEIGHT_PX, ((seg.endMinutes - seg.startMinutes) / ROW_MINUTES) * ROW_HEIGHT_PX),
                        backgroundColor: seg.block.consumes_capacity ? `${seg.block.color}cc` : undefined,
                        backgroundImage: !seg.block.consumes_capacity
                          ? `repeating-linear-gradient(45deg, ${seg.block.color}55, ${seg.block.color}55 4px, transparent 4px, transparent 8px)`
                          : undefined,
                        color: seg.block.consumes_capacity ? "#fff" : undefined,
                      }}
                    >
                      <span className="block truncate font-medium">
                        {hasDeletedExternally && "⚠ "}
                        {!seg.block.consumes_capacity && "⏳ "}
                        {seg.block.title || seg.block.work_type_label}
                      </span>
                      <span className="block truncate opacity-80">{seg.block.planned_hours}h</span>
                      {primarySync && (
                        <span
                          aria-hidden="true"
                          className={cn(
                            "absolute right-0.5 bottom-0.5 size-1.5 rounded-full border border-white/60",
                            SYNC_DOT_COLOR[primarySync.sync_status] ?? "bg-muted-foreground",
                          )}
                        />
                      )}
                      {seg.block.status === "scheduled" && seg.block.consumes_capacity && (
                        <div
                          role="presentation"
                          onPointerDown={(e) => beginResize(seg.block, e)}
                          className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                        />
                      )}
                    </button>
                  );
                })}
              {proposalSegments
                .filter((s) => s.dayOffset === dayOffset)
                .map((seg, i) => (
                  <div
                    key={`proposal-${seg.proposal.block_id}-${i}`}
                    className="absolute inset-x-0.5 z-0 overflow-hidden rounded-md border-2 border-dashed px-1 py-0.5 text-[11px] leading-tight opacity-70"
                    style={{
                      top: (seg.startMinutes / ROW_MINUTES) * ROW_HEIGHT_PX,
                      height: Math.max(ROW_HEIGHT_PX, ((seg.endMinutes - seg.startMinutes) / ROW_MINUTES) * ROW_HEIGHT_PX),
                      borderColor: seg.color,
                      backgroundColor: `${seg.color}33`,
                    }}
                  >
                    <span className="block truncate font-medium">{seg.label}</span>
                  </div>
                ))}
              {dragState?.preview && dragState.preview.dayOffset === dayOffset && (
                <div
                  className="pointer-events-none absolute inset-x-0.5 z-20 rounded-md border-2 border-dashed border-soul bg-soul/20"
                  style={{
                    top: (dragState.preview.startMinutes / ROW_MINUTES) * ROW_HEIGHT_PX,
                    height: Math.max(ROW_HEIGHT_PX, (dragState.preview.durationMinutes / ROW_MINUTES) * ROW_HEIGHT_PX),
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

function weekdayOffset(weekStart: DateOnly, iso: string): number {
  const shifted = isoToJstShifted(iso);
  const dateOnly = `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
  const diffMs = new Date(`${dateOnly}T00:00:00Z`).getTime() - new Date(`${weekStart}T00:00:00Z`).getTime();
  return Math.round(diffMs / (24 * 60 * 60 * 1000));
}
