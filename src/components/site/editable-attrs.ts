import type { ResolvedSlot } from "@/modules/page-media/contracts";

/**
 * ビジュアル画像エディタの data-editable-* 属性を組み立てる純関数群。
 * canonical: docs/design/visual-media-editor.md §1 (2 種別) / §4.2 (data 属性は
 * editMode===true のときだけ出力)。
 *
 * React コンポーネント (SlotImage / MediaCover / works 詳細ギャラリー) から共用し、
 * かつ JSX 非依存の純関数として切り出すことで vitest (.test.ts, jsdom 無し) から
 * 直接ユニットテストできるようにする。
 */

/** spread してそのまま JSX 要素に渡せる属性オブジェクト。editMode=false なら空オブジェクト */
export type EditableAttrs = Record<string, string>;

/** §1 ページスロット: data-editable-slot / data-editable-media / data-editable-default */
export function slotEditableAttrs(
  slotKey: string,
  resolved: Pick<ResolvedSlot, "mediaId" | "isDefault">,
  editMode: boolean,
): EditableAttrs {
  if (!editMode) return {};
  return {
    "data-editable-slot": slotKey,
    "data-editable-media": resolved.mediaId ?? "",
    "data-editable-default": String(resolved.isDefault),
  };
}

export type ContentKind = "work" | "voice" | "post";

/**
 * §1 コンテンツ画像 (単一): data-editable-content="{kind}:{id}:cover" +
 * data-editable-media (§4.2: CAS の old_media_id としてオーバーレイが読む)
 */
export function contentEditableAttrs(
  kind: ContentKind,
  id: string,
  mediaId: string | null,
  editMode: boolean,
): EditableAttrs {
  if (!editMode) return {};
  return {
    "data-editable-content": `${kind}:${id}:cover`,
    "data-editable-media": mediaId ?? "",
  };
}

/**
 * §1 コンテンツ画像 (join 行 = work_images ギャラリー):
 * data-editable-work-image="{work_id}:{media_id}"。
 * sort_order は data 属性に出さない (v1.3: Server が読み直すため不要)。
 */
export function workImageEditableAttrs(
  workId: string,
  mediaId: string,
  editMode: boolean,
): EditableAttrs {
  if (!editMode) return {};
  return {
    "data-editable-work-image": `${workId}:${mediaId}`,
  };
}

/**
 * ビジュアルテキストエディタの data-editable-text 属性 (canonical:
 * docs/design/visual-text-editor.md §4.1)。SlotText からのみ使う。
 * editMode===true のときだけ data-editable-text=slotKey を出力する (画像側と同型の
 * 構造的保証: editMode=false なら空オブジェクトで、公開 (site) ページに
 * data 属性のコードパス自体が存在しない)。
 */
export function textEditableAttrs(slotKey: string, editMode: boolean): EditableAttrs {
  if (!editMode) return {};
  return { "data-editable-text": slotKey };
}
