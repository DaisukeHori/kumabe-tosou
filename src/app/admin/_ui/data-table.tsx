import { cn } from "@/lib/utils";

/**
 * 一覧 (WorksListTable / PostsListTable / VoicesListTable 等) の見出し行。
 * 各一覧本体 (role="listbox" の grid 行) と同じ grid-cols を渡すことで、
 * 列位置を揃える。キーボード操作・選択状態のロジックは一切持たない
 * (見た目専用の飾り)。
 */
export function DataTableHeaderRow({
  columns,
  gridClassName,
}: {
  columns: string[];
  gridClassName: string;
}) {
  return (
    <div
      className={cn(
        // border-l-4 border-l-transparent: 行側の選択インジケータ (border-l-soul) と
        // 同じ幅の透明ボーダーを入れて、見出しラベルと行内容の x 位置を揃える。
        "grid items-center gap-4 border-b border-l-4 border-l-transparent border-border bg-admin-canvas-deep/60 px-4 py-2 text-xs font-medium text-muted-foreground",
        gridClassName,
      )}
      aria-hidden="true"
    >
      {columns.map((label) => (
        <span key={label} className="truncate">
          {label}
        </span>
      ))}
    </div>
  );
}

/**
 * 一覧行 1 件分の見た目 (hover/選択ハイライト) を組み立てるためのクラス名
 * ヘルパー。行のクリック/キーボード制御ロジックは呼び出し側 (各 ListTable の
 * role="option" 要素) にそのまま残す。
 *
 * 選択行はブランドの差し色 (--soul / 赤) を左ボーダー + 薄い背景で示す。
 * 当初ゼブラ (偶奇で背景を薄くグレーにする) も試したが、選択ハイライトの
 * 薄いグレーと視覚的にほぼ区別が付かなかった (実機スクショで確認して発覚)
 * ため、行区切りは divide-y のみに絞り、選択の視認性を優先している。
 */
export function dataTableRowClassName(isSelected: boolean): string {
  if (isSelected) {
    return "border-l-4 border-l-soul bg-soul/5";
  }
  return "border-l-4 border-l-transparent hover:bg-muted/60";
}
