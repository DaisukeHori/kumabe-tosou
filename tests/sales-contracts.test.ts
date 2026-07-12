import { describe, expect, it } from "vitest";

import {
  STANDARD_LINE_PRESETS,
  zBankAccountSnapshot,
  zCreateDocumentInput,
  zDocumentLineInput,
  zDocumentListFilter,
  zIssuedContentSnapshot,
  zIssuerSnapshot,
  zPaymentInput,
  zReviseDocumentInput,
  zUpdateDraftDocumentInput,
} from "@/modules/sales/contracts";

/**
 * canonical: docs/design/crm-suite/02-sales.md §5.2 (sales 内部契約) / §13.1 sales-contracts.test.ts。
 * DB 接続不要の Zod スキーマ静的検証。
 *
 * 注意 (実装計画書「未解決点2」): §13.1 は zUpdateDraftDocumentInput / zReviseDocumentInput に
 * 「quote 以外で valid_until 非 null 拒否」の refine を要求するが、両スキーマは
 * documents.doc_type を持たない設計 (作成時固定・変更不可のため documents から分離されている)
 * ため、このスキーマ単体では refine を実装できない (contracts.ts 内コメント参照)。
 * doc_type を伴う refine は呼び出し側 (SalesFacade — #49) の責務として明示的に委譲されている。
 * 本ファイルはこの現状の (refine 無し) 仕様を対象に検証し、refine 自体のテストは #49 側に委ねる
 * (openIssue として報告— 「実装計画書 未解決点2」参照)。
 */

const validLine = {
  description: "施工費",
  quantity: 1,
  unit: "式",
  unit_price_jpy: 10_000,
  amount_jpy: 10_000,
  tax_category: "standard_10",
  work_type_key: null,
  source: null,
};

describe("zDocumentLineInput (§4.11 写経部の基本動作)", () => {
  it("正当な明細行を受理する", () => {
    expect(zDocumentLineInput.safeParse(validLine).success).toBe(true);
  });

  it(".strict() により未知キーを拒否する", () => {
    expect(zDocumentLineInput.safeParse({ ...validLine, unexpected: 1 }).success).toBe(false);
  });

  it("quantity は小数第 2 位まで (第 3 位以降は拒否)", () => {
    expect(zDocumentLineInput.safeParse({ ...validLine, quantity: 1.23 }).success).toBe(true);
    expect(zDocumentLineInput.safeParse({ ...validLine, quantity: 1.234 }).success).toBe(false);
  });

  it("unit_price_jpy は負値 (値引き行) を許容する", () => {
    expect(
      zDocumentLineInput.safeParse({ ...validLine, unit_price_jpy: -5000, amount_jpy: -5000 }).success,
    ).toBe(true);
  });
});

describe("zUpdateDraftDocumentInput (draft 更新入力)", () => {
  const base = {
    issue_date: null,
    transaction_date: null,
    valid_until: null,
    billing_name: "サンプル建設",
    billing_suffix: "様",
    billing_address: null,
    site_name: null,
    site_address: null,
    notes: null,
    tax_rounding: "floor",
    lines: [],
  };

  it("lines 0 行を許容する (draft は quote_only 原案パターン。発行時のみ E620 で止まる)", () => {
    expect(zUpdateDraftDocumentInput.safeParse(base).success).toBe(true);
  });

  it("lines 最大 100 行を超えると拒否する", () => {
    const lines = Array.from({ length: 101 }, () => validLine);
    expect(zUpdateDraftDocumentInput.safeParse({ ...base, lines }).success).toBe(false);
  });

  it("lines 100 行ちょうどは受理する", () => {
    const lines = Array.from({ length: 100 }, () => validLine);
    expect(zUpdateDraftDocumentInput.safeParse({ ...base, lines }).success).toBe(true);
  });

  it("billing_suffix は「様」「御中」以外を拒否する", () => {
    expect(zUpdateDraftDocumentInput.safeParse({ ...base, billing_suffix: "殿" }).success).toBe(false);
  });

  it(".strict() により未知キーを拒否する (doc_type の混入防御 — documents.doc_type は本スキーマの管轄外)", () => {
    expect(zUpdateDraftDocumentInput.safeParse({ ...base, doc_type: "quote" }).success).toBe(false);
  });

  it("現状は valid_until 非 null を doc_type に関わらず受理する (refine 未実装 — #49 facade 側に委譲。実装計画書「未解決点2」)", () => {
    expect(zUpdateDraftDocumentInput.safeParse({ ...base, valid_until: "2026-08-01" }).success).toBe(true);
  });
});

