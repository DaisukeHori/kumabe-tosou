import { describe, expect, it } from "vitest";

import {
  DEFAULT_EXECUTION_CONTEXT,
  TAX_RATE_BY_CATEGORY,
  zDateOnly,
  zDocumentNo,
  zInvoiceRegistrationNumber,
  zJpyAmount,
  zJpySignedAmount,
  zTaxCategory,
  zTaxRounding,
  zTelE164,
  type ExecutionContext,
} from "@/modules/platform/contracts";
import { normalizeJpPhoneToE164 } from "@/modules/platform/text";

/**
 * platform/contracts.ts の共通スカラー + platform/text.ts の normalizeJpPhoneToE164 の
 * Zod 検証テスト (00-overview §9.2 M0 行の必須単体 `platform-scalars`)。
 * canonical: docs/module-contracts.md §4.1 / docs/design/crm-suite/00-overview.md §3.5。
 */

describe("ExecutionContext", () => {
  it("DEFAULT_EXECUTION_CONTEXT は session モード", () => {
    expect(DEFAULT_EXECUTION_CONTEXT).toEqual({ mode: "session" });
  });

  it("service モードは client を任意で持てる (型のみの確認)", () => {
    const ctx: ExecutionContext = { mode: "service" };
    expect(ctx.mode).toBe("service");
  });
});

describe("zTelE164", () => {
  it("E.164 形式 (+81...) を受け付ける", () => {
    expect(zTelE164.safeParse("+819012345678").success).toBe(true);
  });

  it("先頭に + がないと拒否する", () => {
    expect(zTelE164.safeParse("819012345678").success).toBe(false);
  });

  it("桁数超過 (16桁超) は拒否する", () => {
    expect(zTelE164.safeParse("+81901234567890123").success).toBe(false);
  });

  it("国番号が 0 始まりは拒否する", () => {
    expect(zTelE164.safeParse("+0819012345678").success).toBe(false);
  });
});

describe("normalizeJpPhoneToE164", () => {
  it("'+819012345678' は素通しする", () => {
    expect(normalizeJpPhoneToE164("+819012345678")).toBe("+819012345678");
  });

  it("固定電話 (市外局番 3 桁・096) をハイフン付きで正規化する", () => {
    expect(normalizeJpPhoneToE164("096-123-4567")).toBe("+81961234567");
  });

  it("固定電話 (市外局番 2 桁・03) をハイフン付きで正規化する", () => {
    expect(normalizeJpPhoneToE164("03-1234-5678")).toBe("+81312345678");
  });

  it("携帯電話 (090) をハイフン付きで正規化する", () => {
    expect(normalizeJpPhoneToE164("090-1234-5678")).toBe("+819012345678");
  });

  it("'anonymous' は null を返す (番号非通知)", () => {
    expect(normalizeJpPhoneToE164("anonymous")).toBeNull();
  });

  it("空文字は null を返す", () => {
    expect(normalizeJpPhoneToE164("")).toBeNull();
  });

  it("全角ハイフンを区切り文字として正規化する", () => {
    expect(normalizeJpPhoneToE164("090－1234－5678")).toBe("+819012345678");
  });

  it("空白と半角括弧を含む入力を正規化する", () => {
    expect(normalizeJpPhoneToE164("(096) 123-4567")).toBe("+81961234567");
  });

  it("全角括弧・全角スペースを含む入力を正規化する", () => {
    expect(normalizeJpPhoneToE164("（096）　123-4567")).toBe("+81961234567");
  });

  it("桁数不足の国内番号は null を返す", () => {
    expect(normalizeJpPhoneToE164("090-123-456")).toBeNull();
  });

  it("先頭 0 の次が 0 の番号 (0120 等はフリーダイヤルで別体系) は現仕様どおり拒否する", () => {
    // '0[1-9]' 始まりの規約どおり、0 の次が 0 の入力は対象外 (null)。
    expect(normalizeJpPhoneToE164("0012345678")).toBeNull();
  });
});

