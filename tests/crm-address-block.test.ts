import { describe, expect, it } from "vitest";

import { zCustomerAddressBlock, zPostalCode7 } from "@/modules/crm/contracts";
import { formatPostalCode7, normalizePostalCode7 } from "@/modules/platform/text";
import { collectAddressBlock } from "@/app/admin/customers/[id]/CustomerEditSheet";

/**
 * canonical: docs/design/crm-suite/01-crm.md §5.2 (v1.4 — 顧客の請求先/配送先)。
 * DB 接続不要の単体テスト。zCustomerAddressBlock は customers.billing_info / shipping_info の
 * 唯一の正 — DDL check は jsonb_typeof='object' の構造整合のみ。
 */

function block(overrides: Partial<{
  postal_code: string | null;
  address: string | null;
  tel_e164: string | null;
  name: string | null;
  suffix: "様" | "御中" | null;
}> = {}) {
  return {
    postal_code: null,
    address: null,
    tel_e164: null,
    name: null,
    suffix: null,
    ...overrides,
  };
}

describe("zPostalCode7", () => {
  it("7 桁数字は受け付ける", () => {
    expect(zPostalCode7.safeParse("8600801").success).toBe(true);
  });
  it("6 桁は拒否", () => {
    expect(zPostalCode7.safeParse("860080").success).toBe(false);
  });
  it("8 桁は拒否", () => {
    expect(zPostalCode7.safeParse("86008010").success).toBe(false);
  });
  it("ハイフン付きは拒否 (正規化前提)", () => {
    expect(zPostalCode7.safeParse("860-0801").success).toBe(false);
  });
});

describe("zCustomerAddressBlock", () => {
  it("部分入力 (名前のみ) を受け付ける", () => {
    expect(zCustomerAddressBlock.safeParse(block({ name: "田中太郎" })).success).toBe(true);
  });

  it("郵便番号のみでも受け付ける", () => {
    expect(zCustomerAddressBlock.safeParse(block({ postal_code: "8600801" })).success).toBe(true);
  });

  it("全フィールド null は拒否 (空ブロックは null で送る — refine)", () => {
    expect(zCustomerAddressBlock.safeParse(block()).success).toBe(false);
  });

  it("郵便番号 6 桁は拒否", () => {
    expect(zCustomerAddressBlock.safeParse(block({ postal_code: "860080" })).success).toBe(false);
  });

  it("郵便番号 8 桁は拒否", () => {
    expect(zCustomerAddressBlock.safeParse(block({ postal_code: "86008010" })).success).toBe(false);
  });

  it("郵便番号ハイフン付きは拒否", () => {
    expect(zCustomerAddressBlock.safeParse(block({ postal_code: "860-0801" })).success).toBe(false);
  });

  it("住所 190 字は受け付ける", () => {
    expect(zCustomerAddressBlock.safeParse(block({ address: "あ".repeat(190) })).success).toBe(true);
  });

  it("住所 191 字は拒否", () => {
    expect(zCustomerAddressBlock.safeParse(block({ address: "あ".repeat(191) })).success).toBe(false);
  });

  it("名前 80 字は受け付ける / 81 字は拒否", () => {
    expect(zCustomerAddressBlock.safeParse(block({ name: "あ".repeat(80) })).success).toBe(true);
    expect(zCustomerAddressBlock.safeParse(block({ name: "あ".repeat(81) })).success).toBe(false);
  });

  it("未知のキーは strict() で拒否", () => {
    expect(zCustomerAddressBlock.safeParse({ ...block({ name: "太郎" }), extra: "x" }).success).toBe(false);
  });

  it("suffix は null / 様 / 御中 を受理し、それ以外は拒否", () => {
    expect(zCustomerAddressBlock.safeParse(block({ name: "太郎", suffix: null })).success).toBe(true);
    expect(zCustomerAddressBlock.safeParse(block({ name: "太郎", suffix: "様" })).success).toBe(true);
    expect(zCustomerAddressBlock.safeParse(block({ name: "太郎", suffix: "御中" })).success).toBe(true);
    // 不正な suffix はスキーマ入力 (unknown) として直接渡して拒否を確認する
    expect(
      zCustomerAddressBlock.safeParse({ postal_code: null, address: null, tel_e164: null, name: "太郎", suffix: "殿" }).success,
    ).toBe(false);
  });

  it("tel_e164 は E.164 形式のみ受理", () => {
    expect(zCustomerAddressBlock.safeParse(block({ tel_e164: "+819012345678" })).success).toBe(true);
    expect(zCustomerAddressBlock.safeParse(block({ tel_e164: "090-1234-5678" })).success).toBe(false);
  });
});

describe("normalizePostalCode7", () => {
  it("全角数字を半角 7 桁へ", () => {
    expect(normalizePostalCode7("８６００８０１")).toBe("8600801");
  });
  it("ハイフン付きから数字のみ抽出", () => {
    expect(normalizePostalCode7("860-0801")).toBe("8600801");
  });
  it("空白混じりを許容", () => {
    expect(normalizePostalCode7(" 860 0801 ")).toBe("8600801");
  });
  it("〒 記号付きを許容", () => {
    expect(normalizePostalCode7("〒860-0801")).toBe("8600801");
  });
  it("6 桁は null", () => {
    expect(normalizePostalCode7("860080")).toBe(null);
  });
  it("8 桁は null", () => {
    expect(normalizePostalCode7("86008010")).toBe(null);
  });
  it("数字が無ければ null", () => {
    expect(normalizePostalCode7("abcdefg")).toBe(null);
  });
});

describe("formatPostalCode7", () => {
  it("7 桁を xxx-xxxx へ整形", () => {
    expect(formatPostalCode7("8600801")).toBe("860-0801");
  });
  it("7 桁でなければそのまま返す", () => {
    expect(formatPostalCode7("860080")).toBe("860080");
  });
});

describe("collectAddressBlock", () => {
  it("null ブロックは null を返す", () => {
    const result = collectAddressBlock(null);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(null);
  });

  it("全フィールド空 (trim 後) は null を返す", () => {
    const result = collectAddressBlock({ postal_code: "  ", address: "", tel_raw: null, name: "   ", suffix: null });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(null);
  });

  it("郵便番号が非空かつ正規化後 7 桁でないと中断する", () => {
    const result = collectAddressBlock({ postal_code: "12345", address: null, tel_raw: null, name: "太郎", suffix: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/郵便番号/);
  });

  it("名前・住所を trim し、郵便番号は正規化して返す", () => {
    const result = collectAddressBlock({
      postal_code: "860-0801",
      address: "  熊本市中央区  ",
      tel_raw: "  090-1234-5678  ",
      name: "  田中太郎  ",
      suffix: "様",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        postal_code: "8600801",
        address: "熊本市中央区",
        tel_raw: "090-1234-5678",
        name: "田中太郎",
        suffix: "様",
      });
    }
  });

  it("部分入力 (名前だけ) は許容する", () => {
    const result = collectAddressBlock({ postal_code: null, address: null, tel_raw: null, name: "太郎", suffix: null });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value?.name).toBe("太郎");
  });
});