describe("zReviseDocumentInput (訂正発行入力)", () => {
  const base = {
    issue_date: "2026-07-11",
    transaction_date: null,
    valid_until: null,
    billing_name: "サンプル建設",
    billing_suffix: "御中",
    billing_address: null,
    site_name: null,
    site_address: null,
    notes: null,
    lines: [validLine],
  };

  it("issue_date は必須 (欠落を拒否)", () => {
    const withoutIssueDate: Record<string, unknown> = { ...base };
    delete withoutIssueDate.issue_date;
    expect(zReviseDocumentInput.safeParse(withoutIssueDate).success).toBe(false);
  });

  it("lines は 1 行以上必須 (0 行を拒否)", () => {
    expect(zReviseDocumentInput.safeParse({ ...base, lines: [] }).success).toBe(false);
  });

  it("transaction_date は nullable (null / 実在日どちらも受理)", () => {
    expect(zReviseDocumentInput.safeParse({ ...base, transaction_date: "2026-07-10" }).success).toBe(true);
    expect(zReviseDocumentInput.safeParse({ ...base, transaction_date: null }).success).toBe(true);
  });

  it("tax_rounding フィールドを持たない (丸め方式は発行後凍結 — void + 再発行でのみ変更可能)。付与すると .strict() が未知キーとして拒否する", () => {
    expect(zReviseDocumentInput.safeParse({ ...base, tax_rounding: "floor" }).success).toBe(false);
  });

  it("現状は valid_until 非 null を doc_type に関わらず受理する (refine 未実装 — #49 facade 側に委譲。実装計画書「未解決点2」)", () => {
    expect(zReviseDocumentInput.safeParse({ ...base, valid_until: "2026-08-01" }).success).toBe(true);
  });
});

describe("zIssuedContentSnapshot (台帳の内容スナップショット)", () => {
  const validSnapshot = {
    doc_type: "invoice",
    doc_no: "I-2026-0001",
    version: 1,
    issue_date: "2026-07-11",
    transaction_date: "2026-07-10",
    valid_until: null,
    billing_name: "サンプル建設",
    billing_suffix: "御中",
    billing_address: null,
    site_name: null,
    site_address: null,
    notes: null,
    tax_rounding: "floor",
    issuer: {
      issuer_name: "隈部塗装",
      registration_number: null,
      address: null,
      tel: null,
      email: null,
      seal_storage_path: null,
      bank_account: null,
      transfer_fee_note: null,
    },
    lines: [
      {
        position: 0,
        description: "施工費",
        quantity: 1,
        unit: "式",
        unit_price_jpy: 10_000,
        amount_jpy: 10_000,
        tax_category: "standard_10",
      },
    ],
    subtotal_jpy: 10_000,
    tax_summary: [{ tax_category: "standard_10", taxable_jpy: 10_000, tax_jpy: 1_000 }],
    total_jpy: 11_000,
  };

  it("代表的な正当値を受理する (.strict() 未知キー拒否込みの基本 parse)", () => {
    expect(zIssuedContentSnapshot.safeParse(validSnapshot).success).toBe(true);
  });

  it(".strict() により未知キーを拒否する", () => {
    expect(zIssuedContentSnapshot.safeParse({ ...validSnapshot, extra: 1 }).success).toBe(false);
  });

  it("transaction_date は必須 (発行時に issue_date で解決済みの確定値。null も欠落も拒否)", () => {
    const withoutTransactionDate: Record<string, unknown> = { ...validSnapshot };
    delete withoutTransactionDate.transaction_date;
    expect(zIssuedContentSnapshot.safeParse(withoutTransactionDate).success).toBe(false);
    expect(zIssuedContentSnapshot.safeParse({ ...validSnapshot, transaction_date: null }).success).toBe(false);
  });

  it("lines は 1 行以上必須", () => {
    expect(zIssuedContentSnapshot.safeParse({ ...validSnapshot, lines: [] }).success).toBe(false);
  });
});

