import { describe, expect, it } from "vitest";

import {
  dropMatrixCellsForGrade,
  dropMatrixCellsForSize,
  pruneOrphanMatrixCells,
  rekeyMatrixGrade,
  rekeyMatrixSize,
} from "@/app/admin/prices/draft-matrix";

/**
 * /admin/prices の下書き行列セルがグレード / サイズ帯の編集に追随することの検証
 * (回帰: 削除したサイズ帯・変更したグレード key のセルを state に残したまま保存すると
 * price_matrix の FK 違反で保存全体が失敗していた)。
 */

const matrix = [
  { grade_key: "standard", size_key: "s", price_min: 1000, price_max: 2000 },
  { grade_key: "standard", size_key: "m", price_min: 2000, price_max: 3000 },
  { grade_key: "premium", size_key: "s", price_min: 3000, price_max: 4000 },
];

describe("rekeyMatrixGrade / rekeyMatrixSize", () => {
  it("グレード key 変更時、旧 key のセルだけ新 key に付け替える (他のセルは不変)", () => {
    const next = rekeyMatrixGrade(matrix, "standard", "basic");
    expect(next.map((c) => c.grade_key)).toEqual(["basic", "basic", "premium"]);
    expect(next[0]).toEqual({ grade_key: "basic", size_key: "s", price_min: 1000, price_max: 2000 });
    // 元配列は変更しない
    expect(matrix[0]?.grade_key).toBe("standard");
  });

  it("同じ key への変更は同一配列を返す (再レンダ抑止)", () => {
    expect(rekeyMatrixGrade(matrix, "standard", "standard")).toBe(matrix);
    expect(rekeyMatrixSize(matrix, "s", "s")).toBe(matrix);
  });

  it("サイズ帯 key 変更時、旧 key のセルだけ新 key に付け替える", () => {
    const next = rekeyMatrixSize(matrix, "s", "xs");
    expect(next.map((c) => c.size_key)).toEqual(["xs", "m", "xs"]);
  });
});

describe("dropMatrixCellsForSize / dropMatrixCellsForGrade", () => {
  it("削除したサイズ帯に紐づくセルを落とす", () => {
    const next = dropMatrixCellsForSize(matrix, "s");
    expect(next).toEqual([{ grade_key: "standard", size_key: "m", price_min: 2000, price_max: 3000 }]);
  });

  it("削除したグレードに紐づくセルを落とす", () => {
    const next = dropMatrixCellsForGrade(matrix, "premium");
    expect(next.map((c) => c.grade_key)).toEqual(["standard", "standard"]);
  });
});

describe("pruneOrphanMatrixCells", () => {
  it("現在のグレード / サイズ帯のいずれにも属さないセルを落とす", () => {
    const next = pruneOrphanMatrixCells(matrix, ["standard"], ["s"]);
    expect(next).toEqual([{ grade_key: "standard", size_key: "s", price_min: 1000, price_max: 2000 }]);
  });

  it("全セルが有効なら全件残す", () => {
    expect(pruneOrphanMatrixCells(matrix, ["standard", "premium"], ["s", "m"])).toHaveLength(3);
  });
});
