"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { KmbErrorCode } from "@/modules/platform/contracts";
import { getErrorInfo } from "@/modules/platform/errors";

import { MediaPicker, type PickerMediaItem } from "@/app/admin/_ui/media-picker";

import {
  listSidePanel,
  setImage,
  setSlotAlt,
  type ContentGapItem,
  type EditableTarget,
  type SlotPanelItem,
  type WorksNavItem,
} from "./actions";
import { computeScale, mapChildRectToParent } from "./coordinate-mapping";
import { HotspotMenu } from "./hotspot-menu";
import { SidePanel } from "./side-panel";
import type { Hotspot, MenuState, PageTab } from "./types";

export type { PageTab };

type Props = {
  tabs: PageTab[];
  initialRoute: string;
  initialMediaItems: PickerMediaItem[];
  initialMediaNextCursor: string | null;
};

/** iframe 内部の基準幅 (px)。CSS transform scale の分母 (§5.2「幅固定 + transform scale」) */
const INTRINSIC_WIDTH = 1280;
/** 実測されるまでのフォールバック高さ (px) */
const DEFAULT_INTRINSIC_HEIGHT = 900;
/** kmb:reveal-done 未発火時の初回測定フォールバック (§5.2 MINOR-v1.4) */
const REVEAL_TIMEOUT_MS = 3000;

function editUrl(route: string): string {
  return route === "/" ? "/edit" : `/edit${route}`;
}

function errorMessage(result: { code: KmbErrorCode; detail?: string }): string {
  return result.detail ?? getErrorInfo(result.code).message;
}

function genericLabel(target: EditableTarget): string {
  if (target.type === "slot") return target.slotKey;
  if (target.type === "content") {
    if (target.kind === "work") return "施工事例のカバー画像";
    if (target.kind === "voice") return "お客様の声の写真";
    return "記事のカバー画像";
  }
  return "施工事例のギャラリー画像";
}

/**
 * data-editable-* から EditableTarget を組み立てる (§1/§4.2/§6)。
 * ラベルは要素内の <img alt> をまず使う (SlotImage/MediaCover は alt を出力するため、
 * プレースホルダも含め常に何らかの人間可読テキストが取れる想定)。無ければ種別ごとの汎用文言。
 */
function readHotspot(el: HTMLElement): Omit<Hotspot, "rect"> | null {
  const imgAlt = el.querySelector("img")?.alt || undefined;

  const slotKey = el.getAttribute("data-editable-slot");
  if (slotKey) {
    const media = el.getAttribute("data-editable-media");
    const target: EditableTarget = { type: "slot", slotKey };
    return {
      id: `slot:${slotKey}`,
      target,
      oldMediaId: media || null,
      node: el,
      label: imgAlt || genericLabel(target),
    };
  }

  const contentAttr = el.getAttribute("data-editable-content");
  if (contentAttr) {
    const [kind, id] = contentAttr.split(":");
    if (kind !== "work" && kind !== "voice" && kind !== "post") return null;
    if (!id) return null;
    const media = el.getAttribute("data-editable-media");
    const target: EditableTarget = { type: "content", kind, id, oldMediaId: media || null };
    return {
      id: `content:${contentAttr}`,
      target,
      oldMediaId: media || null,
      node: el,
      label: imgAlt || genericLabel(target),
    };
  }

  const workImageAttr = el.getAttribute("data-editable-work-image");
  if (workImageAttr) {
    const [workId, mediaId] = workImageAttr.split(":");
    if (!workId || !mediaId) return null;
    const target: EditableTarget = { type: "work-image", workId, oldMediaId: mediaId };
    return {
      id: `work-image:${workImageAttr}`,
      target,
      oldMediaId: mediaId,
      node: el,
      label: imgAlt || genericLabel(target),
    };
  }

  return null;
}

