import "server-only";

import { unstable_cache } from "next/cache";

import { createSupabasePublicClient } from "@/lib/supabase/public";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { contentFacade } from "@/modules/content/facade";
import { mediaFacade } from "@/modules/media/facade";
import type { Result } from "@/modules/platform/contracts";

import type {
  PageSlotState,
  PageTextState,
  ResolvedSlot,
  ResolvedSlots,
  ResolvedTexts,
  SlotState,
} from "./contracts";
import { EDITABLE_ROUTES, REGISTRY_HASH, SLOT_REGISTRY, isValidSlotKey, slotsForRoute } from "./registry";
import type { PageSlot } from "./registry";
import {
  deleteSlot,
  fetchResolvedRows,
  updateSlotAlt,
  upsertSlot,
  type PageMediaResolvedRow,
  deleteText,
  fetchTextRows,
  upsertText,
  type PageTextRow,
} from "./repository";
import {
  TEXT_REGISTRY,
  TEXT_REGISTRY_HASH,
  isValidTextSlotKey,
  normalizeLineEndings,
  textSlotByKey,
  textSlotsForRoute,
} from "./text-registry";
import type { PageTextSlot } from "./text-registry";

/**
 * page-media モジュールの公開 facade (canonical: docs/design/visual-media-editor.md §6)。
 *
 * ESLint: eslint.config.mjs の MODULES 配列に "page-media" を追加済み
 * (他モジュールからは facade 経由のみ import 可、internal/repository 直 import 禁止)。
 */
export interface PageMediaFacade {
  /** 公開 SSR 用 (unstable_cache + view 1 クエリ)。Record — Map 禁止 (§4.1 BLOCKER-v1.4) */
  resolveAll(): Promise<Result<ResolvedSlots>>;
  /** /edit 用 (キャッシュ非経由、§4.1) */
  resolveAllFresh(): Promise<Result<ResolvedSlots>>;
  /** route 絞り込み可能 (§5.4 サイドパネル) */
  listForAdmin(route?: string): Promise<Result<PageSlotState[]>>;
  setSlot(slotKey: string, mediaId: string | null): Promise<Result<void>>;
  setSlotAlt(slotKey: string, alt: string | null): Promise<Result<void>>;

  // テキストスロット (visual-text-editor.md §3。2026-07-10 追加。page_text 所有)
  /** 公開 SSR 用。unstable_cache tag "page_text"。ResolvedTexts は Record (JSON-safe、Map 禁止) */
  resolveAllTexts(): Promise<Result<ResolvedTexts>>;
  /** /edit 用 (キャッシュ非経由) */
  resolveAllTextsFresh(): Promise<Result<ResolvedTexts>>;
  listTextsForAdmin(route?: string): Promise<Result<PageTextState[]>>;
  /** null = 既定に戻す (行削除)。defaultText と同一文字列の保存も同様に削除へ正規化する (v1.1) */
  setText(slotKey: string, text: string | null): Promise<Result<void>>;

  /**
   * AI 文言候補のコンテキスト構築器 (ai-studio-v2.md §3。P2 追加)。
   * TEXT_REGISTRY の現況 (resolved) + SLOT_REGISTRY の画像 alt + works/posts の公開タイトル群を
   * 決定的 JSON にシリアライズして返す (タグ包みではなく JSON.stringify — §3 MAJOR-4)。
   * 対象スロットは label に `<<<編集対象>>>` を前置してマークする。
   */
  buildSiteContextMd(targetSlotKey: string): Promise<Result<SiteContextResult>>;
}

/** buildSiteContextMd() の戻り値 (ai-studio-v2.md §3)。contextJson は既に決定的 JSON.stringify 済み */
export type SiteContextResult = {
  contextJson: string;
  targetRoute: string;
};

// re-export (admin UI / edit ルートが registry を直接読みたいケース用の利便 export。
// facade を経由しない registry の値自体は「静的メタの単一ソース」であり秘匿情報ではない)
export { EDITABLE_ROUTES, REGISTRY_HASH, SLOT_REGISTRY, TEXT_REGISTRY, TEXT_REGISTRY_HASH };
export type { PageSlot, PageTextSlot };

