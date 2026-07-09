import type { EditableTarget } from "./actions";

/**
 * /admin/visual クライアント側 (visual-editor.tsx / hotspot-menu.tsx / side-panel.tsx) で
 * 共有する型。circular import 回避のため専用ファイルに切り出す。
 */

export type PageTab = { route: string; label: string };

export type Rect = { top: number; left: number; width: number; height: number };

/** iframe 内 [data-editable-*] 要素 1 つに対応するホットスポット (§5.2) */
export type Hotspot = {
  /** slot:{slotKey} / content:{kind}:{id}:cover / work-image:{workId}:{mediaId} */
  id: string;
  target: EditableTarget;
  /** 楽観排他 (CAS) の期待値 / MediaPicker の初期選択に使う現在の media_id */
  oldMediaId: string | null;
  rect: Rect;
  /** scrollIntoView / ハイライトのため、iframe 内の実 DOM ノードへの参照を保持する */
  node: HTMLElement;
  /** ホットスポットの aria-label / メニュー見出しに使う人間可読ラベル */
  label: string;
};

export type MenuMode = "menu" | "alt-edit";

export type MenuState = {
  hotspot: Hotspot;
  mode: MenuMode;
};
