import { describe, expect, it } from "vitest";

import { zInquiryInput } from "@/modules/inquiry/contracts";
import type { EstimateResult, PriceGrade, PriceSizeClass } from "@/modules/pricing/contracts";

import {
  buildInquiryBody,
  buildSimEstimateSnapshot,
  zSimulatorLeadReq,
} from "@/app/api/shop/lead/schema";
import type { SimulatorLeadReq } from "@/app/api/shop/lead/schema";
import type { SimEstimateSnapshot } from "@/modules/crm/contracts";

/**
 * canonical: docs/design/crm-suite/06-simulator.md §4.2〜§4.4 (zSimulatorLeadReq /
 * buildSimEstimateSnapshot / buildInquiryBody 全文)。計画書 issue-60.md「テスト戦略」節。
 * zod のみ・server-only を含まないファイル (schema.ts) のため、facade/DB を経由せず
 * ここで直接 import してテストできる。
 */

function validEstimate(): SimEstimateSnapshot {
  return {
    grade_key: "standard",
    grade_label: "スタンダード",
    size_key: "m",
    size_label: "〜200mm",
    quantity: 10,
    option_keys: ["express"],
    quote_only: false,
    total_min: 14000,
    total_max: 20000,
    applied_tier: "10個以上 -15%",
    breakdown: [{ label: "スタンダード", factor: "〜200mm" }],
  };
}

function validReq(overrides: Partial<SimulatorLeadReq> = {}): SimulatorLeadReq {
  return {
    contact: { name: "山田太郎", email: "yamada@example.com", tel: "090-1234-5678" },
    message: null,
    privacy_agreed: true,
    estimate: validEstimate(),
    honeypot: "",
    form_rendered_at: Date.now(),
    ...overrides,
  };
}

describe("zSimulatorLeadReq — 正常系", () => {
  it("有効な payload は通過する", () => {
    const parsed = zSimulatorLeadReq.safeParse(validReq());
    expect(parsed.success).toBe(true);
  });

  it("tel が null (電話番号未入力) でも通過する", () => {
    const parsed = zSimulatorLeadReq.safeParse(
      validReq({ contact: { name: "山田太郎", email: "yamada@example.com", tel: null } }),
    );
    expect(parsed.success).toBe(true);
  });

  it("message が null (補足なし) でも通過する", () => {
    const parsed = zSimulatorLeadReq.safeParse(validReq({ message: null }));
    expect(parsed.success).toBe(true);
  });

  it("honeypot がちょうど200字なら通過する (境界値)", () => {
    const parsed = zSimulatorLeadReq.safeParse(validReq({ honeypot: "x".repeat(200) }));
    expect(parsed.success).toBe(true);
  });
});

describe("zSimulatorLeadReq — 異常系", () => {
  it("email 欠落 (未定義) は拒否される", () => {
    const req = validReq();
    // @ts-expect-error 意図的に email を欠落させる
    delete req.contact.email;
    const parsed = zSimulatorLeadReq.safeParse(req);
    expect(parsed.success).toBe(false);
  });

  it("email が不正な形式なら拒否される", () => {
    const parsed = zSimulatorLeadReq.safeParse(
      validReq({ contact: { name: "山田太郎", email: "not-an-email", tel: null } }),
    );
    expect(parsed.success).toBe(false);
  });

  it("privacy_agreed=false は拒否される (literal(true) のみ許可)", () => {
    const parsed = zSimulatorLeadReq.safeParse(
      // @ts-expect-error 意図的に false を渡す (型上は許されないランタイム入力の検証)
      validReq({ privacy_agreed: false }),
    );
    expect(parsed.success).toBe(false);
  });

  it("honeypot が201字 (上限超過) なら拒否される (境界値)", () => {
    const parsed = zSimulatorLeadReq.safeParse(validReq({ honeypot: "x".repeat(201) }));
    expect(parsed.success).toBe(false);
  });

  it("strict: トップレベルに余剰キーがあれば拒否される", () => {
    const req = { ...validReq(), option_labels: ["特急仕上げ"] };
    const parsed = zSimulatorLeadReq.safeParse(req);
    expect(parsed.success).toBe(false);
  });

  it("strict: contact に余剰キーがあれば拒否される", () => {
    const req = validReq();
    const parsed = zSimulatorLeadReq.safeParse({
      ...req,
      contact: { ...req.contact, extra: "unexpected" },
    });
    expect(parsed.success).toBe(false);
  });

  it("form_rendered_at が 0 以下は拒否される (positive 制約)", () => {
    const parsed = zSimulatorLeadReq.safeParse(validReq({ form_rendered_at: 0 }));
    expect(parsed.success).toBe(false);
  });
});