/**
 * /admin/visual の中核クライアントコンポーネント (canonical: docs/design/visual-media-editor.md §5)。
 *
 * 実装上の判断 (V2a 未マージ環境での結合面の前提。オーケストレーターへ報告事項):
 * - iframe の「縮小表示」は §5.2 が挙げる 2 案のうち「幅固定 (INTRINSIC_WIDTH) + transform scale」を
 *   採用。scale はコンテナ実測幅 / INTRINSIC_WIDTH。
 * - 初回測定 3 条件 (iframe onload + 内部 DOMContentLoaded + kmb:reveal-done) のうち、
 *   「onload」は「DOMContentLoaded」の後に必ず発火する (ブラウザのロード順序上の事実) ため、
 *   実装では onload 発火を以て DOMContentLoaded 条件も充足済みとみなす簡略化をしている。
 *   reveal-done (またはタイムアウト) は独立した条件のまま待つ。
 * - `kmb:reveal-done` は /edit ページの contentDocument に bubble する CustomEvent という前提で
 *   listen している (V2a の Reveal 実装がこれと異なる target に dispatch する場合でも、
 *   3 秒タイムアウトが必ずフォールバックするため機能上は破綻しない)。
 * - 「iframe reload」は `iframe.contentWindow.location.reload()` ではなく、React の `key` を
 *   増分して iframe 要素ごと再マウントする方式で実装している (同一オリジンでの再ナビゲーション
 *   としては等価だが、cross-realm の contentWindow 参照が失効するタイミング問題を避けられる)。
 */
