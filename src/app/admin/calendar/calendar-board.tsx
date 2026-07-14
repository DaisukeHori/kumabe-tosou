"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Paged } from "@/modules/platform/contracts";
import type { PlacementProposal, WeeklyCapacity, WorkBlockView, WorkTypeRow } from "@/modules/scheduling/contracts";

import { updateDealStageAction } from "@/app/admin/deals/actions";

import {
  applyPlacementProposalsAction,
  getBacklogBlocksAction,
  getCalendarRangeAction,
  getWeeklyCapacityAction,
  placeBlockAction,
  proposeInProductionAction,
  proposePlacementAction,
} from "./actions";
import { BlockDetailDialog } from "./block-detail-dialog";
import { CalendarGrid, type CalendarGridHandle } from "./calendar-grid";
import { CreateBlockDialog } from "./create-block-dialog";
import { MobileDayView } from "./mobile-day-view";
import {
  addDaysJst,
  formatDateOnlyLabel,
  isOnJstDate,
  isSameJstMonth,
  isoPlusMinutes,
  isoToJstParts,
  jstWeekday,
  mondayOfWeekJst,
  monthGridDays,
  monthRangeIso,
  todayJstDateOnly,
  weekRangeIso,
  type DateOnly,
} from "./_ui/jst-time";

type ViewMode = "week" | "month";

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/**
 * /admin/calendar のクライアント側オーケストレーター (03-scheduling.md §10.2)。
 * 週/月ビュー切替・ツールバー・未配置トレイ・キャパチップ・ブロック詳細 Dialog・
 * 自動配置プレビュー・キーボード操作 (§10.2 の表) をここに集約する。
 *
 * 【DOM 順序の設計判断】§10.2 のキーボード表は「Tab | 論理順フォーカス
 * (ツールバー→トレイ→グリッド→Dialog)」を要求する一方、同じ §10.2 のワイヤーフレームは
 * 未配置トレイをグリッドの右サイドに描く。Tab 移動は常に DOM 順で決まり CSS の
 * `order` では変わらない (視覚順と Tab 順を一致させない設計は WCAG 的にも非推奨) ため、
 * DOM 上はトレイをグリッドより先に置きつつ、Tailwind の `order-*` で視覚上はグリッドを左・
 * トレイを右に配置する (両要件を安全側で両立させる判断)。
 */
