import type { EditableTarget } from "./actions";

/**
 * /admin/visual クライアント側 (visual-editor.tsx / hotspot-menu.tsx / side-panel.tsx) で
 * 共有する型。circular import 回避のため専用ファイルに切り出す。
 */

export type PageTab = { route: string; label: string };

export type Rect = { top: number; left: number; width: number; height: number };

/**
 * テキストスロットのホットスポット対象 (canonical: docs/design/visual-text-editor.md §5)。
 * setSlotText の保存対象は slotKey のみ (画像の EditableTarget とは別の保存経路のため、
 * setImage が扱う EditableTarget 判別union には合流させない)。
 */
export type TextTarget = { type: "text"; slotKey: string };

export type HotspotTarget = EditableTarget | TextTarget;

/** iframe 内 [data-editable-*] 要素 1 つに対応するホットスポット (§5.2 / テキストは visual-text-editor.md §5) */
export type Hotspot = {
  /** slot:{slotKey} / content:{kind}:{id}:cover / work-image:{workId}:{mediaId} / text:{slotKey}:{ordinal} */
  id: string;
  target: HotspotTarget;
  /** 楽観排他 (CAS) の期待値 / MediaPicker の初期選択に使う現在の media_id。text では常に null */
  oldMediaId: string | null;
  rect: Rect;
  /** scrollIntoView / ハイライトのため、iframe 内の実 DOM ノードへの参照を保持する */
  node: HTMLElement;
  /** ホットスポットの aria-label / メニュー見出しに使う人間可読ラベル */
  label: string;
};

export type MenuMode = "menu" | "alt-edit" | "text-edit";

export type MenuState = {
  hotspot: Hotspot;
  mode: MenuMode;
};
