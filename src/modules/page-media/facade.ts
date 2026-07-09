import "server-only";

import { unstable_cache } from "next/cache";

import { createSupabasePublicClient } from "@/lib/supabase/public";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mediaFacade } from "@/modules/media/facade";
import type { Result } from "@/modules/platform/contracts";

import type { PageSlotState, ResolvedSlot, ResolvedSlots, SlotState } from "./contracts";
import { EDITABLE_ROUTES, REGISTRY_HASH, SLOT_REGISTRY, isValidSlotKey, slotsForRoute } from "./registry";
import type { PageSlot } from "./registry";
import {
  deleteSlot,
  fetchResolvedRows,
  updateSlotAlt,
  upsertSlot,
  type PageMediaResolvedRow,
} from "./repository";

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
}

// re-export (admin UI / edit ルートが registry を直接読みたいケース用の利便 export。
// facade を経由しない registry の値自体は「静的メタの単一ソース」であり秘匿情報ではない)
export { EDITABLE_ROUTES, REGISTRY_HASH, SLOT_REGISTRY };
export type { PageSlot };

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

export const pageMediaFacade: PageMediaFacade = {
  resolveAll,
  resolveAllFresh,
  listForAdmin,
  setSlot,
  setSlotAlt,
};