describe("zDocumentListFilter (一覧フィルタ)", () => {
  it("全項目 null を許容する (フィルタなし一覧)", () => {
    expect(
      zDocumentListFilter.safeParse({ doc_type: null, status: null, deal_id: null, q: null }).success,
    ).toBe(true);
  });

  it(".strict() により未知キーを拒否する", () => {
    expect(
      zDocumentListFilter.safeParse({ doc_type: null, status: null, deal_id: null, q: null, page: 1 })
        .success,
    ).toBe(false);
  });
});

describe("zBankAccountSnapshot / zIssuerSnapshot (発行者スナップショット)", () => {
  it("zBankAccountSnapshot の代表値を受理する", () => {
    expect(
      zBankAccountSnapshot.safeParse({
        bank_name: "隈部銀行",
        branch_name: "本店",
        account_type: "ordinary",
        account_number: "1234567",
        account_holder_kana: "クマベトソウ",
      }).success,
    ).toBe(true);
  });

  it("zIssuerSnapshot は任意項目 (bank_account / seal_storage_path 等) の null を許容する", () => {
    expect(
      zIssuerSnapshot.safeParse({
        issuer_name: "隈部塗装",
        registration_number: null,
        address: null,
        tel: null,
        email: null,
        seal_storage_path: null,
        bank_account: null,
        transfer_fee_note: null,
      }).success,
    ).toBe(true);
  });

  it("zIssuerSnapshot.registration_number は T+13桁形式のみ許容 (null = 免税モード)", () => {
    const okBase = {
      issuer_name: "隈部塗装",
      address: null,
      tel: null,
      email: null,
      seal_storage_path: null,
      bank_account: null,
      transfer_fee_note: null,
    };
    expect(
      zIssuerSnapshot.safeParse({ ...okBase, registration_number: "T1234567890123" }).success,
    ).toBe(true);
    expect(
      zIssuerSnapshot.safeParse({ ...okBase, registration_number: "1234567890123" }).success,
    ).toBe(false);
  });
});

describe("STANDARD_LINE_PRESETS (§8.3 定型明細 3 種)", () => {
  it("件数はちょうど 3 件", () => {
    expect(STANDARD_LINE_PRESETS).toHaveLength(3);
  });

  it("ラベルは canonical 指定の 3 種 (初回治具・段取り費 / リピート免除値引き / 送料実費)", () => {
    expect(STANDARD_LINE_PRESETS.map((p) => p.label)).toEqual([
      "初回治具・段取り費",
      "リピートにつき段取り費免除（値引き）",
      "送料（実費）",
    ]);
  });

  it("各プリセットが StandardLinePreset の型 (label/unit/unit_price_jpy/tax_category) を満たす", () => {
    for (const preset of STANDARD_LINE_PRESETS) {
      expect(typeof preset.label).toBe("string");
      expect(typeof preset.unit).toBe("string");
      expect(typeof preset.unit_price_jpy).toBe("number");
      expect(["standard_10", "reduced_8", "zero", "exempt"]).toContain(preset.tax_category);
    }
  });
});

describe("zPaymentInput / zCreateDocumentInput (§4.11 写経部の基本動作)", () => {
  it("zPaymentInput は amount_jpy 0 円以下を拒否する (入金額は 1 円以上)", () => {
    expect(
      zPaymentInput.safeParse({
        document_id: "11111111-1111-1111-1111-111111111111",
        paid_on: "2026-07-11",
        amount_jpy: 0,
        method: "cash",
        memo: null,
      }).success,
    ).toBe(false);
  });

  it("zCreateDocumentInput は lines 0 行をスキーマレベルで拒否する (min(1))", () => {
    expect(
      zCreateDocumentInput.safeParse({
        doc_type: "quote",
        deal_id: "11111111-1111-1111-1111-111111111111",
        issue_date: null,
        valid_until: null,
        site_name: null,
        site_address: null,
        lines: [],
        notes: null,
      }).success,
    ).toBe(false);
  });

  it("zCreateDocumentInput は quote 以外でも valid_until (非 null) をスキーマレベルでは拒否しない (DB check documents_valid_until_check がフェイルセーフ — refine は上位層の責務)", () => {
    expect(
      zCreateDocumentInput.safeParse({
        doc_type: "invoice",
        deal_id: "11111111-1111-4111-8111-111111111111",
        issue_date: null,
        valid_until: "2026-08-01",
        site_name: null,
        site_address: null,
        lines: [validLine],
        notes: null,
      }).success,
    ).toBe(true);
  });
});
