/**
 * page-text (ビジュアルテキストエディタ) の型定義。
 * canonical: docs/design/visual-text-editor.md §2 (TEXT_REGISTRY / PageTextSlot) /
 * docs/design/visual-text-editor-v2.md §3 (rich kind の追加)。
 *
 * text-registry.ts からの分割 (v2 Wave 0a) で本ファイルへ移動。内容は 1 文字も変更していない
 * (TextKind への "rich" 追加のみ v2 Wave 0b で別途行う)。
 */

export type TextKind = "text" | "lines" | "multiline" | "rich";
// text      = 単一行 (改行禁止)
// lines     = 改行 (\n) 埋め込み見出し。表示側が行分割レンダー
// multiline = 段落テキスト (\n\n 区切り可)
// rich      = インライン装飾 (等幅 `text` / 太字 **text** / リンク [text](url)) を持つ本文。
//             段落 (\n\n) 区切り可。dangerouslySetInnerHTML は使わず、renderRichText (v2) が
//             限定語彙のみを React 要素へ変換する (docs/design/visual-text-editor-v2.md §3)。

export type PageTextSlot = {
  /** 'home.statement.heading' 等 (PLAN.md §1 命名規約)。page_text.slot_key と 1:1 */
  key: string;
  /** 'home' | 'story' | … | 擬似ページ 'shared' | 'chrome' */
  page: string;
  /** '/' | '/about' 等。iframe で開く実ルート (EDITABLE_ROUTES と同体系) */
  route: string;
  /** 管理画面表示用ラベル */
  label: string;
  kind: TextKind;
  /** 書記素クラスタ数ではなく string.length で判定 (Zod と同基準、§2) */
  maxLen: number;
  /** 現行ハードコード文言そのまま (V2a 画像と同じ「見た目非退行」の正) */
  defaultText: string;
  /**
   * kind="lines" は必須 (行数上限)。kind="multiline"/"rich" は任意 (段落数上限、v1 は未使用)。
   * kind="text" では扱わない (常に単一行)。§5.3: 「行数上限 (原則2、statement は5)」。
   */
  maxLines?: number;
  /**
   * 1 行あたりの文字数上限。未指定は Math.floor(maxLen / maxLines) を既定とする
   * (resolveMaxLineLen 参照)。§3.3 の役割別標準 (PageHead heading ≤20 / statement ≤18) を
   * 明示的に上書きしたい場合のみ設定する。
   */
  maxLineLen?: number;
  /**
   * `route` 以外にも失効させる必要がある公開ルート (v1.1 追加)。例:
   * notes.cta.* は /notes 一覧と notes/[slug] 詳細の両方で同一キーを描画するため、
   * setSlotText の revalidatePath 対象に detail ルートも含める必要がある (T2b が使用)。
   */
  affectedRoutes?: string[];
  /**
   * shared.* / chrome.* 等、ほぼ全静的ルートに影響するスロット (v1.1 追加)。
   * true の場合、setSlotText は EDITABLE_ROUTES 全体を revalidate 対象とする (T2b が使用)。
   */
  affectsAllRoutes?: boolean;
};