export function CalendarBoard({
  initialWeekStart,
  initialBlocks,
  initialBacklog,
  initialCapacity,
  workTypes,
  initialCreateDeal = null,
}: {
  initialWeekStart: DateOnly;
  initialBlocks: WorkBlockView[];
  initialBacklog: Paged<WorkBlockView>;
  initialCapacity: WeeklyCapacity | null;
  workTypes: WorkTypeRow[];
  /** `?create_deal_id=` の解決結果 (Issue #96 設計 §D)。非 null なら「ブロックを作る」ダイアログを
   *  該当案件セット済みで初期オープンする。一度きりの seed であり、マウント時に
   *  `createDealSeed` state へ写し取った後は URL からも剥がす (下記 useEffect) —
   *  ツールバーの汎用「ブロックを作る」ボタンや F5 再読み込みで何度も蘇らせない。 */
  initialCreateDeal?: { id: string; label: string } | null;
}) {
  const router = useRouter();
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [weekStart, setWeekStart] = useState<DateOnly>(initialWeekStart);
  const [monthAnchor, setMonthAnchor] = useState<DateOnly>(initialWeekStart);
  const [mobileDate, setMobileDate] = useState<DateOnly>(todayJstDateOnly());
  const [isMobile, setIsMobile] = useState(false);

  const [blocks, setBlocks] = useState<WorkBlockView[]>(initialBlocks);
  const [backlog, setBacklog] = useState<WorkBlockView[]>(initialBacklog.items);
  const [backlogCursor, setBacklogCursor] = useState<string | null>(initialBacklog.next_cursor);
  const [capacity, setCapacity] = useState<WeeklyCapacity | null>(initialCapacity);

  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [focusRegion, setFocusRegion] = useState<"tray" | "grid">("tray");
  const [trayFocusIndex, setTrayFocusIndex] = useState(0);

  const [detailBlockId, setDetailBlockId] = useState<string | null>(null);
  // 初期 state 設定のみで自動オープンを実装する (#61 の教訓を踏襲: useEffect での後追いオープンは
  // 他 Dialog のアンマウント地雷を踏みやすい — calendar-board.tsx はこれまでも #53/#54/#55/#61 が
  // 重ねて触った衝突多発ファイル。Issue #96 設計 §リスク4)。
  const [createOpen, setCreateOpen] = useState(initialCreateDeal !== null);
  // 深いリンク seed の「一度きり」実体。マウント時の initialCreateDeal を写し取るだけで、
  // 以降は Dialog が閉じるたび (キャンセル/作成成功いずれも) null に戻す (下記 onOpenChange)。
  // ツールバーの汎用ボタンで再オープンしたときに前回の案件が残り続けるレビュー指摘の修正。
  const [createDealSeed, setCreateDealSeed] = useState(initialCreateDeal);
  const [proposals, setProposals] = useState<PlacementProposal[]>([]);
  const [isBusy, setIsBusy] = useState(false);

  const gridRef = useRef<CalendarGridHandle>(null);
  const didMountRef = useRef(false);

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 767px)");
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  // 深いリンク seed を消費したら ?create_deal_id= を URL から剥がす。残したままだと F5 再読み込みの
  // たびにダイアログが自動再オープンしてしまう (レビュー指摘)。マウント時 1 回のみでよい —
  // initialCreateDeal はマウント時点の値を createDealSeed / createOpen の初期値として
  // 既に消費済みなので、以降その値が変化しても再実行する必要はない。
  useEffect(() => {
    if (initialCreateDeal) {
      router.replace("/admin/calendar", { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadRange = useCallback(async () => {
    const { fromIso, toIso } = viewMode === "week" ? weekRangeIso(weekStart) : monthRangeIso(monthAnchor);
    const result = await getCalendarRangeAction({ from: fromIso, to: toIso });
    if (result.ok) setBlocks(result.value);
    else toast.error(`カレンダーの取得に失敗しました (${result.code})`);
  }, [viewMode, weekStart, monthAnchor]);

  const loadBacklog = useCallback(async () => {
    const result = await getBacklogBlocksAction({ cursor: null, limit: 50 });
    if (result.ok) {
      setBacklog(result.value.items);
      setBacklogCursor(result.value.next_cursor);
    }
  }, []);

  const loadMoreBacklog = useCallback(async () => {
    if (!backlogCursor) return;
    const result = await getBacklogBlocksAction({ cursor: backlogCursor, limit: 50 });
    if (result.ok) {
      setBacklog((prev) => [...prev, ...result.value.items]);
      setBacklogCursor(result.value.next_cursor);
    }
  }, [backlogCursor]);

  const loadCapacity = useCallback(async () => {
    const result = await getWeeklyCapacityAction(mondayOfWeekJst(todayJstDateOnly()));
    if (result.ok) setCapacity(result.value);
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadRange(), loadBacklog(), loadCapacity()]);
  }, [loadRange, loadBacklog, loadCapacity]);

  // 初回マウント時は Server Component が渡した初期データをそのまま使う (二重フェッチ回避)。
  // viewMode/weekStart/monthAnchor が変わったとき (◀/▶/T/W/M/月ビューの日クリック) のみ再取得する。
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    void loadRange();
  }, [loadRange]);

  /**
   * ブロック配置成功後の「製作中に進めますか?」提案 (実装計画書 issue-61.md 成果物5、
   * 00-overview §6.2 行2/03-scheduling §5.4 行2)。適用は既存 `updateDealStageAction`
   * (`@/app/admin/deals/actions`、#44 実装済み) をそのまま呼ぶ — 新規 Action は作らない。
   * E602/E103 は情報表示のみに留め、ブロック配置自体をロールバックしない
   * (issueDocumentAction の dealStageSkippedReason と同じ考え方)。
   */
  function proposeInProductionIfNeeded(dealId: string | null) {
    if (!dealId) return;
    void proposeInProductionAction(dealId).then((propose) => {
      if (!propose.ok || !propose.value.propose) return;
      toast("この案件、製作中に進めますか?", {
        action: {
          label: "はい",
          onClick: () => {
            void updateDealStageAction(dealId, "in_production", propose.value.dealUpdatedAt!).then((r) => {
              if (!r.ok) {
                toast.error(r.detail ?? `変更できませんでした (${r.code})`);
                return;
              }
              toast.success("製作中にしました。");
              router.refresh();
            });
          },
        },
      });
    });
  }

  async function handlePlace(blockId: string, startsAtIso: string, endsAtIso: string, expectedUpdatedAt: string) {
    // backlog に存在する = 初回配置 (calendar-grid の onPlaceBlock / MobileDayView の onPlace も
    // 同じ handlePlace を通るためここ 1 箇所への追記で全経路をカバーできる。movePlacedBlock 経由の
    // 再配置は backlog に該当ブロックが無いため自然に対象外になる — 追加ガード不要)。
    const backlogEntry = backlog.find((b) => b.id === blockId);
    setIsBusy(true);
    const result = await placeBlockAction(blockId, startsAtIso, endsAtIso, expectedUpdatedAt);
    setIsBusy(false);
    if (!result.ok) {
      toast.error(result.detail ?? `配置に失敗しました (${result.code})`);
      return;
    }
    await refreshAll();
    if (backlogEntry) proposeInProductionIfNeeded(backlogEntry.deal_id);
  }

  async function movePlacedBlock(block: WorkBlockView, deltaMinutes: number) {
    if (!block.starts_at || !block.ends_at) return;
    await handlePlace(
      block.id,
      isoPlusMinutes(block.starts_at, deltaMinutes),
      isoPlusMinutes(block.ends_at, deltaMinutes),
      block.updated_at,
    );
  }

  function jumpToday() {
    const today = todayJstDateOnly();
    setWeekStart(mondayOfWeekJst(today));
    setMonthAnchor(today);
    setMobileDate(today);
  }

  async function handleAutoPlace() {
    if (backlog.length === 0) {
      toast.info("未配置のブロックがありません。");
      return;
    }
    const result = await proposePlacementAction({ block_ids: backlog.slice(0, 50).map((b) => b.id), from: new Date().toISOString() });
    if (!result.ok) {
      toast.error(result.detail ?? `提案の生成に失敗しました (${result.code})`);
      return;
    }
    if (result.value.length === 0) {
      toast.info("配置できる候補が見つかりませんでした。");
      return;
    }
    setProposals(result.value);
  }

  async function handleApplyProposals() {
    setIsBusy(true);
    const result = await applyPlacementProposalsAction(proposals);
    setIsBusy(false);
    setProposals([]);
    if (!result.ok) {
      toast.error(result.detail ?? `確定に失敗しました (${result.code})`);
      await refreshAll();
      return;
    }
    toast.success(`${result.value.applied} 件を配置しました。`);
    await refreshAll();
  }

  // ---- キーボード操作 (§10.2 の表を網羅) ----
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (detailBlockId || createOpen) return; // Dialog は自身の onKeyDown (Cmd+S) / base-ui の Esc に委ねる
      if (isEditableTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (e.shiftKey) {
          if (focusRegion !== "grid" || !selectedBlockId) return;
          const block = blocks.find((b) => b.id === selectedBlockId);
          if (!block?.starts_at || !block.ends_at) return;
          e.preventDefault();
          void movePlacedBlock(block, e.key === "ArrowUp" ? -30 : 30);
        } else {
          if (focusRegion !== "tray" || backlog.length === 0) return;
          e.preventDefault();
          setTrayFocusIndex((i) => (e.key === "ArrowUp" ? Math.max(i - 1, 0) : Math.min(i + 1, backlog.length - 1)));
        }
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (focusRegion !== "grid" || !selectedBlockId) return;
        const block = blocks.find((b) => b.id === selectedBlockId);
        if (!block?.starts_at || !block.ends_at) return;
        e.preventDefault();
        void movePlacedBlock(block, e.key === "ArrowLeft" ? -24 * 60 : 24 * 60);
        return;
      }
      if (e.key === "Enter") {
        if (focusRegion === "tray" && backlog[trayFocusIndex]) {
          e.preventDefault();
          setDetailBlockId(backlog[trayFocusIndex].id);
        } else if (focusRegion === "grid" && selectedBlockId) {
          e.preventDefault();
          setDetailBlockId(selectedBlockId);
        }
        return;
      }
      if (e.key === "Escape") {
        if (proposals.length > 0) {
          e.preventDefault();
          setProposals([]);
        }
        return;
      }
      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        jumpToday();
        return;
      }
      if (e.key === "w" || e.key === "W") {
        e.preventDefault();
        setViewMode("week");
        return;
      }
      if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        setViewMode("month");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailBlockId, createOpen, focusRegion, selectedBlockId, blocks, backlog, trayFocusIndex, proposals]);

  const detailBlock = useMemo(
    () => blocks.find((b) => b.id === detailBlockId) ?? backlog.find((b) => b.id === detailBlockId) ?? null,
    [blocks, backlog, detailBlockId],
  );

  const monthDays = useMemo(() => monthGridDays(monthAnchor), [monthAnchor]);
  const mobileDayBlocks = useMemo(() => blocks.filter((b) => b.starts_at && isOnJstDate(b.starts_at, mobileDate)), [blocks, mobileDate]);

  // モバイル日ビューは PC の週グリッドと別レンジ (当日のみ) を必要とするため、日付が変わったら取得し直す
  useEffect(() => {
    if (!isMobile) return;
    const from = `${mobileDate}T00:00:00+09:00`;
    const to = `${addDaysJst(mobileDate, 1)}T00:00:00+09:00`;
    void (async () => {
      const result = await getCalendarRangeAction({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
      if (result.ok) setBlocks(result.value);
    })();
  }, [isMobile, mobileDate]);

  if (isMobile) {
    return (
      <div className="space-y-4">
        <MobileDayView
          date={mobileDate}
          onDateChange={setMobileDate}
          dayBlocks={mobileDayBlocks}
          backlog={backlog}
          capacity={capacity}
          onOpenDetail={setDetailBlockId}
          onPlace={handlePlace}
        />
        <BlockDetailDialog
          block={detailBlock}
          open={detailBlockId !== null}
          onOpenChange={(open) => !open && setDetailBlockId(null)}
          workTypes={workTypes}
          onChanged={() => {
            void refreshAll();
            void (async () => {
              const from = `${mobileDate}T00:00:00+09:00`;
              const to = `${addDaysJst(mobileDate, 1)}T00:00:00+09:00`;
              const result = await getCalendarRangeAction({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
              if (result.ok) setBlocks(result.value);
            })();
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge variant={capacity && capacity.remaining_hours < 0 ? "destructive" : "outline"}>
            今週あと {capacity ? capacity.remaining_hours.toFixed(1) : "-"} 時間
          </Badge>
          <Button type="button" onClick={() => setCreateOpen(true)}>
            ブロックを作る
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => (viewMode === "week" ? setWeekStart((d) => addDaysJst(d, -7)) : setMonthAnchor((d) => addDaysJst(mondayOfWeekJst(d), -28)))}
          >
            ◀ 前{viewMode === "week" ? "週" : "月"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={jumpToday}>
            今日 (T)
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => (viewMode === "week" ? setWeekStart((d) => addDaysJst(d, 7)) : setMonthAnchor((d) => addDaysJst(mondayOfWeekJst(d), 28)))}
          >
            翌{viewMode === "week" ? "週" : "月"} ▶
          </Button>
          <span className="text-sm text-muted-foreground">
            {viewMode === "week" ? `${formatDateOnlyLabel(weekStart)} 〜 ${formatDateOnlyLabel(addDaysJst(weekStart, 6))}` : monthAnchor.slice(0, 7)}
          </span>
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
            <TabsList>
              <TabsTrigger value="week">週 (W)</TabsTrigger>
              <TabsTrigger value="month">月 (M)</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {proposals.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-soul/40 bg-soul/5 px-3 py-2">
          <span className="text-sm">自動配置の提案: {proposals.length} 件</span>
          <Button type="button" size="sm" disabled={isBusy} onClick={handleApplyProposals}>
            確定
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setProposals([])}>
            やめる (Esc)
          </Button>
        </div>
      )}

      {viewMode === "week" ? (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <BacklogTray
            className="order-2 shrink-0 lg:w-64"
            backlog={backlog}
            focusIndex={trayFocusIndex}
            hasMore={backlogCursor !== null}
            onLoadMore={loadMoreBacklog}
            onFocusIndexChange={(i) => {
              setTrayFocusIndex(i);
              setFocusRegion("tray");
            }}
            onOpenDetail={(id) => {
              setFocusRegion("tray");
              setDetailBlockId(id);
            }}
            onAutoPlace={handleAutoPlace}
            onDragStart={(block, e) => {
              e.preventDefault();
              gridRef.current?.beginExternalDrag(block, e.pointerId, e.clientX, e.clientY);
            }}
          />
          <div className="order-1 min-w-0 flex-1" onFocus={() => setFocusRegion("grid")}>
            <CalendarGrid
              ref={gridRef}
              weekStart={weekStart}
              blocks={blocks}
              proposals={proposals}
              proposalSourceBlocks={backlog}
              selectedBlockId={selectedBlockId}
              onSelectBlock={(id) => {
                setSelectedBlockId(id);
                setFocusRegion("grid");
              }}
              onOpenDetail={(id) => setDetailBlockId(id)}
              onPlaceBlock={handlePlace}
            />
          </div>
        </div>
      ) : (
        <MonthView
          days={monthDays}
          monthAnchor={monthAnchor}
          blocks={blocks}
          onSelectDay={(d) => {
            setWeekStart(mondayOfWeekJst(d));
            setViewMode("week");
          }}
        />
      )}

      <BlockDetailDialog
        block={detailBlock}
        open={detailBlockId !== null}
        onOpenChange={(open) => !open && setDetailBlockId(null)}
        workTypes={workTypes}
        onChanged={() => void refreshAll()}
      />
      <CreateBlockDialog
        open={createOpen}
        onOpenChange={(next) => {
          setCreateOpen(next);
          // 閉じたら seed を使い切ったものとして破棄する (一度きりの初期値、レビュー指摘の修正)。
          if (!next) setCreateDealSeed(null);
        }}
        workTypes={workTypes}
        onCreated={() => void refreshAll()}
        initialDeal={createDealSeed}
      />
    </div>
  );
}

function BacklogTray({
  className,
  backlog,
  focusIndex,
  hasMore,
  onLoadMore,
  onFocusIndexChange,
  onOpenDetail,
  onAutoPlace,
  onDragStart,
}: {
  className?: string;
  backlog: WorkBlockView[];
  focusIndex: number;
  hasMore: boolean;
  onLoadMore: () => void;
  onFocusIndexChange: (index: number) => void;
  onOpenDetail: (id: string) => void;
  onAutoPlace: () => void;
  onDragStart: (block: WorkBlockView, e: React.PointerEvent) => void;
}) {
  return (
    <div className={className}>
      <div className="rounded-xl border border-admin-card-border bg-card p-3 shadow-md">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-medium">未配置 ({backlog.length})</p>
          <Button type="button" size="sm" variant="outline" onClick={onAutoPlace} disabled={backlog.length === 0}>
            自動で並べる
          </Button>
        </div>
        {backlog.length === 0 ? (
          <p className="text-sm text-muted-foreground">未配置のブロックはありません。</p>
        ) : (
          <div
            role="listbox"
            aria-label="未配置トレイ"
            tabIndex={0}
            onFocus={() => onFocusIndexChange(focusIndex)}
            className="max-h-[28rem] space-y-1 overflow-y-auto outline-none"
          >
            {backlog.map((block, index) => (
              <div
                key={block.id}
                role="option"
                aria-selected={index === focusIndex}
                tabIndex={-1}
                onPointerDown={(e) => onDragStart(block, e)}
                onClick={() => {
                  onFocusIndexChange(index);
                  onOpenDetail(block.id);
                }}
                onMouseEnter={() => onFocusIndexChange(index)}
                className={`cursor-grab rounded-md border px-2 py-1.5 text-xs ${
                  index === focusIndex ? "border-l-4 border-l-soul bg-soul/5" : "border-l-4 border-l-transparent hover:bg-muted/60"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: block.color }} />
                  <span className="truncate font-medium">
                    {!block.consumes_capacity && "⏳ "}
                    {block.title || block.work_type_label}
                  </span>
                </div>
                <span className="text-muted-foreground">{block.planned_hours}h</span>
              </div>
            ))}
          </div>
        )}
        {hasMore && (
          <Button type="button" variant="ghost" size="sm" className="mt-2 w-full" onClick={onLoadMore}>
            もっと見る
          </Button>
        )}
      </div>
    </div>
  );
}

function MonthView({
  days,
  monthAnchor,
  blocks,
  onSelectDay,
}: {
  days: DateOnly[];
  monthAnchor: DateOnly;
  blocks: WorkBlockView[];
  onSelectDay: (d: DateOnly) => void;
}) {
  const byDay = useMemo(() => {
    const map = new Map<DateOnly, WorkBlockView[]>();
    for (const block of blocks) {
      if (!block.starts_at) continue;
      const dateOnly = isoToJstParts(block.starts_at).dateOnly; // JST の日付に正規化 (starts_at は UTC ISO のため単純 slice は誤り)
      const list = map.get(dateOnly) ?? [];
      list.push(block);
      map.set(dateOnly, list);
    }
    return map;
  }, [blocks]);

  return (
    <div className="overflow-hidden rounded-xl border border-admin-card-border bg-card shadow-md">
      <div className="grid grid-cols-7 border-b border-border bg-admin-canvas-deep/60 text-center text-xs font-medium">
        {["月", "火", "水", "木", "金", "土", "日"].map((label) => (
          <div key={label} className="border-l border-border py-1.5 first:border-l-0">
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day) => {
          const dayBlocks = byDay.get(day) ?? [];
          const colors = [...new Set(dayBlocks.map((b) => b.color))].slice(0, 4);
          const isToday = day === todayJstDateOnly();
          return (
            <button
              key={day}
              type="button"
              onClick={() => onSelectDay(day)}
              className={`min-h-20 border-b border-l border-border p-1.5 text-left text-xs [&:nth-child(7n+1)]:border-l-0 ${
                isSameJstMonth(day, monthAnchor) ? "" : "text-muted-foreground/50"
              } ${isToday ? "bg-soul/5" : ""}`}
            >
              <div className={`font-medium ${jstWeekday(day) === 0 ? "text-destructive" : ""}`}>{Number(day.slice(8, 10))}</div>
              <div className="mt-1 flex flex-wrap gap-0.5">
                {colors.map((c) => (
                  <span key={c} className="size-1.5 rounded-full" style={{ backgroundColor: c }} />
                ))}
              </div>
              {dayBlocks.length > 0 && <div className="mt-0.5 text-[10px] text-muted-foreground">{dayBlocks.length}件</div>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
