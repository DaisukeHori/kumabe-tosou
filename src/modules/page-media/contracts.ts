import { z } from "zod";

import { zMediaId } from "@/modules/platform/contracts";

import { isValidSlotKey, type PageSlot } from "./registry";

/**
 * page-media モジュールの契約 (canonical: docs/design/visual-media-editor.md §4.1 / §6)。
 */

/**
 * resolver (公開 SSR / /edit) の戻り値の 1 スロット分。
 * BLOCKER-v1.4: キャッシュ境界 (unstable_cache) を通るため JSON-safe に限る
 * (Map/Date/undefined プロパティ禁止)。
 */
export type ResolvedSlot = {
  /** null = プレースホルダ表示 (未来枠かつ未設定) */
  src: string | null;
  alt: string;
  /** null = 既定 / 未設定 */
  mediaId: string | null;
  /** true = registry の default_src (またはプレースホルダ) が使われている */
  isDefault: boolean;
  source: "page_media" | "default" | "placeholder";
};

/** slotKey → ResolvedSlot。**Record のみ。Map は禁止** (§4.1 BLOCKER-v1.4) */
export type ResolvedSlots = Record<string, ResolvedSlot>;

export type SlotState = "default" | "custom" | "placeholder";

/** listForAdmin() の 1 行。サイドパネル (§5.4) が registry × page_media を突き合わせて表示する材料 */
export type PageSlotState = {
  slot: PageSlot;
  mediaId: string | null;
  alt: string;
  state: SlotState;
};

/** slot_key は registry のキーに限定する (registry 外は KMB-E107) */
export const zSetSlotReq = z
  .object({
    slot_key: z.string().refine(isValidSlotKey, "registry に存在しない slot_key です"),
    media_id: zMediaId.nullable(),
  })
  .strict();
export type SetSlotReq = z.infer<typeof zSetSlotReq>;

export const zSetSlotAltReq = z
  .object({
    slot_key: z.string().refine(isValidSlotKey, "registry に存在しない slot_key です"),
    alt: z.string().max(200).nullable(),
  })
  .strict();
export type SetSlotAltReq = z.infer<typeof zSetSlotAltReq>;
