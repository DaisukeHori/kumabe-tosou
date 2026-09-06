/**
 * /admin/prices の下書き state (価格行列セル) を、グレード / サイズ帯の編集に追随させる純関数群。
 *
 * price_matrix は (grade_key, size_key) で price_grades.key / price_size_classes.key を FK 参照する
 * (migration 20260906000010 で on update / on delete cascade 化)。UI 側の state が
 * 「削除済みサイズ帯のセル」「旧グレード key のままのセル」を保持したまま保存すると、
 * RPC 側で存在しない key を参照するセルになり FK 違反 (23503) で保存全体が失敗する。
 * そのため state 変更の時点でセルを追随 (再キー化) / 破棄し、保存直前にも孤児セルを落とす。
 * price-table-editor.tsx (client component) から使う。副作用なし・テスト容易性のため分離。
 */

export type DraftMatrixCellLike = {
  grade_key: string;
  size_key: string;
  price_min: number;
  price_max: number;
};

/** グレード key の変更にセルを追随させる (oldKey → newKey)。同一 key なら入力をそのまま返す。 */
export function rekeyMatrixGrade<T extends DraftMatrixCellLike>(matrix: T[], oldKey: string, newKey: string): T[] {
  if (oldKey === newKey) return matrix;
  return matrix.map((c) => (c.grade_key === oldKey ? { ...c, grade_key: newKey } : c));
}

/** サイズ帯 key の変更にセルを追随させる (oldKey → newKey)。 */
export function rekeyMatrixSize<T extends DraftMatrixCellLike>(matrix: T[], oldKey: string, newKey: string): T[] {
  if (oldKey === newKey) return matrix;
  return matrix.map((c) => (c.size_key === oldKey ? { ...c, size_key: newKey } : c));
}

/** 削除したサイズ帯 key に紐づくセルを落とす。 */
export function dropMatrixCellsForSize<T extends DraftMatrixCellLike>(matrix: T[], sizeKey: string): T[] {
  return matrix.filter((c) => c.size_key !== sizeKey);
}

/** 削除したグレード key に紐づくセルを落とす。 */
export function dropMatrixCellsForGrade<T extends DraftMatrixCellLike>(matrix: T[], gradeKey: string): T[] {
  return matrix.filter((c) => c.grade_key !== gradeKey);
}

/**
 * 保存直前の最終防衛: 現在のグレード key / サイズ帯 key のいずれにも属さない孤児セルを落とす。
 * (再キー化の取りこぼしや、同名 key の重複行を消した場合の残骸を DB に送らないため)
 */
export function pruneOrphanMatrixCells<T extends DraftMatrixCellLike>(
  matrix: T[],
  gradeKeys: Iterable<string>,
  sizeKeys: Iterable<string>,
): T[] {
  const grades = new Set(gradeKeys);
  const sizes = new Set(sizeKeys);
  return matrix.filter((c) => grades.has(c.grade_key) && sizes.has(c.size_key));
}