describe("buildSimEstimateSnapshot — D7 上限への防御的切り詰め", () => {
  const baseGrade: PriceGrade = {
    id: "grade-1",
    key: "standard",
    label: "x".repeat(31), // 31字 (D7 上限30を1字超過)
    description: "",
    sort_order: 0,
    is_active: true,
    updated_at: new Date().toISOString(),
  };
  const baseSize: PriceSizeClass = {
    key: "m",
    label: "〜200mm",
    max_mm: 200,
    quote_only: false,
    sort_order: 0,
  };
  const baseResult: EstimateResult = {
    quote_only: false,
    total_min: 1000,
    total_max: 2000,
    applied_tier: null,
    breakdown: [{ label: "内訳", factor: "y".repeat(31) }], // factor 31字 (D7 上限30を1字超過)
  };

  it("grade_label が31字なら30字に切り詰められる", () => {
    const snapshot = buildSimEstimateSnapshot({
      grade: baseGrade,
      size: baseSize,
      quantity: 1,
      optionKeys: [],
      result: baseResult,
    });
    expect(snapshot.grade_label.length).toBe(30);
    expect(snapshot.grade_label).toBe("x".repeat(30));
  });

  it("breakdown[].factor が31字なら30字に切り詰められる", () => {
    const snapshot = buildSimEstimateSnapshot({
      grade: baseGrade,
      size: baseSize,
      quantity: 1,
      optionKeys: [],
      result: baseResult,
    });
    expect(snapshot.breakdown[0]?.factor.length).toBe(30);
    expect(snapshot.breakdown[0]?.factor).toBe("y".repeat(30));
  });

  it("optionKeys が11個なら10個に切り詰められる", () => {
    const elevenKeys = Array.from({ length: 11 }, (_, i) => `opt-${i}`);
    const snapshot = buildSimEstimateSnapshot({
      grade: baseGrade,
      size: baseSize,
      quantity: 1,
      optionKeys: elevenKeys,
      result: baseResult,
    });
    expect(snapshot.option_keys).toHaveLength(10);
    expect(snapshot.option_keys).toEqual(elevenKeys.slice(0, 10));
  });

  it("quantity/quote_only/total_min/total_max はそのまま透過する (切り詰め対象外)", () => {
    const snapshot = buildSimEstimateSnapshot({
      grade: baseGrade,
      size: baseSize,
      quantity: 1000,
      optionKeys: [],
      result: { quote_only: false, total_min: 5000, total_max: 9000, applied_tier: null, breakdown: [] },
    });
    expect(snapshot.quantity).toBe(1000);
    expect(snapshot.quote_only).toBe(false);
    expect(snapshot.total_min).toBe(5000);
    expect(snapshot.total_max).toBe(9000);
  });

  it("applied_tier が null ならそのまま null (切り詰め処理で例外にならない)", () => {
    const snapshot = buildSimEstimateSnapshot({
      grade: baseGrade,
      size: baseSize,
      quantity: 1,
      optionKeys: [],
      result: baseResult,
    });
    expect(snapshot.applied_tier).toBeNull();
  });
});

describe("buildInquiryBody — quote_only 分岐 / message 有無 / zInquiryInput.body 通過確認", () => {
  it("quote_only=false のとき概算金額を含む本文を組み立てる", () => {
    const body = buildInquiryBody({
      estimate: validEstimate(),
      optionLabels: ["特急仕上げ"],
      message: null,
    });
    expect(body).toContain("概算: ¥14,000〜¥20,000");
    expect(body).toContain("特急仕上げ");
    expect(body).not.toContain("個別見積もり（サイズ上限超過）");
  });

  it("quote_only=true のとき個別見積もり文言になり金額を含まない", () => {
    const estimate: SimEstimateSnapshot = {
      ...validEstimate(),
      quote_only: true,
      total_min: 0,
      total_max: 0,
      applied_tier: null,
    };
    const body = buildInquiryBody({ estimate, optionLabels: [], message: null });
    expect(body).toContain("概算: 個別見積もり（サイズ上限超過）");
    expect(body).not.toContain("¥0〜¥0");
  });

  it("optionLabels が空ならオプション行は「なし」になる", () => {
    const body = buildInquiryBody({ estimate: validEstimate(), optionLabels: [], message: null });
    expect(body).toContain("オプション: なし");
  });

  it("message が null なら補足メッセージ節が本文に現れない", () => {
    const body = buildInquiryBody({ estimate: validEstimate(), optionLabels: [], message: null });
    expect(body).not.toContain("お客様からのメッセージ");
  });

  it("message が非空なら補足メッセージ節が本文の末尾に追加される", () => {
    const body = buildInquiryBody({
      estimate: validEstimate(),
      optionLabels: [],
      message: "できれば来週中に相談したいです。",
    });
    expect(body).toContain("--- お客様からのメッセージ ---");
    expect(body).toContain("できれば来週中に相談したいです。");
  });

  it("message が空白のみなら補足メッセージ節を追加しない (trim後空)", () => {
    const body = buildInquiryBody({ estimate: validEstimate(), optionLabels: [], message: "   " });
    expect(body).not.toContain("お客様からのメッセージ");
  });

  it("出力は zInquiryInput.body (min10/max5000) を実際に通過する (quote_only=false)", () => {
    const body = buildInquiryBody({
      estimate: validEstimate(),
      optionLabels: ["特急仕上げ"],
      message: "よろしくお願いします。",
    });
    const parsed = zInquiryInput.shape.body.safeParse(body);
    expect(parsed.success).toBe(true);
  });

  it("出力は zInquiryInput.body を実際に通過する (quote_only=true・message無し、最短本文)", () => {
    const estimate: SimEstimateSnapshot = {
      ...validEstimate(),
      quote_only: true,
      total_min: 0,
      total_max: 0,
      applied_tier: null,
    };
    const body = buildInquiryBody({ estimate, optionLabels: [], message: null });
    const parsed = zInquiryInput.shape.body.safeParse(body);
    expect(parsed.success).toBe(true);
  });
});
