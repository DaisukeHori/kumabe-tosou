import { describe, expect, it } from "vitest";

import {
  zCustomerCustomField,
  zCustomerCustomFields,
  zCustomerUpdateInput,
} from "@/modules/crm/contracts";

/**
 * canonical: docs/design/crm-suite/01-crm.md §5.2 (v1.3 — Issue #98)。
 * DB 接続不要の単体テスト (Zod parse のみ)。zCustomerCustomFields は customers.custom_fields
 * (順序保持の {label,value} ペア配列) の唯一の正 — DDL check は jsonb_typeof='array' のみ。
 */

function field(label: string, value: string) {
  return { label, value };
}

describe("zCustomerCustomField (1 要素)", () => {
  it("妥当な label/value を受け付ける", () => {
    const result = zCustomerCustomField.safeParse(field("外壁材質", "サイディング"));
    expect(result.success).toBe(true);
  });

  it("label が空文字は拒否 (zShortText min 1)", () => {
    expect(zCustomerCustomField.safeParse(field("", "値")).success).toBe(false);
  });

  it("value が空文字は拒否 (min 1)", () => {
    expect(zCustomerCustomField.safeParse(field("項目名", "")).success).toBe(false);
  });

  it("label が 30 字超は拒否", () => {
    expect(zCustomerCustomField.safeParse(field("あ".repeat(31), "値")).success).toBe(false);
  });

  it("label ちょうど 30 字は受け付ける", () => {
    expect(zCustomerCustomField.safeParse(field("あ".repeat(30), "値")).success).toBe(true);
  });

  it("value が 300 字超は拒否", () => {
    expect(zCustomerCustomField.safeParse(field("項目名", "あ".repeat(301))).success).toBe(false);
  });

  it("value ちょうど 300 字は受け付ける", () => {
    expect(zCustomerCustomField.safeParse(field("項目名", "あ".repeat(300))).success).toBe(true);
  });

  it("未知のキーは strict() で拒否", () => {
    const result = zCustomerCustomField.safeParse({ label: "項目名", value: "値", extra: "x" });
    expect(result.success).toBe(false);
  });

  it("label は NFC 正規化される (基底文字+結合文字の分解形 → 合成済み文字)", () => {
    // \u304B (か) + \u3099 (結合濁点) の分解形は NFC 正規化で合成済みの \u304C (が) になる
    const decomposed = "\u304B\u3099";
    const composed = "\u304C";
    expect(decomposed).not.toBe(composed);
    const result = zCustomerCustomField.safeParse(field(decomposed, "値"));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.label).toBe(composed);
  });
});

describe("zCustomerCustomFields (配列)", () => {
  it("空配列を受け付ける (既定値相当)", () => {
    expect(zCustomerCustomFields.safeParse([]).success).toBe(true);
  });

  it("複数の異なるラベルは受け付ける", () => {
    const result = zCustomerCustomFields.safeParse([
      field("外壁材質", "サイディング"),
      field("築年数", "15年"),
      field("駐車場", "あり"),
    ]);
    expect(result.success).toBe(true);
  });

  it("ラベル重複は拒否される", () => {
    const result = zCustomerCustomFields.safeParse([field("築年数", "15年"), field("築年数", "20年")]);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message === "項目名が重複しています")).toBe(true);
    }
  });

  it("ちょうど 50 件は受け付ける", () => {
    const rows = Array.from({ length: 50 }, (_, i) => field(`項目${i}`, `値${i}`));
    expect(zCustomerCustomFields.safeParse(rows).success).toBe(true);
  });

  it("51 件は拒否される (max 50)", () => {
    const rows = Array.from({ length: 51 }, (_, i) => field(`項目${i}`, `値${i}`));
    const result = zCustomerCustomFields.safeParse(rows);
    expect(result.success).toBe(false);
  });

  it("要素内に空ラベルがあれば配列ごと拒否", () => {
    const result = zCustomerCustomFields.safeParse([field("外壁材質", "サイディング"), field("", "値")]);
    expect(result.success).toBe(false);
  });

  it("要素内に空値があれば配列ごと拒否", () => {
    const result = zCustomerCustomFields.safeParse([field("外壁材質", "")]);
    expect(result.success).toBe(false);
  });
});

describe("zCustomerUpdateInput (custom_fields は必須 — .default([]) にしない設計)", () => {
  const baseInput = {
    kind: "person" as const,
    name: "田中太郎",
    name_kana: null,
    email: "a@example.com",
    tel_e164: null,
    company_id: null,
    address: null,
    notes: null,
    lifecycle: "lead" as const,
  };

  it("custom_fields を省略すると拒否される (stale クライアントの silent wipe 防止)", () => {
    const result = zCustomerUpdateInput.safeParse(baseInput);
    expect(result.success).toBe(false);
  });

  it("custom_fields: [] を明示すれば受け付ける", () => {
    const result = zCustomerUpdateInput.safeParse({ ...baseInput, custom_fields: [] });
    expect(result.success).toBe(true);
  });

  it("custom_fields に妥当な項目があれば受け付ける", () => {
    const result = zCustomerUpdateInput.safeParse({
      ...baseInput,
      custom_fields: [field("外壁材質", "サイディング")],
    });
    expect(result.success).toBe(true);
  });

  it("custom_fields のラベル重複は zCustomerUpdateInput 経由でも拒否される", () => {
    const result = zCustomerUpdateInput.safeParse({
      ...baseInput,
      custom_fields: [field("築年数", "15年"), field("築年数", "20年")],
    });
    expect(result.success).toBe(false);
  });
});
