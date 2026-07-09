import { z } from "zod";

import { zMediaId } from "@/modules/platform/contracts";

import { isValidSlotKey, type PageSlot } from "./registry";
import {
  isValidTextSlotKey,
  normalizeLineEndings,
  textSlotByKey,
  validateSlotText,
  type PageTextSlot,
} from "./text-registry";

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

/**
 * page-text (ビジュアルテキストエディタ) の契約 (canonical:
 * docs/design/visual-text-editor.md §3 / §6)。
 */

/** resolver (公開 SSR / /edit) の戻り値の 1 スロット分。JSON-safe (Map 禁止、§3) */
export type ResolvedText = {
  text: string;
  /** true = registry の defaultText が使われている (page_text に行が無い) */
  isDefault: boolean;
};

/** slotKey → ResolvedText。**Record のみ。Map は禁止** (画像側 §4.1 BLOCKER-v1.4 と同一不変条件) */
export type ResolvedTexts = Record<string, ResolvedText>;

/** listTextsForAdmin() の 1 行。サイドパネルの「テキスト」セクション (T2b) が使う材料 */
export type PageTextState = {
  slot: PageTextSlot;
  text: string;
  isDefault: boolean;
};

/**
 * slot_key は TEXT_REGISTRY のキーに限定する (registry 外は KMB-E107)。
 * text は null 許容 = 既定復帰 (page_text 行削除)。非 null のときは、まず
 * normalizeLineEndings で \r\n / 単独 \r を \n に正規化してから (transform。
 * v1.3 tester 検証ギャップ対応: textarea 由来の CRLF がそのまま保存/検証されていた)、
 * 対象スロットの下限 (空文字列・空白のみ拒否) / maxLen / kind (text は改行拒否 /
 * lines は行数・1 行文字数 / multiline は段落数) を検証する (validateSlotText に委譲。
 * KMB-E101 相当)。transform は superRefine より先に評価されるため、検証は常に
 * 正規化後のテキストに対して行われる。
 */
export const zSetTextReq = z
  .object({
    slot_key: z.string().refine(isValidTextSlotKey, "registry に存在しない slot_key です"),
    text: z.string().transform(normalizeLineEndings).nullable(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.text === null) return; // 既定に戻す。検証不要
    const slot = textSlotByKey(data.slot_key);
    if (!slot) return; // slot_key 自体は上の refine で別途拒否される
    for (const issue of validateSlotText(slot, data.text)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: issue, path: ["text"] });
    }
  });
export type SetTextReq = z.infer<typeof zSetTextReq>;
