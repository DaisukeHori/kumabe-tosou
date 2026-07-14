import { describe, expect, it } from "vitest";

import { CUSTOM_FIELDS_MAX, collectCustomFields } from "@/app/admin/customers/[id]/CustomerEditSheet";

/**
 * canonical: docs/design/crm-suite/01-crm.md §5.2 (v1.3 — Issue #98)。
 * 敵対的レビュー指摘の是正: 51 件超をサーバーに送信すると Zod の生の英語 JSON
 * ([{"origin":"array","code":"too_big","maximum":50,...}]) がそのまま UI に表示されてしまう
 * バグに対し、クライアント側 (collectCustomFields) で 50 件上限を検証し、Save 自体を
 * 分かりやすい日本語メッセージで中断できることを確認する。
 */

function rows(count: number): { label: string; value: string }[] {
  return Array.from({ length: count }, (_, i) => ({ label: `項目${i}`, value: `値${i}` }));
}

describe("CUSTOM_FIELDS_MAX", () => {
  it("zCustomerCustomFields (crm/contracts.ts) の max(50) と同じ値", () => {
    expect(CUSTOM_FIELDS_MAX).toBe(50);
  });
});

describe("collectCustomFields: 50 件上限", () => {
  it("ちょうど 50 件は受け付ける", () => {
    const result = collectCustomFields(rows(50));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(50);
  });

  it("51 件は日本語メッセージで拒否する (KMB-E101 の生 JSON を露出させない)", () => {
    const result = collectCustomFields(rows(51));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("項目が多すぎます。不要な行を削除してください。");
      // 敵対的レビューで指摘された生の Zod JSON を含まないこと
      expect(result.error).not.toMatch(/too_big|origin|maximum/);
    }
  });

  it("100 件でも同じ日本語メッセージで拒否する", () => {
    const result = collectCustomFields(rows(100));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("項目が多すぎます。不要な行を削除してください。");
  });

  it("空行を含めても trim 後の実件数で 51 件超なら拒否する", () => {
    const withBlankRows = [...rows(51), { label: "", value: "" }, { label: "  ", value: "  " }];
    const result = collectCustomFields(withBlankRows);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("項目が多すぎます。不要な行を削除してください。");
  });

  it("50 件以下では既存の重複チェックが優先して働く", () => {
    const result = collectCustomFields([{ label: "築年数", value: "15年" }, { label: "築年数", value: "20年" }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("項目名「築年数」が重複しています。");
  });
});
