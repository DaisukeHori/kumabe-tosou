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
  minutesToHHMM,
  snapDownToHalfHour,
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
/** 時刻ガター (grid-cols-[48px_...]) の幅。clientToPosition の日境界判定はこの分をオフセットしないと
 *  右へずれる (#95 で発見した既存バグの原因)。 */
const GUTTER_PX = 48;

type DragKind =
  | { kind: "tray"; block: WorkBlockView }
  | { kind: "move"; block: WorkBlockView }
  | { kind: "resize"; block: WorkBlockView }
  /** 空白グリッドの縦ドラッグによる新規ブロック作成 (#95)。block を持たない唯一の kind。
   *  anchorMinutes = pointerdown 時点 (30 分丸め済み) の日内分。日は beginCreate 時のカラム
   *  index に固定し、縦方向のみドラッグを許容する (Google カレンダー同様、日跨ぎ非対応)。 */
  | { kind: "create"; anchorMinutes: number };

type DragState = {
  drag: DragKind;
  pointerId: number;
  /** move の場合: pointerdown 時点で掴んだ位置が block 先頭から何分だったか (スナップ計算の基準) */
  grabOffsetMinutes: number;
  /** 現在のプレビュー位置 (週内の日オフセット 0-6 と、日内開始分) */
  preview: { dayOffset: number; startMinutes: number; durationMinutes: number } | null;
  /**
   * Esc でキャンセル済みか (#95 敵対的レビュー2件目 — create 自身の中に残っていたバグの修正)。
   *
   * 【地雷】Esc 押下時に dragState を直接 null にしてはならない。keydown は pointerup と非同期な
   * 別イベントであり、同期的に null 化すると再レンダー後の handleBlockPointerUp が
   * `!dragState` = 単純クリック分岐に落ち、「create ドラッグ中に既存ブロックの <button> 上へ
   * カーソルを移動して Esc → 動かさず pointerup」という操作順で無関係なブロックの詳細ダイアログが
   * 誤って開いてしまう。この canceled フラグはプレビューの表示のみを止め (レンダー条件で参照)、
   * dragState 自体の null 化は対応する pointerup/pointercancel (commitDrag) に委ねる。これにより
   * handleBlockPointerUp 時点でも dragState は truthy (kind: "create") のままなので、
   * shouldIgnoreBlockPointerUp の move 判定に落ちて無害化される。create 以外では常に未設定。
   */
  canceled?: boolean;
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

/**
 * 空白ドラッグ作成 (#95) の選択範囲を計算する純関数。anchorMinutes (pointerdown 位置) と
 * currentMinutes (現在の pointer 位置。生の連続値でよい — 内部で 30 分境界へ floor/ceil する)
 * から、双方向ドラッグに対応した [startMinutes, startMinutes+durationMinutes) を返す。
 * 上方向ドラッグ (current < anchor) では選択が anchor の初期セル (30 分) を含んだまま上へ伸びる。
 * 最低 30 分・0〜1440 (24:00) にクランプする。
 */
export function createSelection(anchorMinutes: number, currentMinutes: number): { startMinutes: number; durationMinutes: number } {
  const floorToStep = (m: number) => Math.floor(m / ROW_MINUTES) * ROW_MINUTES;
  const ceilToStep = (m: number) => Math.ceil(m / ROW_MINUTES) * ROW_MINUTES;
  const rawStart = Math.min(floorToStep(anchorMinutes), floorToStep(currentMinutes));
  const rawEnd = Math.max(floorToStep(anchorMinutes) + ROW_MINUTES, ceilToStep(currentMinutes));
  const startMinutes = Math.max(0, Math.min(DAY_TOTAL_MIN - ROW_MINUTES, rawStart));
  const endMinutes = Math.max(startMinutes + ROW_MINUTES, Math.min(DAY_TOTAL_MIN, rawEnd));
  return { startMinutes, durationMinutes: endMinutes - startMinutes };
}

/**
 * Esc キー押下時に dragState をキャンセルしてよいかを判定する純関数 (#95 敵対的レビュー指摘の修正)。
 *
 * 【地雷】create 以外 (tray/move/resize) では絶対に true を返してはならない。keydown は pointerup と
 * 非同期な別イベントであり、「ボタンを離す前に Esc」→「別ブロック上でボタンを離す」という操作順が起こると、
 * handleBlockPointerUp の `!dragState` = 単純クリック分岐に落ちて無関係なブロックの詳細ダイアログが誤って
 * 開いてしまう回帰を招く。create は block を持たず、move の対象ブロック識別 (`dragState.drag.block.id`)
 * にも一切関与しないため、この回帰の経路に該当しない唯一の kind である。
 */
export function shouldCancelDragOnEscape(kind: DragKind["kind"]): boolean {
  return kind === "create";
}

/**
 * handleKeyDown (Esc) が dragState に対して実際に行う更新を表す純関数 (#95 敵対的レビュー2件目の
 * 核心修正)。dragState を null にする代わりに canceled フラグを立てるだけに留める。対象外の
 * kind (move/resize/tray) では何もせず同じ dragState をそのまま返す (既存挙動を維持)。
 */
export function applyEscapeCancel(dragState: DragState | null): DragState | null {
  if (!dragState || !shouldCancelDragOnEscape(dragState.drag.kind)) return dragState;
  return { ...dragState, canceled: true };
}

/**
 * commitDrag (create) が onCreateRange を実際に呼んでよいかを判定する純関数。canceled
 * (Esc キャンセル済み) の場合は、その後どれだけポインタが動いていようと何も作成しない —
 * これが #95 敵対的レビュー2件目 (create 自身の中の Esc→pointerup 誤爆) の直接的な防止策。
 */
export function shouldCommitCreate(canceled: boolean | undefined, moved: unknown): boolean {
  return !canceled && Boolean(moved);
}

/**
 * handleBlockPointerUp が「このブロックの pointerup を無視すべきか」を判定する純関数。
 * dragState が truthy である限り (Esc キャンセル済みの create を含む)、move 中の対象ブロック
 * 自身の pointerup でなければ何もしない — 無関係な block 引数でこのハンドラが呼ばれても
 * (トレイ/リサイズ/作成ドラッグ中の他ブロック上でのリリースを含む) 詳細ダイアログを開かないための
 * 安全策そのもの (#95 敵対的レビュー2件目の防止策)。
 */
export function shouldIgnoreBlockPointerUp(drag: DragKind, blockId: string): boolean {
  return drag.kind !== "move" || drag.block.id !== blockId;
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
  /** 空白グリッドの縦ドラッグ確定時 (#95)。CreateBlockDialog を初期値付きで開く配線は calendar-board.tsx 側 */
  onCreateRange: (date: DateOnly, startMinutes: number, durationMinutes: number) => void;
}>(function CalendarGrid(
  { weekStart, blocks, proposals, proposalSourceBlocks, selectedBlockId, onSelectBlock, onOpenDetail, onPlaceBlock, onCreateRange },
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

  function clientToPosition(clientX: number, clientY: number): { dayOffset: number; minutes: number; rawMinutes: number } | null {
    const rect = columnsRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const dayWidth = (rect.width - GUTTER_PX) / 7;
    const dayOffset = Math.min(6, Math.max(0, Math.floor((clientX - rect.left - GUTTER_PX) / dayWidth)));
    const scrollTop = bodyRef.current?.scrollTop ?? 0;
    const yWithinTrack = clientY - rect.top + scrollTop;
    const rawMinutes = (yWithinTrack / ROW_HEIGHT_PX) * ROW_MINUTES;
    const minutes = snapMinutes(rawMinutes);
    return { dayOffset, minutes, rawMinutes };
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
      if (prev.drag.kind === "create") {
        // 日は anchor の日 (押下時のカラム index) に固定。縦方向のみ選択範囲を再計算する。
        const { startMinutes, durationMinutes } = createSelection(prev.drag.anchorMinutes, pos.rawMinutes);
        return { ...prev, preview: { dayOffset: prev.preview.dayOffset, startMinutes, durationMinutes } };
      }
      const duration = prev.drag.block.planned_hours * 60 || ROW_MINUTES;
      const startMinutes = snapMinutes(pos.minutes - prev.grabOffsetMinutes);
      return { ...prev, preview: { dayOffset: pos.dayOffset, startMinutes, durationMinutes: duration } };
    });
  }

  function commitDrag(clientX: number, clientY: number) {
    setDragState((prev) => {
      if (!prev || !prev.preview) return null;
      if (prev.drag.kind === "create") {
        // click-vs-drag 判定 (既存 4px 閾値と同一) — 誤クリックでモーダルが開く事故を防止する
        // (クリック単発での作成は v1 非対応。Issue #95 リスク欄の判断)。canceled (Esc 済み) の
        // 場合は shouldCommitCreate が moved に関わらず false を返すため、ここで何も作成せず
        // dragState を null に戻すだけで終わる (#95 敵対的レビュー2件目の修正)。
        const start = pointerStartRef.current;
        pointerStartRef.current = null;
        const moved = start && (Math.abs(clientX - start.x) > 4 || Math.abs(clientY - start.y) > 4);
        if (!shouldCommitCreate(prev.canceled, moved)) return null;
        const dayDate = addDaysJst(weekStart, prev.preview.dayOffset);
        onCreateRange(dayDate, prev.preview.startMinutes, prev.preview.durationMinutes);
        return null;
      }
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
      commitDrag(e.clientX, e.clientY);
    }
    function handleKeyDown(e: KeyboardEvent) {
      // Esc = create (空白ドラッグ新規作成) のプレビューのみ閉じる。判定は shouldCancelDragOnEscape
      // (このファイル冒頭で定義・export、tests/calendar-grid-selection.test.ts で単体検証済み) に委譲する。
      // 【地雷】ここで setDragState(null) してはならない (#95 敵対的レビュー2件目)。dragState を
      // 直接 null にすると、対応する pointerup より前に再レンダーが走り、handleBlockPointerUp が
      // 「dragState が無い = 単純クリック」分岐に落ちて無関係なブロックの詳細が誤って開く。
      // applyEscapeCancel は dragState を canceled フラグ付きの truthy な値のまま保つ
      // (実際の null 化は commitDrag に委ねる)。
      if (e.key !== "Escape") return;
      if (!dragState || !shouldCancelDragOnEscape(dragState.drag.kind)) return;
      pointerStartRef.current = null;
      setDragState((prev) => applyEscapeCancel(prev));
    }
    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
    document.addEventListener("pointercancel", handleUp);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
      document.removeEventListener("pointercancel", handleUp);
      document.removeEventListener("keydown", handleKeyDown);
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

  /**
   * 空白グリッド (日カラム自身、または背景の 30 分行) の pointerdown を新規ブロック作成ドラッグとして
   * 開始する (#95)。既存札・リサイズハンドル・提案ゴーストからのバブリングは closest() で除外する。
   */
  function beginCreate(dayOffset: number, e: React.PointerEvent) {
    if (e.button !== 0) return; // 左クリックのみ
    if (e.pointerType === "touch") return; // タッチはスクロールと競合するため無効化 (§10.6 裁定の踏襲)
    if ((e.target as HTMLElement).closest("button,[data-proposal]")) return;
    e.preventDefault(); // トレイ onDragStart と同型: テキスト選択抑止
    const pos = clientToPosition(e.clientX, e.clientY);
    const anchor = snapDownToHalfHour(Math.max(0, Math.min(DAY_TOTAL_MIN - ROW_MINUTES, pos ? pos.rawMinutes : 0)));
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    setDragState({
      drag: { kind: "create", anchorMinutes: anchor },
      pointerId: e.pointerId,
      grabOffsetMinutes: 0,
      preview: { dayOffset, startMinutes: anchor, durationMinutes: ROW_MINUTES },
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
    // (1) トレイからの外部ドラッグ (kind='tray') や (2) 下端リサイズ中 (kind='resize') や
    // (4) 空白ドラッグ作成中 (kind='create'。Esc キャンセル済み = canceled:true でも dragState
    // 自体は truthy のまま — #95 敵対的レビュー2件目) に別のブロックの <button> の上でポインタを
    // 離した場合や、(3) リサイズ中に自分自身の <button> の上で離した場合にも、このハンドラが
    // 「無関係な block」引数で呼ばれ得る。click-vs-drag 判定 (setDragState(null) による確定前
    // キャンセル) は「今まさに move 中の対象ブロックそのもの」の pointerup でのみ行う。それ以外は
    // 何もせず、document 側の pointerup リスナー (commitDrag) に確定処理を完全に委ねる —
    // 誤って他ブロックの詳細を開いたりトレイ配置/リサイズ/作成の結果を握り潰したりしないための安全策。
    // 判定は shouldIgnoreBlockPointerUp (このファイル冒頭で定義・export) に委譲する。
    if (shouldIgnoreBlockPointerUp(dragState.drag, block.id)) return;
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
    <div className="overflow-hidden rounded-surface border border-border bg-card shadow-surface">
      <div className="grid grid-cols-[48px_repeat(7,1fr)] border-b border-border bg-muted text-xs">
        <div />
        {Array.from({ length: 7 }, (_, i) => addDaysJst(weekStart, i)).map((d) => (
          <div key={d} className={cn("border-l border-border px-1 py-1.5 text-center font-medium", d === today && "text-primary")}>
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
            <div
              key={dayOffset}
              className="relative border-l border-border"
              onPointerDown={(e) => beginCreate(dayOffset, e)}
            >
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
                        seg.block.id === selectedBlockId ? "border-l-4 border-l-primary" : "border-transparent",
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
                    data-proposal="true"
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
              {dragState?.preview && !dragState.canceled && dragState.preview.dayOffset === dayOffset && (
                <div
                  className="pointer-events-none absolute inset-x-0.5 z-20 overflow-hidden rounded-md border-2 border-dashed border-primary bg-primary/20"
                  style={{
                    top: (dragState.preview.startMinutes / ROW_MINUTES) * ROW_HEIGHT_PX,
                    height: Math.max(ROW_HEIGHT_PX, (dragState.preview.durationMinutes / ROW_MINUTES) * ROW_HEIGHT_PX),
                  }}
                >
                  {dragState.drag.kind === "create" && (
                    <span className="block truncate px-1 py-0.5 text-[10px] font-medium text-primary">
                      {minutesToHHMM(dragState.preview.startMinutes)}〜
                      {minutesToHHMM(dragState.preview.startMinutes + dragState.preview.durationMinutes)}
                    </span>
                  )}
                </div>
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