export function VisualEditor({ tabs, initialRoute, initialMediaItems, initialMediaNextCursor }: Props) {
  const [activeRoute, setActiveRoute] = useState(initialRoute);
  // /works タブの2段ナビ (§5.1a): 一覧表示中は null、事例クリックで slug をセットし
  // iframe を /edit/works/{slug} (詳細ページ) に切り替える。タブ選択状態 (activeRoute) 自体は
  // "/works" のまま変えない (パンくず的に「一覧に戻る」で戻せる)。
  const [worksDetailSlug, setWorksDetailSlug] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const iframeRoute =
    activeRoute === "/works" && worksDetailSlug ? `/works/${worksDetailSlug}` : activeRoute;
  const iframeKey = `${iframeRoute}:${reloadTick}`;
  const activeTab = tabs.find((t) => t.route === activeRoute) ?? tabs[0];

  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const docResizeObserverRef = useRef<ResizeObserver | null>(null);
  const scaleRef = useRef(1);
  const gatingRef = useRef({ windowLoadSeen: false, revealDoneSeen: false, timeoutFired: false });
  // ホットスポット (overlay button) の DOM 参照。hotspot.id → button。
  // メニューを閉じたとき、開いていたホットスポットへ focus を戻すために使う (修正4)。
  const hotspotButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const [scale, setScale] = useState(1);
  const [intrinsicHeight, setIntrinsicHeight] = useState(DEFAULT_INTRINSIC_HEIGHT);
  const [initialReady, setInitialReady] = useState(false);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [flashId, setFlashId] = useState<string | null>(null);

  const [sidePanel, setSidePanel] = useState<{
    slots: SlotPanelItem[];
    contentGaps: ContentGapItem[];
    works: WorksNavItem[];
  }>({
    slots: [],
    contentGaps: [],
    works: [],
  });
  const [sidePanelPending, startSidePanelTransition] = useTransition();

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [altValue, setAltValue] = useState("");
  const [savePending, startSaveTransition] = useTransition();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<{ target: EditableTarget; oldMediaId: string | null } | null>(
    null,
  );
  const [mediaCatalog, setMediaCatalog] = useState<PickerMediaItem[]>(initialMediaItems);
  const [mediaNextCursor, setMediaNextCursor] = useState<string | null>(initialMediaNextCursor);

  // ---- ホットスポット再測定 (座標のみ。ラベル表示以外の外部状態に依存しないため安定した参照) ----
  const measureNow = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument;
    if (!doc || !doc.documentElement) return;

    const hostRect = iframe.getBoundingClientRect();
    const elements = doc.querySelectorAll<HTMLElement>(
      "[data-editable-slot],[data-editable-content],[data-editable-work-image]",
    );
    const next: Hotspot[] = [];
    elements.forEach((el) => {
      const parsed = readHotspot(el);
      if (!parsed) return;
      const innerRect = el.getBoundingClientRect();
      const rect = mapChildRectToParent(
        { top: hostRect.top, left: hostRect.left, width: hostRect.width, height: hostRect.height },
        { top: innerRect.top, left: innerRect.left, width: innerRect.width, height: innerRect.height },
        scaleRef.current,
      );
      next.push({ ...parsed, rect });
    });
    setHotspots(next);

    const scrollHeight = doc.documentElement.scrollHeight;
    if (scrollHeight > 0) {
      setIntrinsicHeight((prev) => (Math.abs(prev - scrollHeight) > 1 ? scrollHeight : prev));
    }
  }, []);

  const maybeStartInitialMeasurement = useCallback(() => {
    const gating = gatingRef.current;
    if (!gating.windowLoadSeen) return;
    if (!gating.revealDoneSeen && !gating.timeoutFired) return;
    setInitialReady(true);
    measureNow();
  }, [measureNow]);

  // ---- コンテナ実測幅 → scale (縮小表示) ----
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? container.clientWidth;
      const next = computeScale(width, INTRINSIC_WIDTH);
      scaleRef.current = next;
      setScale(next);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // ---- route 切り替え / 保存後リロードのたびに測定状態をリセット ----
  useEffect(() => {
    setInitialReady(false);
    setHotspots([]);
    setIntrinsicHeight(DEFAULT_INTRINSIC_HEIGHT);
    setMenu(null);
    gatingRef.current = { windowLoadSeen: false, revealDoneSeen: false, timeoutFired: false };
    return () => {
      docResizeObserverRef.current?.disconnect();
      docResizeObserverRef.current = null;
    };
  }, [iframeKey]);

  // ---- kmb:reveal-done 未発火時の 3 秒フォールバック ----
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      gatingRef.current.timeoutFired = true;
      maybeStartInitialMeasurement();
    }, REVEAL_TIMEOUT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [iframeKey, maybeStartInitialMeasurement]);

  // ---- 初回測定確定後は rAF ループで継続的に再測定 (スクロール中の粘着追従を含む) ----
  useEffect(() => {
    if (!initialReady) return;
    let rafId: number;
    function tick() {
      measureNow();
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [initialReady, measureNow]);

  // ---- サイドパネルデータ取得 (route 切り替え / 保存後リロードごと) ----
  useEffect(() => {
    startSidePanelTransition(async () => {
      const result = await listSidePanel(activeRoute);
      if (!result.ok) {
        toast.error(errorMessage(result));
        setSidePanel({ slots: [], contentGaps: [], works: [] });
        return;
      }
      setSidePanel(result.value);
    });
  }, [activeRoute, reloadTick]);

  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    gatingRef.current.windowLoadSeen = true;

    const doc = iframe.contentDocument;
    if (doc) {
      // 注入ガード (§5.2): 同一オリジンの iframe 内で click/auxclick/submit を capture phase で止める
      // (ホットスポットは親側 DOM のため、この preventDefault の影響を受けない)。
      const block = (e: Event) => e.preventDefault();
      doc.addEventListener("click", block, true);
      doc.addEventListener("auxclick", block, true);
      doc.addEventListener("submit", block, true);

      // Reveal アニメ完了通知 (V2a が追加実装する custom event。§5.2)
      doc.addEventListener("kmb:reveal-done", () => {
        gatingRef.current.revealDoneSeen = true;
        maybeStartInitialMeasurement();
      });

      iframe.contentWindow?.addEventListener("scroll", measureNow, { passive: true });
      iframe.contentWindow?.addEventListener("resize", measureNow);

      if (doc.documentElement) {
        const ro = new ResizeObserver(() => measureNow());
        ro.observe(doc.documentElement);
        docResizeObserverRef.current?.disconnect();
        docResizeObserverRef.current = ro;
      }

      // lazy 遅延読み込み画像の再測定。注入時点で既に complete な画像は onload が発火しないため
      // 対象から外す (次の measureNow で既に正しい寸法が拾える、MINOR-v1.4)。
      doc.querySelectorAll("img").forEach((img) => {
        if (img.complete) return;
        img.addEventListener("load", measureNow, { once: true });
      });
    }

    maybeStartInitialMeasurement();
  }, [measureNow, maybeStartInitialMeasurement]);

  function reloadIframe() {
    setReloadTick((t) => t + 1);
  }

  /**
   * メニュー (または alt 編集フォーム) を閉じる。HotspotMenu の docstring どおり、
   * 閉じたときは開いていたホットスポットへ focus を戻す (Esc / キャンセル操作の受入条件、修正4)。
   * ボタンは menu の開閉に関わらず overlay として常に DOM に存在するため、
   * setMenu(null) 前でも hotspotButtonRefs から同期的に focus() できる。
   */
  function closeMenu() {
    const hotspotId = menu?.hotspot.id;
    setMenu(null);
    if (hotspotId) hotspotButtonRefs.current.get(hotspotId)?.focus();
  }

  function openMenuFor(hotspot: Hotspot) {
    setMenu({ hotspot, mode: "menu" });
  }

  function startAltEdit(hotspot: Hotspot) {
    if (hotspot.target.type !== "slot") return;
    const slotKey = hotspot.target.slotKey;
    const current = sidePanel.slots.find((s) => s.slotKey === slotKey)?.alt ?? "";
    setAltValue(current);
    setMenu({ hotspot, mode: "alt-edit" });
  }

  function handleSaveAlt() {
    if (!menu || menu.hotspot.target.type !== "slot") return;
    const slotKey = menu.hotspot.target.slotKey;
    const trimmed = altValue.trim();
    startSaveTransition(async () => {
      const result = await setSlotAlt(slotKey, trimmed.length > 0 ? trimmed : null);
      if (!result.ok) {
        toast.error(errorMessage(result));
        return;
      }
      toast.success("alt テキストを保存しました。");
      closeMenu();
      reloadIframe();
    });
  }

  function handleResetToDefault() {
    if (!menu || menu.hotspot.target.type !== "slot") return;
    const target = menu.hotspot.target;
    startSaveTransition(async () => {
      const result = await setImage(target, null);
      if (!result.ok) {
        toast.error(errorMessage(result));
        return;
      }
      toast.success("既定の画像に戻しました。");
      closeMenu();
      reloadIframe();
    });
  }

  function handleDeleteWorkImage() {
    if (!menu || menu.hotspot.target.type !== "work-image") return;
    const target = menu.hotspot.target;
    startSaveTransition(async () => {
      const result = await setImage(target, null);
      if (!result.ok) {
        toast.error(errorMessage(result));
        return;
      }
      toast.success("画像を削除しました。");
      closeMenu();
      reloadIframe();
    });
  }

  function handleChangeImage() {
    if (!menu) return;
    setPickerTarget({ target: menu.hotspot.target, oldMediaId: menu.hotspot.oldMediaId });
    setPickerOpen(true);
    setMenu(null);
  }

  function handleConfirmImage(ids: string[]) {
    if (!pickerTarget) return;
    const mediaId = ids[0] ?? null;
    const { target } = pickerTarget;
    startSaveTransition(async () => {
      const result = await setImage(target, mediaId);
      if (!result.ok) {
        toast.error(errorMessage(result));
        return;
      }
      toast.success("画像を保存しました。");
      setPickerTarget(null);
      reloadIframe();
    });
  }

  function flashHotspot(id: string) {
    setFlashId(id);
    window.setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 1500);
  }

  function handleSidePanelSlotClick(item: SlotPanelItem) {
    const hotspot = hotspots.find((h) => h.target.type === "slot" && h.target.slotKey === item.slotKey);
    if (hotspot) {
      hotspot.node.scrollIntoView({ behavior: "smooth", block: "center" });
      flashHotspot(hotspot.id);
      return;
    }
    // iframe 内に対応 DOM が見つからない (未測定 / 現在の route に存在しない) → 直接 MediaPicker を開く (§5.4)
    setPickerTarget({ target: { type: "slot", slotKey: item.slotKey }, oldMediaId: item.mediaId });
    setPickerOpen(true);
  }

  /** §5.1a: 施工事例クリック → iframe を /edit/works/{slug} (詳細ページ) に切り替える */
  function handleWorkNavClick(slug: string) {
    setWorksDetailSlug(slug);
  }

  /** §5.1a: パンくず的な「一覧に戻る」導線。/edit/works (一覧) に戻す */
  function handleBackToWorksList() {
    setWorksDetailSlug(null);
  }

  function handleSidePanelGapClick(item: ContentGapItem) {
    // cover/photo 未設定のコンテンツは公開ページに DOM が出ないため、直接 MediaPicker を開く (§5.4)
    setPickerTarget({
      target: { type: "content", kind: item.kind, id: item.id, oldMediaId: null },
      oldMediaId: null,
    });
    setPickerOpen(true);
  }

  function handleMediaItemsLoaded(items: PickerMediaItem[], nextCursor: string | null) {
    setMediaCatalog((prev) => {
      const known = new Set(prev.map((p) => p.id));
      const additions = items.filter((item) => !known.has(item.id));
      return additions.length > 0 ? [...prev, ...additions] : prev;
    });
    setMediaNextCursor(nextCursor);
  }

  const pickerTitle =
    pickerTarget?.target.type === "content"
      ? "カバー画像を選ぶ"
      : pickerTarget?.target.type === "work-image"
        ? "ギャラリー画像を選ぶ"
        : "画像を選ぶ";

  return (
    <div className="flex flex-col gap-4">
      <Tabs
        value={activeRoute}
        onValueChange={(v) => {
          setActiveRoute(v as string);
          // 別タブへ切り替えたら /works の詳細ナビ状態はリセットする (§5.1a)
          setWorksDetailSlug(null);
        }}
      >
        <TabsList variant="line" className="h-auto flex-wrap">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.route} value={tab.route}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div
          ref={containerRef}
          className="relative w-full overflow-hidden rounded-xl border border-border bg-muted/30"
          style={{ height: Math.max(intrinsicHeight * scale, 200) }}
        >
          {!initialReady && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/70 text-sm text-muted-foreground">
              読み込み中…
            </div>
          )}
          <iframe
            key={iframeKey}
            ref={iframeRef}
            src={editUrl(iframeRoute)}
            title={`編集プレビュー: ${activeTab?.label ?? activeRoute}${worksDetailSlug ? ` / ${worksDetailSlug}` : ""}`}
            onLoad={handleIframeLoad}
            className="absolute left-0 top-0 origin-top-left border-0 bg-white"
            style={{ width: INTRINSIC_WIDTH, height: intrinsicHeight, transform: `scale(${scale})` }}
          />
          {hotspots.map((hotspot) => (
            <button
              key={hotspot.id}
              ref={(el) => {
                if (el) hotspotButtonRefs.current.set(hotspot.id, el);
                else hotspotButtonRefs.current.delete(hotspot.id);
              }}
              type="button"
              aria-label={`${hotspot.label} を編集`}
              onClick={() => openMenuFor(hotspot)}
              className={cn(
                "absolute rounded-md border-2 border-dashed border-transparent bg-primary/0 outline-none transition-colors hover:border-primary hover:bg-primary/10 focus-visible:border-primary focus-visible:bg-primary/10",
                flashId === hotspot.id && "border-primary bg-primary/15",
              )}
              style={{
                top: hotspot.rect.top,
                left: hotspot.rect.left,
                width: hotspot.rect.width,
                height: hotspot.rect.height,
              }}
            />
          ))}

          {menu && (
            <HotspotMenu
              menu={menu}
              altValue={altValue}
              onAltValueChange={setAltValue}
              savePending={savePending}
              onClose={closeMenu}
              onChangeImage={handleChangeImage}
              onEditAlt={() => startAltEdit(menu.hotspot)}
              onResetToDefault={handleResetToDefault}
              onDeleteWorkImage={handleDeleteWorkImage}
              onSaveAlt={handleSaveAlt}
            />
          )}
        </div>

        <SidePanel
          slots={sidePanel.slots}
          contentGaps={sidePanel.contentGaps}
          works={sidePanel.works}
          activeWorkSlug={activeRoute === "/works" ? worksDetailSlug : null}
          pending={sidePanelPending}
          onSlotClick={handleSidePanelSlotClick}
          onGapClick={handleSidePanelGapClick}
          onWorkClick={handleWorkNavClick}
          onBackToWorksList={handleBackToWorksList}
        />
      </div>

      <MediaPicker
        open={pickerOpen}
        onOpenChange={(open) => {
          setPickerOpen(open);
          if (!open) setPickerTarget(null);
        }}
        mode="single"
        title={pickerTitle}
        initialItems={mediaCatalog}
        initialNextCursor={mediaNextCursor}
        selectedIds={pickerTarget?.oldMediaId ? [pickerTarget.oldMediaId] : []}
        onConfirm={handleConfirmImage}
        onItemsLoaded={handleMediaItemsLoaded}
      />
    </div>
  );
}