function rowsBySlotKey(rows: PageMediaResolvedRow[]): Map<string, PageMediaResolvedRow> {
  return new Map(rows.map((r) => [r.slot_key, r]));
}

/** §2.2 alt 決定順: alt_override ?? media_alt ?? registry.altDefault */
function resolveAlt(slot: PageSlot, row: PageMediaResolvedRow | undefined): string {
  return row?.alt_override ?? row?.media_alt ?? slot.altDefault;
}

/** §2.1 全データパターンに基づく状態判定。ResolvedSlot.source と PageSlotState.state で共用する */
function resolveState(slot: PageSlot, mediaId: string | null): SlotState {
  if (mediaId) return "custom";
  return slot.defaultSrc ? "default" : "placeholder";
}

function stateToSource(state: SlotState): ResolvedSlot["source"] {
  if (state === "custom") return "page_media";
  return state;
}

/** view 行 + SLOT_REGISTRY から 1 スロット分の ResolvedSlot を組み立てる (§4.1) */
function buildResolvedSlot(slot: PageSlot, row: PageMediaResolvedRow | undefined): ResolvedSlot {
  const mediaId = row?.media_id ?? null;
  const alt = resolveAlt(slot, row);
  const state = resolveState(slot, mediaId);

  if (mediaId) {
    const urlResult = mediaFacade.getPublicUrl(mediaId);
    if (urlResult.ok) {
      return { src: urlResult.value, alt, mediaId, isDefault: false, source: "page_media" };
    }
    // getPublicUrl は通常失敗しない (env のみに依存する純粋な URL 組み立て) が、
    // 万一失敗した場合も defaultSrc へ安全にフォールバックする (公開ページを落とさない)。
    return {
      src: slot.defaultSrc,
      alt,
      mediaId: null,
      isDefault: true,
      source: slot.defaultSrc ? "default" : "placeholder",
    };
  }

  return { src: slot.defaultSrc, alt, mediaId: null, isDefault: true, source: stateToSource(state) };
}

function buildResolvedSlots(rows: PageMediaResolvedRow[]): ResolvedSlots {
  const bySlotKey = rowsBySlotKey(rows);
  const result: ResolvedSlots = {};
  for (const slot of SLOT_REGISTRY) {
    result[slot.key] = buildResolvedSlot(slot, bySlotKey.get(slot.key));
  }
  return result;
}

/** エラー時のフォールバック: 全 slot を isDefault=true で返し、公開ページを落とさない (§4.1) */
function allDefaultFallback(): ResolvedSlots {
  const result: ResolvedSlots = {};
  for (const slot of SLOT_REGISTRY) {
    result[slot.key] = {
      src: slot.defaultSrc,
      alt: slot.altDefault,
      mediaId: null,
      isDefault: true,
      source: slot.defaultSrc ? "default" : "placeholder",
    };
  }
  return result;
}

/** キャッシュ非経由の生フェッチ (resolveAllFresh と、unstable_cache がラップする内部実装で共用) */
async function fetchResolvedSlotsRaw(): Promise<ResolvedSlots> {
  const client = createSupabasePublicClient();
  const rowsResult = await fetchResolvedRows(client);
  if (!rowsResult.ok) {
    throw new Error(
      `page_media_resolved の取得に失敗しました: ${rowsResult.code} ${rowsResult.detail ?? ""}`,
    );
  }
  return buildResolvedSlots(rowsResult.value);
}

/**
 * 公開 (site) ページ用のキャッシュ (§4.1)。
 * keyParts に REGISTRY_HASH を含めることで、registry のコード変更がキャッシュに残らない
 * (BLOCKER-v1.4 / MAJOR-5)。戻り値は fetchResolvedSlotsRaw() が返す ResolvedSlots (Record) の
 * みで JSON-safe (unstable_cache は内部で JSON.stringify/parse するため Map は不可)。
 */
const getCachedResolvedSlots = unstable_cache(fetchResolvedSlotsRaw, ["page_media", REGISTRY_HASH], {
  tags: ["page_media"],
});

