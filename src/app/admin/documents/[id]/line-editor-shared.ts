import { useRef } from "react";

import type { TaxCategory } from "@/modules/platform/contracts";
import type { DocumentDetail, DocumentLineInput } from "@/modules/sales/contracts";

/**
 * 明細エディタ (§8.3) の行状態と純粋な変換関数。draft 編集 (document-editor.tsx) と
 * 訂正発行ダイアログ (revision-dialog.tsx — §4.3-B「§8.3 と同じ明細エディタを revision モードで
 * 再利用」) の両方が使う共有ロジック (実装計画書「新規コンポーネント乱造禁止」注記への対応)。
 */
export type LineState = {
  _key: string;
  description: string;
  quantity: string;
  unit: string;
  unit_price_jpy: string;
  amount_jpy: string;
  /** true = 金額セルを手動上書き中 (§8.3「上書き中は『手動』バッジ」)。 */
  _manual: boolean;
  tax_category: TaxCategory;
  work_type_key: string;
  /**
   * pricing/シミュレーター由来スナップショット (grade_key/size_key/option_keys)。UI では編集させず
   * 保存時にラウンドトリップさせるだけ (レビュー地雷回避: これを null 落ちさせると
   * document_save_draft RPC が明細全行置換のため既存の source が発行後ドキュメントから恒久的に
   * 失われ、scheduling の generateBlocksFromLines (§7.7) が grade_key/size_key を得られず
   * 静かに degrade する — getDocumentLinesForBlocks 参照)。
   */
  source: { grade_key: string; size_key: string; option_keys: string[] } | null;
};

let keySeq = 0;
export function nextKey(): string {
  keySeq += 1;
  return `line-${keySeq}`;
}

export function toLineState(l: DocumentDetail["lines"][number]): LineState {
  return {
    _key: nextKey(),
    description: l.description,
    quantity: String(l.quantity),
    unit: l.unit,
    unit_price_jpy: String(l.unit_price_jpy),
    amount_jpy: String(l.amount_jpy),
    _manual: false,
    tax_category: l.tax_category,
    work_type_key: l.work_type_key ?? "",
    source: l.source,
  };
}

export function toDocumentLineInput(l: LineState): DocumentLineInput {
  const quantity = Number(l.quantity) || 0;
  const unit_price_jpy = Number(l.unit_price_jpy) || 0;
  const amount_jpy = Number(l.amount_jpy) || 0;
  return {
    description: l.description,
    quantity,
    unit: l.unit,
    unit_price_jpy,
    amount_jpy,
    tax_category: l.tax_category,
    work_type_key: l.work_type_key.trim() || null,
    // UI でsourceを編集させる項目は無いため、読み込んだ値をそのままラウンドトリップさせる
    // (手動追加行 = blankLine() は source:null のまま — pricing 由来ではないため正しい)。
    source: l.source,
  };
}

export function blankLine(): LineState {
  return {
    _key: nextKey(),
    description: "",
    quantity: "1",
    unit: "式",
    unit_price_jpy: "0",
    amount_jpy: "0",
    _manual: false,
    tax_category: "standard_10",
    work_type_key: "",
    source: null,
  };
}

/** 作業種別ヒント Select の候補 1 件 (Issue #97)。schedulingFacade.listWorkTypes() の label 表示用。 */
export type WorkTypeHintOption = { key: string; label: string };

/**
 * 明細行「作業種別ヒント」Select の option 一覧を組み立てる (Issue #97)。
 * 先頭に「(指定なし)」(value="") を必ず含める。既存明細の work_type_key が候補 (アクティブな
 * 作業種別) に無い場合 — 無効化/削除された場合 — は先頭に「(不明: {key})」を補って現値を保持する
 * (silent data loss 防止: 空 select に落として既存値を失わせない)。
 */
export function workTypeSelectOptions(
  options: WorkTypeHintOption[],
  currentKey: string,
): Array<{ value: string; label: string }> {
  const base = [{ value: "", label: "(指定なし)" }, ...options.map((o) => ({ value: o.key, label: o.label }))];
  if (currentKey.length > 0 && !options.some((o) => o.key === currentKey)) {
    return [{ value: currentKey, label: `(不明: ${currentKey})` }, ...base];
  }
  return base;
}

export type LineKeyboardActions = {
  addLine: (atIndex?: number) => void;
  removeLine: (index: number) => void;
  moveLine: (index: number, direction: -1 | 1) => void;
};

/**
 * 明細行のキーボード操作 (§8.7 チェックリスト): Cmd/Ctrl+Enter=行追加 / Cmd/Ctrl+Backspace=行削除 /
 * Alt+↑↓=行並べ替え / ↑↓ (品名セルのみ、無修飾)=行移動フォーカス。document-editor.tsx (draft編集)
 * と revision-dialog.tsx (訂正発行 — §4.3-B) の両方の明細行 div (onKeyDown) から呼び出す共有ロジック
 * (レビュー地雷回避: revision-dialog.tsx にキーボード操作が未配線だった問題への対応)。
 */
export function useLineRowKeyboard({ addLine, removeLine, moveLine }: LineKeyboardActions) {
  const descriptionRefs = useRef<Array<HTMLInputElement | null>>([]);

  function handleRowKeyDown(e: React.KeyboardEvent<HTMLDivElement>, index: number) {
    const isMeta = e.metaKey || e.ctrlKey;
    if (isMeta && e.key === "Enter") {
      e.preventDefault();
      addLine(index);
    } else if (isMeta && e.key === "Backspace") {
      e.preventDefault();
      removeLine(index);
    } else if (e.altKey && e.key === "ArrowUp") {
      e.preventDefault();
      moveLine(index, -1);
    } else if (e.altKey && e.key === "ArrowDown") {
      e.preventDefault();
      moveLine(index, 1);
    } else if (!e.altKey && !isMeta && e.key === "ArrowUp" && (e.target as HTMLElement).dataset.lineCol === "description") {
      e.preventDefault();
      descriptionRefs.current[index - 1]?.focus();
    } else if (!e.altKey && !isMeta && e.key === "ArrowDown" && (e.target as HTMLElement).dataset.lineCol === "description") {
      e.preventDefault();
      descriptionRefs.current[index + 1]?.focus();
    } else if (e.key === "Escape") {
      (document.activeElement as HTMLElement | null)?.blur();
    }
  }

  return { descriptionRefs, handleRowKeyDown };
}
