import { describe, expect, it } from "vitest";

import {
  ACTIVITY_PAYLOAD_SCHEMAS,
  zAppendActivityInput,
  zCallActivityPayload,
  zDocumentEventActivityPayload,
  zEmailActivityPayload,
  zFormSubmissionActivityPayload,
  zNoteActivityPayload,
  zSimulatorEstimateActivityPayload,
  zSystemActivityPayload,
  zTaskEventActivityPayload,
  zWorkLogActivityPayload,
} from "@/modules/crm/contracts";

/**
 * canonical: docs/design/crm-suite/07-contracts-delta.md §4.10 (ACTIVITY_PAYLOAD_SCHEMAS / zAppendActivityInput)。
 * DB 接続不要の単体テスト (Zod parse のみ)。
 */

// ---------------------------------------------------------------------------
// ACTIVITY_PAYLOAD_SCHEMAS: 9 type × 正常 parse
// ---------------------------------------------------------------------------

describe("ACTIVITY_PAYLOAD_SCHEMAS (9 type の正常 parse)", () => {
  it("note: 空オブジェクトを受け付ける (本文は activities.body 側)", () => {
    expect(zNoteActivityPayload.safeParse({}).success).toBe(true);
  });

  it("call: 妥当な最小値を受け付ける", () => {
    const result = zCallActivityPayload.safeParse({
      call_id: "550e8400-e29b-41d4-a716-446655440000",
      direction: "inbound",
      duration_seconds: 120,
      has_recording: true,
      summary: null,
    });
    expect(result.success).toBe(true);
  });

  it("email: Phase 2 予約スキーマとして正しく parse できる (v1 挿入拒否は appendActivity 実装 (#43) の責務。ここでは契約としての parse 可能性のみ確認)", () => {
    const result = zEmailActivityPayload.safeParse({ direction: "outbound", subject: "件名" });
    expect(result.success).toBe(true);
  });

  it("form_submission: 妥当な最小値を受け付ける", () => {
    const result = zFormSubmissionActivityPayload.safeParse({
      inquiry_id: "550e8400-e29b-41d4-a716-446655440000",
      inquiry_type: "estimate",
      excerpt: "見積もりをお願いします",
    });
    expect(result.success).toBe(true);
  });

  it("simulator_estimate: 妥当な最小値を受け付ける", () => {
    const result = zSimulatorEstimateActivityPayload.safeParse({
      estimate: {
        grade_key: "standard",
        grade_label: "標準",
        size_key: "m",
        size_label: "中型車",
        quantity: 1,
        option_keys: [],
        quote_only: false,
        total_min: 100_000,
        total_max: 150_000,
        applied_tier: null,
        breakdown: [],
      },
      price_note: null,
    });
    expect(result.success).toBe(true);
  });

  it("document_event: 妥当な最小値を受け付ける", () => {
    const result = zDocumentEventActivityPayload.safeParse({
      document_id: "550e8400-e29b-41d4-a716-446655440000",
      doc_type: "quote",
      doc_no: "Q-2026-0001",
      event: "issued",
      total_jpy: 100_000,
      version: 1,
    });
    expect(result.success).toBe(true);
  });

  it("work_log: 妥当な最小値を受け付ける", () => {
    const result = zWorkLogActivityPayload.safeParse({
      work_block_id: "550e8400-e29b-41d4-a716-446655440000",
      work_type_key: "painting",
      work_type_label: "塗装",
      planned_hours: 4,
      actual_hours: 4.5,
      performed_on: "2026-07-11",
    });
    expect(result.success).toBe(true);
  });

  it("task_event: 妥当な最小値を受け付ける", () => {
    const result = zTaskEventActivityPayload.safeParse({
      task_id: "550e8400-e29b-41d4-a716-446655440000",
      event: "created",
      origin: "manual",
    });
    expect(result.success).toBe(true);
  });

  it("system: 妥当な最小値を受け付ける", () => {
    const result = zSystemActivityPayload.safeParse({ code: "lead.intake", detail: null });
    expect(result.success).toBe(true);
  });

  it("ACTIVITY_PAYLOAD_SCHEMAS は 9 キーちょうど (DB check 制約と 1:1)", () => {
    expect(Object.keys(ACTIVITY_PAYLOAD_SCHEMAS).sort()).toEqual(
      [
        "call",
        "document_event",
        "email",
        "form_submission",
        "note",
        "simulator_estimate",
        "system",
        "task_event",
        "work_log",
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// .strict(): 必須欠落・未知キー拒否
// ---------------------------------------------------------------------------

describe("ACTIVITY_PAYLOAD_SCHEMAS (.strict() — 必須欠落・未知キー拒否)", () => {
  it("call: 必須欠落 (duration_seconds なし) を拒否する", () => {
    const result = zCallActivityPayload.safeParse({
      call_id: "550e8400-e29b-41d4-a716-446655440000",
      direction: "inbound",
      has_recording: true,
      summary: null,
    });
    expect(result.success).toBe(false);
  });

  it("call: 未知キーを拒否する (.strict())", () => {
    const result = zCallActivityPayload.safeParse({
      call_id: "550e8400-e29b-41d4-a716-446655440000",
      direction: "inbound",
      duration_seconds: 120,
      has_recording: true,
      summary: null,
      unexpected_field: "boom",
    });
    expect(result.success).toBe(false);
  });

  it("form_submission: 必須欠落 (inquiry_type なし) を拒否する", () => {
    const result = zFormSubmissionActivityPayload.safeParse({
      inquiry_id: "550e8400-e29b-41d4-a716-446655440000",
      excerpt: "本文",
    });
    expect(result.success).toBe(false);
  });

  it("form_submission: 未知キーを拒否する", () => {
    const result = zFormSubmissionActivityPayload.safeParse({
      inquiry_id: "550e8400-e29b-41d4-a716-446655440000",
      inquiry_type: "estimate",
      excerpt: "本文",
      extra: 1,
    });
    expect(result.success).toBe(false);
  });

  it("simulator_estimate: 必須欠落 (estimate.breakdown なし) をネスト先まで拒否する", () => {
    const result = zSimulatorEstimateActivityPayload.safeParse({
      estimate: {
        grade_key: "standard",
        grade_label: "標準",
        size_key: "m",
        size_label: "中型車",
        quantity: 1,
        option_keys: [],
        quote_only: false,
        total_min: 100_000,
        total_max: 150_000,
        applied_tier: null,
      },
      price_note: null,
    });
    expect(result.success).toBe(false);
  });

  it("document_event: 未知の event 値を拒否する", () => {
    const result = zDocumentEventActivityPayload.safeParse({
      document_id: "550e8400-e29b-41d4-a716-446655440000",
      doc_type: "quote",
      doc_no: "Q-2026-0001",
      event: "not_a_real_event",
      total_jpy: 100_000,
      version: 1,
    });
    expect(result.success).toBe(false);
  });

  it("work_log: 未知キーを拒否する", () => {
    const result = zWorkLogActivityPayload.safeParse({
      work_block_id: "550e8400-e29b-41d4-a716-446655440000",
      work_type_key: "painting",
      work_type_label: "塗装",
      planned_hours: 4,
      actual_hours: 4.5,
      performed_on: "2026-07-11",
      note: "余計なキー",
    });
    expect(result.success).toBe(false);
  });

  it("task_event: 必須欠落 (origin なし) を拒否する", () => {
    const result = zTaskEventActivityPayload.safeParse({
      task_id: "550e8400-e29b-41d4-a716-446655440000",
      event: "created",
    });
    expect(result.success).toBe(false);
  });

  it("system: 未知キーを拒否する", () => {
    const result = zSystemActivityPayload.safeParse({ code: "x", detail: null, extra: true });
    expect(result.success).toBe(false);
  });

  it("note: 未知キーを拒否する (空オブジェクト以外は全て拒否)", () => {
    const result = zNoteActivityPayload.safeParse({ body: "not allowed here" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// zAppendActivityInput
// ---------------------------------------------------------------------------

function baseAppendActivityInput() {
  return {
    activity_type: "note" as const,
    occurred_at: "2026-07-11T00:00:00.000Z",
    title: "メモ",
    body: "本文",
    payload: {},
    ref_table: null,
    ref_id: null,
    links: [{ customer_id: "550e8400-e29b-41d4-a716-446655440000", company_id: null, deal_id: null }],
  };
}

describe("zAppendActivityInput", () => {
  it("妥当な最小入力を受け付ける", () => {
    const result = zAppendActivityInput.safeParse(baseAppendActivityInput());
    expect(result.success).toBe(true);
  });

  it("activity_type は ACTIVITY_PAYLOAD_SCHEMAS のキーから導出される (9 種すべて許可)", () => {
    for (const type of Object.keys(ACTIVITY_PAYLOAD_SCHEMAS)) {
      const result = zAppendActivityInput.safeParse({ ...baseAppendActivityInput(), activity_type: type });
      expect(result.success, `activity_type=${type} は許可されるべき`).toBe(true);
    }
  });

  it("未知の activity_type を拒否する (map キー導出のため契約外の値は自動的に拒否される)", () => {
    const result = zAppendActivityInput.safeParse({
      ...baseAppendActivityInput(),
      activity_type: "not_a_real_type",
    });
    expect(result.success).toBe(false);
  });

  it("links 0 件 (min(1) 違反) を拒否する", () => {
    const result = zAppendActivityInput.safeParse({ ...baseAppendActivityInput(), links: [] });
    expect(result.success).toBe(false);
  });

  it("links 7 件以上 (max(6) 違反) を拒否する", () => {
    const links = Array.from({ length: 7 }, () => ({
      customer_id: "550e8400-e29b-41d4-a716-446655440000",
      company_id: null,
      deal_id: null,
    }));
    const result = zAppendActivityInput.safeParse({ ...baseAppendActivityInput(), links });
    expect(result.success).toBe(false);
  });

  it("1 行につき対象 2 つ (num_nonnulls≠1) を拒否する", () => {
    const result = zAppendActivityInput.safeParse({
      ...baseAppendActivityInput(),
      links: [
        {
          customer_id: "550e8400-e29b-41d4-a716-446655440000",
          company_id: "550e8400-e29b-41d4-a716-446655440001",
          deal_id: null,
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("1 行につき対象 0 つ (全 null) を拒否する", () => {
    const result = zAppendActivityInput.safeParse({
      ...baseAppendActivityInput(),
      links: [{ customer_id: null, company_id: null, deal_id: null }],
    });
    expect(result.success).toBe(false);
  });

  it(
    "ref_table / ref_id の片側 NULL は zAppendActivityInput 単体では拒否されない " +
      "(07-contracts-delta §4.10 の当該スキーマに num_nonnulls 相当の refine は定義されていない — " +
      "実装計画 issue-42 §未解決点1 の判断どおり、DB 制約 activities_ref_pair " +
      "((ref_table is null) = (ref_id is null)) 側の責務として整理する。本ケースは結合テスト " +
      "(migration 20260711000023 適用後) 側で拒否を確認する)",
    () => {
      const result = zAppendActivityInput.safeParse({
        ...baseAppendActivityInput(),
        ref_table: "contact_inquiries",
        ref_id: null,
      });
      expect(result.success).toBe(true);
    },
  );

  it("ref_table・ref_id が両方非 NULL の妥当な組は受け付ける", () => {
    const result = zAppendActivityInput.safeParse({
      ...baseAppendActivityInput(),
      ref_table: "contact_inquiries",
      ref_id: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(result.success).toBe(true);
  });

  it("title の上限 (120 字) 超過を拒否する", () => {
    const result = zAppendActivityInput.safeParse({
      ...baseAppendActivityInput(),
      title: "あ".repeat(121),
    });
    expect(result.success).toBe(false);
  });
});