function errDetail(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function resolveAll(): Promise<Result<ResolvedSlots>> {
  try {
    const value = await getCachedResolvedSlots();
    return { ok: true, value };
  } catch (err) {
    console.error("[page-media] resolveAll に失敗しました (既定表示にフォールバックします):", err);
    return { ok: true, value: allDefaultFallback() };
  }
}

async function resolveAllFresh(): Promise<Result<ResolvedSlots>> {
  try {
    const value = await fetchResolvedSlotsRaw();
    return { ok: true, value };
  } catch (err) {
    console.error("[page-media] resolveAllFresh に失敗しました (既定表示にフォールバックします):", err);
    return { ok: true, value: allDefaultFallback() };
  }
}

async function listForAdmin(route?: string): Promise<Result<PageSlotState[]>> {
  try {
    const client = await createSupabaseServerClient();
    const rowsResult = await fetchResolvedRows(client);
    if (!rowsResult.ok) return rowsResult;
    const bySlotKey = rowsBySlotKey(rowsResult.value);
    const slots = route ? slotsForRoute(route) : [...SLOT_REGISTRY];
    const items: PageSlotState[] = slots.map((slot) => {
      const row = bySlotKey.get(slot.key);
      const mediaId = row?.media_id ?? null;
      return {
        slot,
        mediaId,
        alt: resolveAlt(slot, row),
        state: resolveState(slot, mediaId),
      };
    });
    return { ok: true, value: items };
  } catch (err) {
    return { ok: false, code: "KMB-E901", detail: errDetail(err) };
  }
}

/**
 * requireAdmin 相当は呼び出し側 Server Action の責務 (V2b で実装)。ここでは admin セッションの
 * server client で書き込み、RLS (page_media_admin_insert/update/delete) が最終防御を担う
 * (settings facade の作法を踏襲)。revalidate は facade でなく Server Action 側の責務
 * (§5.5b。/edit は fresh fetch のため、公開側の失効は action 層が一元管理する)。
 */
async function setSlot(slotKey: string, mediaId: string | null): Promise<Result<void>> {
  if (!isValidSlotKey(slotKey)) {
    return { ok: false, code: "KMB-E107", detail: `未知の slot_key です: ${slotKey}` };
  }
  try {
    const client = await createSupabaseServerClient();
    // 「既定に戻す」= page_media 行を削除 (media_id/alt_override とも既定へ復帰、§2 コメント)
    if (mediaId === null) return await deleteSlot(client, slotKey);
    return await upsertSlot(client, slotKey, mediaId);
  } catch (err) {
    return { ok: false, code: "KMB-E901", detail: errDetail(err) };
  }
}

async function setSlotAlt(slotKey: string, alt: string | null): Promise<Result<void>> {
  if (!isValidSlotKey(slotKey)) {
    return { ok: false, code: "KMB-E107", detail: `未知の slot_key です: ${slotKey}` };
  }
  try {
    const client = await createSupabaseServerClient();
    return await updateSlotAlt(client, slotKey, alt);
  } catch (err) {
    return { ok: false, code: "KMB-E901", detail: errDetail(err) };
  }
}

// ---------------------------------------------------------------------------
// page-text (ビジュアルテキストエディタ、visual-text-editor.md §3)
// ---------------------------------------------------------------------------

function rowsBySlotKeyText(rows: PageTextRow[]): Map<string, PageTextRow> {
  return new Map(rows.map((r) => [r.slot_key, r]));
}

/** 行なし = registry の defaultText (§1: 「既定に戻す」= 行削除) */
function buildResolvedTexts(rows: PageTextRow[]): ResolvedTexts {
  const bySlotKey = rowsBySlotKeyText(rows);
  const result: ResolvedTexts = {};
  for (const slot of TEXT_REGISTRY) {
    const row = bySlotKey.get(slot.key);
    result[slot.key] = row
      ? { text: row.text_override, isDefault: false }
      : { text: slot.defaultText, isDefault: true };
  }
  return result;
}

/** エラー時のフォールバック: 全 slot を defaultText で返し、公開ページを落とさない (§3) */
function allDefaultTextFallback(): ResolvedTexts {
  const result: ResolvedTexts = {};
  for (const slot of TEXT_REGISTRY) {
    result[slot.key] = { text: slot.defaultText, isDefault: true };
  }
  return result;
}

/** キャッシュ非経由の生フェッチ (resolveAllTextsFresh と unstable_cache 内部実装で共用) */
async function fetchResolvedTextsRaw(): Promise<ResolvedTexts> {
  const client = createSupabasePublicClient();
  const rowsResult = await fetchTextRows(client);
  if (!rowsResult.ok) {
    throw new Error(`page_text の取得に失敗しました: ${rowsResult.code} ${rowsResult.detail ?? ""}`);
  }
  return buildResolvedTexts(rowsResult.value);
}

/**
 * 公開 (site) ページ用のキャッシュ (§3)。keyParts に TEXT_REGISTRY_HASH を含めることで、
 * registry のコード変更がキャッシュに残らない (画像側 BLOCKER-v1.4 と同一不変条件)。
 */
const getCachedResolvedTexts = unstable_cache(
  fetchResolvedTextsRaw,
  ["page_text", TEXT_REGISTRY_HASH],
  { tags: ["page_text"] },
);

async function resolveAllTexts(): Promise<Result<ResolvedTexts>> {
  try {
    const value = await getCachedResolvedTexts();
    return { ok: true, value };
  } catch (err) {
    console.error("[page-media] resolveAllTexts に失敗しました (既定表示にフォールバックします):", err);
    return { ok: true, value: allDefaultTextFallback() };
  }
}

async function resolveAllTextsFresh(): Promise<Result<ResolvedTexts>> {
  try {
    const value = await fetchResolvedTextsRaw();
    return { ok: true, value };
  } catch (err) {
    console.error("[page-media] resolveAllTextsFresh に失敗しました (既定表示にフォールバックします):", err);
    return { ok: true, value: allDefaultTextFallback() };
  }
}

async function listTextsForAdmin(route?: string): Promise<Result<PageTextState[]>> {
  try {
    const client = await createSupabaseServerClient();
    const rowsResult = await fetchTextRows(client);
    if (!rowsResult.ok) return rowsResult;
    const bySlotKey = rowsBySlotKeyText(rowsResult.value);
    const slots: PageTextSlot[] = route ? textSlotsForRoute(route) : [...TEXT_REGISTRY];
    const items: PageTextState[] = slots.map((slot) => {
      const row = bySlotKey.get(slot.key);
      return row
        ? { slot, text: row.text_override, isDefault: false }
        : { slot, text: slot.defaultText, isDefault: true };
    });
    return { ok: true, value: items };
  } catch (err) {
    return { ok: false, code: "KMB-E901", detail: errDetail(err) };
  }
}

/**
 * requireAdmin 相当・maxLen/kind (+ v1.3: 下限/空文字列) の Zod 検証は呼び出し側 Server
 * Action の責務 (T2b、setSlot と同じ役割分担)。ここでは registry 存在確認のみ行い、
 * admin セッションの server client で書き込む (RLS が最終防御)。
 * v1.1: text が対象スロットの defaultText と文字列として同一の場合も「既定に戻す」として
 * 削除に正規化する (差分のみ保持という page_text の一貫性を保つ)。
 * v1.3: zSetTextReq (Server Action 層) を経由しない呼び出しに備え、保存前に必ず
 * normalizeLineEndings で \r\n / 単独 \r を \n に正規化する (defense-in-depth。
 * zSetTextReq の transform と同一関数を使い、検証対象と保存対象を一致させる)。
 */
async function setText(slotKey: string, text: string | null): Promise<Result<void>> {
  if (!isValidTextSlotKey(slotKey)) {
    return { ok: false, code: "KMB-E107", detail: `未知の slot_key です: ${slotKey}` };
  }
  const normalizedText = text === null ? null : normalizeLineEndings(text);
  try {
    const client = await createSupabaseServerClient();
    const slot = textSlotByKey(slotKey);
    if (normalizedText === null || (slot && normalizedText === slot.defaultText)) {
      return await deleteText(client, slotKey);
    }
    return await upsertText(client, slotKey, normalizedText);
  } catch (err) {
    return { ok: false, code: "KMB-E901", detail: errDetail(err) };
  }
}

// ---------------------------------------------------------------------------
// buildSiteContextMd (AI 文言候補のコンテキスト構築器。ai-studio-v2.md §3、P2 追加)
// ---------------------------------------------------------------------------

/** 対象スロットを識別可能にするマーカー (§3: 「対象スロットは <<<編集対象>>> でマーク」) */
const TARGET_SLOT_MARKER = "<<<編集対象>>>";

const PUBLISHED_TITLES_SCAN_PARAMS = { cursor: null, limit: 100 } as const;

/**
 * works / posts (blog・reading) の公開タイトル群 (§3「works/posts の公開タイトル群」)。
 * ベストエフォート: 取得に失敗したカテゴリは空配列にフォールバックする (コンテキスト構築全体を
 * 失敗させない。site-public の allDefaultFallback と同じ「落とさない」思想)。
 * news (お知らせ) は actions.ts の POST_KIND_PATH 同様、専用の公開一覧ルートが無いため対象外。
 */
async function fetchPublishedTitles(): Promise<{ works: string[]; posts: string[] }> {
  const [worksResult, blogResult, readingResult] = await Promise.all([
    contentFacade.listPublished("work", PUBLISHED_TITLES_SCAN_PARAMS),
    contentFacade.listPublished("blog", PUBLISHED_TITLES_SCAN_PARAMS),
    contentFacade.listPublished("reading", PUBLISHED_TITLES_SCAN_PARAMS),
  ]);
  return {
    works: worksResult.ok ? worksResult.value.items.map((item) => item.title) : [],
    posts: [
      ...(blogResult.ok ? blogResult.value.items.map((item) => item.title) : []),
      ...(readingResult.ok ? readingResult.value.items.map((item) => item.title) : []),
    ],
  };
}

/**
 * サイト全文 MD の構築 (§3)。決定的シリアライズの実体は末尾の JSON.stringify のみ
 * (対象は静的 registry の走査順 + admin セッションの現況値であり、タイムスタンプ等の
 * 揮発値は含めない — text-suggestion-ux.md のキャッシュ無効化リスクへの対応)。
 *
 * 判断点 (オーケストレーターへ報告済み): module-contracts.md §2 の依存方向表に
 * `page-media → content` は明記されていない (新設モジュールのため単純な記載漏れと判断)。
 * 本関数は「works/posts の公開タイトル群」(§3 原文) を得るために contentFacade.listPublished
 * (read専用・facade 経由) に依存する。循環依存は無い (content モジュールは page-media に
 * 依存しない) ため ESLint 上も構造上も問題は無いが、契約書更新が必要であれば要確認。
 */
async function buildSiteContextMd(targetSlotKey: string): Promise<Result<SiteContextResult>> {
  if (!isValidTextSlotKey(targetSlotKey)) {
    return { ok: false, code: "KMB-E107", detail: `未知の slot_key です: ${targetSlotKey}` };
  }
  const targetSlot = textSlotByKey(targetSlotKey)!;

  const textsResult = await listTextsForAdmin();
  if (!textsResult.ok) return textsResult;
  const slotsResult = await listForAdmin();
  if (!slotsResult.ok) return slotsResult;

  const texts = textsResult.value.map((item) => ({
    key: item.slot.key,
    route: item.slot.route,
    kind: item.slot.kind,
    label: item.slot.key === targetSlotKey ? `${TARGET_SLOT_MARKER} ${item.slot.label}` : item.slot.label,
    text: item.text,
  }));

  const images = slotsResult.value.map((item) => ({
    key: item.slot.key,
    route: item.slot.route,
    label: item.slot.label,
    alt: item.alt,
  }));

  const publishedTitles = await fetchPublishedTitles();

  const payload = {
    source: "site_content" as const,
    targetSlotKey,
    targetRoute: targetSlot.route,
    texts,
    images,
    publishedTitles,
  };

  return { ok: true, value: { contextJson: JSON.stringify(payload), targetRoute: targetSlot.route } };
}

export const pageMediaFacade: PageMediaFacade = {
  resolveAll,
  resolveAllFresh,
  listForAdmin,
  setSlot,
  setSlotAlt,
  resolveAllTexts,
  resolveAllTextsFresh,
  listTextsForAdmin,
  setText,
  buildSiteContextMd,
};