describe("zJpyAmount / zJpySignedAmount", () => {
  it("0 円を受け付ける", () => {
    expect(zJpyAmount.safeParse(0).success).toBe(true);
  });

  it("上限値 9,999,999,999 を受け付ける", () => {
    expect(zJpyAmount.safeParse(9_999_999_999).success).toBe(true);
  });

  it("上限超過は拒否する", () => {
    expect(zJpyAmount.safeParse(10_000_000_000).success).toBe(false);
  });

  it("負数は拒否する (符号なし)", () => {
    expect(zJpyAmount.safeParse(-1).success).toBe(false);
  });

  it("符号付きは負数の下限 -9,999,999,999 を受け付ける", () => {
    expect(zJpySignedAmount.safeParse(-9_999_999_999).success).toBe(true);
  });

  it("符号付きの下限超過 (-10,000,000,000) は拒否する", () => {
    expect(zJpySignedAmount.safeParse(-10_000_000_000).success).toBe(false);
  });

  it("小数は拒否する (整数のみ)", () => {
    expect(zJpyAmount.safeParse(100.5).success).toBe(false);
  });
});

describe("zTaxCategory / TAX_RATE_BY_CATEGORY", () => {
  it("4 区分すべてを受け付ける", () => {
    for (const v of ["standard_10", "reduced_8", "zero", "exempt"] as const) {
      expect(zTaxCategory.safeParse(v).success).toBe(true);
    }
  });

  it("未定義の区分は拒否する", () => {
    expect(zTaxCategory.safeParse("reduced_5").success).toBe(false);
  });

  it("税率対応表が 4 区分と 1:1 対応する", () => {
    expect(TAX_RATE_BY_CATEGORY).toEqual({
      standard_10: 10,
      reduced_8: 8,
      zero: 0,
      exempt: 0,
    });
  });
});

describe("zTaxRounding", () => {
  it("floor/round/ceil を受け付ける", () => {
    for (const v of ["floor", "round", "ceil"] as const) {
      expect(zTaxRounding.safeParse(v).success).toBe(true);
    }
  });

  it("未定義の丸め方式は拒否する", () => {
    expect(zTaxRounding.safeParse("truncate").success).toBe(false);
  });
});

describe("zInvoiceRegistrationNumber", () => {
  it("T + 13桁を受け付ける", () => {
    expect(zInvoiceRegistrationNumber.safeParse("T1234567890123").success).toBe(true);
  });

  it("T が無いと拒否する", () => {
    expect(zInvoiceRegistrationNumber.safeParse("1234567890123").success).toBe(false);
  });

  it("桁数不足は拒否する", () => {
    expect(zInvoiceRegistrationNumber.safeParse("T123456789012").success).toBe(false);
  });

  it("桁数超過は拒否する", () => {
    expect(zInvoiceRegistrationNumber.safeParse("T12345678901234").success).toBe(false);
  });
});

describe("zDocumentNo", () => {
  it("Q/J/D/I いずれの種別も受け付ける (4 桁連番)", () => {
    for (const prefix of ["Q", "J", "D", "I"]) {
      expect(zDocumentNo.safeParse(`${prefix}-2026-0001`).success).toBe(true);
    }
  });

  it("連番が 4 桁超 (自然拡張) も受け付ける", () => {
    expect(zDocumentNo.safeParse("Q-2026-10000").success).toBe(true);
  });

  it("未定義の種別プレフィクスは拒否する", () => {
    expect(zDocumentNo.safeParse("X-2026-0001").success).toBe(false);
  });

  it("連番が 3 桁以下は拒否する", () => {
    expect(zDocumentNo.safeParse("Q-2026-001").success).toBe(false);
  });
});

describe("zDateOnly", () => {
  it("実在する日付を受け付ける", () => {
    expect(zDateOnly.safeParse("2026-07-11").success).toBe(true);
  });

  it("うるう年の 2/29 を受け付ける", () => {
    expect(zDateOnly.safeParse("2024-02-29").success).toBe(true);
  });

  it("実在しない日付 (2026-02-31) は拒否する", () => {
    expect(zDateOnly.safeParse("2026-02-31").success).toBe(false);
  });

  it("非うるう年の 2/29 は拒否する", () => {
    expect(zDateOnly.safeParse("2026-02-29").success).toBe(false);
  });

  it("形式不正 (YYYY/MM/DD) は拒否する", () => {
    expect(zDateOnly.safeParse("2026/07/11").success).toBe(false);
  });
});
