import { describe, expect, it } from "vitest";

import { workTypeSelectOptions } from "@/app/admin/documents/[id]/line-editor-shared";

/**
 * canonical: GitHub Issue #97 §2 (/admin/documents/[id] 明細「作業種別ヒント」の Select 化)。
 * workTypeSelectOptions は候補一覧 + 現在値から <select> の option リストを組み立てる純関数。
 * silent data loss 防止 (候補外の既存 key を落とさない) が主眼。
 */
describe("workTypeSelectOptions", () => {
  const options = [
    { key: "sanding", label: "研磨" },
    { key: "painting", label: "塗装" },
  ];

  it("先頭に「(指定なし)」(value=\"\") を必ず含める", () => {
    const result = workTypeSelectOptions(options, "");
    expect(result[0]).toEqual({ value: "", label: "(指定なし)" });
  });

  it("候補をそのまま label 表示で並べる", () => {
    const result = workTypeSelectOptions(options, "");
    expect(result).toEqual([
      { value: "", label: "(指定なし)" },
      { value: "sanding", label: "研磨" },
      { value: "painting", label: "塗装" },
    ]);
  });

  it("現在値が候補に含まれる場合は「不明」枠を追加しない", () => {
    const result = workTypeSelectOptions(options, "sanding");
    expect(result).toHaveLength(3);
    expect(result.some((o) => o.label.startsWith("(不明"))).toBe(false);
  });

  it("現在値が候補外 (無効化/削除された work_type) の場合は先頭に「(不明: key)」を補い値を保持する", () => {
    const result = workTypeSelectOptions(options, "obsolete_key");
    expect(result[0]).toEqual({ value: "obsolete_key", label: "(不明: obsolete_key)" });
    expect(result).toHaveLength(4);
    // 元の候補は失われない
    expect(result.some((o) => o.value === "sanding")).toBe(true);
  });

  it("現在値が空文字の場合は「不明」枠を追加しない (未設定と区別する)", () => {
    const result = workTypeSelectOptions(options, "");
    expect(result.some((o) => o.label.startsWith("(不明"))).toBe(false);
  });

  it("候補が空でも「(指定なし)」のみは必ず返す", () => {
    const result = workTypeSelectOptions([], "");
    expect(result).toEqual([{ value: "", label: "(指定なし)" }]);
  });
});
