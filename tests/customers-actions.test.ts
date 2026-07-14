import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/crm-suite/01-crm.md §5.2 / §7.1 (Server Actions 契約表)。
 * tests/visual-actions.test.ts / tests/calls-actions.test.ts の確立パターン
 * (next/cache・platformFacade.requireAdmin・facade 群を最小フェイクに差し替え、
 * actions.ts のロジックのみ検証) を踏襲する。実 DB には触れない。
 *
 * 敵対的レビュー指摘の是正 (Issue #98): custom_fields 関連の validation エラー全般
 * (件数超過・空ラベル・重複ラベル・個別行の文字数超過) で zod v4 の ZodError#message
 * (issues の JSON.stringify — 生の英語 JSON) がそのまま Result.detail として UI に漏れないこと、
 * 代わりに日本語ガイダンスへ変換されることを検証する。特に「件数超過 (too_big, 配列レベル)」用の
 * 文言が個別行の too_big (label/value 超過) に誤爆しないことを重点的に確認する。
 */

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));

const requireAdminMock = vi.fn();
vi.mock("@/modules/platform/facade", () => ({
  platformFacade: { requireAdmin: (...args: unknown[]) => requireAdminMock(...args) },
}));

const updateCustomerMock = vi.fn();
vi.mock("@/modules/crm/facade", () => ({
  crmFacade: { updateCustomer: (...args: unknown[]) => updateCustomerMock(...args) },
}));

import { updateCustomerAction } from "@/app/admin/customers/actions";

const ADMIN_OK = { ok: true as const, value: { userId: "admin-1" } };
// zod z.string().uuid() は third group が [1-8]、fourth group が [89abAB] 始まりを要求する。
const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const EXPECTED_UPDATED_AT = "2026-01-01T00:00:00Z";

function customFieldsRows(count: number): { label: string; value: string }[] {
  return Array.from({ length: count }, (_, i) => ({ label: `項目${i}`, value: `値${i}` }));
}

function baseFormInput(customFields: { label: string; value: string }[]) {
  return {
    kind: "person" as const,
    name: "田中太郎",
    name_kana: null,
    email: "a@example.com",
    tel_raw: null,
    company_id: null,
    address: null,
    notes: null,
    lifecycle: "lead" as const,
    custom_fields: customFields,
  };
}

describe("updateCustomerAction", () => {
  beforeEach(() => {
    requireAdminMock.mockReset().mockResolvedValue(ADMIN_OK);
    updateCustomerMock.mockReset();
    revalidatePath.mockReset();
  });

  it("custom_fields が 51 件のとき KMB-E101 + 日本語メッセージを返す (生の Zod JSON を露出させない)", async () => {
    const result = await updateCustomerAction(CUSTOMER_ID, baseFormInput(customFieldsRows(51)), EXPECTED_UPDATED_AT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("KMB-E101");
      expect(result.detail).toBe("項目が多すぎます。不要な行を削除してください。");
      expect(result.detail).not.toMatch(/too_big|origin|maximum|"code"/);
    }
    expect(updateCustomerMock).not.toHaveBeenCalled();
  });

  it("custom_fields が 100 件でも同じ日本語メッセージを返す", async () => {
    const result = await updateCustomerAction(CUSTOMER_ID, baseFormInput(customFieldsRows(100)), EXPECTED_UPDATED_AT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toBe("項目が多すぎます。不要な行を削除してください。");
  });

  it("custom_fields がちょうど 50 件なら validation を通過し facade へ委譲する", async () => {
    updateCustomerMock.mockResolvedValue({ ok: true, value: undefined });

    const result = await updateCustomerAction(CUSTOMER_ID, baseFormInput(customFieldsRows(50)), EXPECTED_UPDATED_AT);

    expect(result.ok).toBe(true);
    expect(updateCustomerMock).toHaveBeenCalledTimes(1);
  });

  it("custom_fields のラベルが空文字 (too_small) のとき生の Zod JSON を含まない日本語メッセージを返す", async () => {
    const result = await updateCustomerAction(
      CUSTOMER_ID,
      baseFormInput([{ label: "", value: "v" }]),
      EXPECTED_UPDATED_AT,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("KMB-E101");
      expect(result.detail).not.toMatch(/too_small|too_big|origin|minimum|"code"/);
      // 件数超過用の文言 (誤爆) を返さないこと
      expect(result.detail).not.toBe("項目が多すぎます。不要な行を削除してください。");
      expect(result.detail).toBeTruthy();
    }
    expect(updateCustomerMock).not.toHaveBeenCalled();
  });

  it("custom_fields のラベルが重複 (custom refine) のとき生の Zod JSON を含まない日本語メッセージを返す", async () => {
    const result = await updateCustomerAction(
      CUSTOMER_ID,
      baseFormInput([
        { label: "同じ名前", value: "v1" },
        { label: "同じ名前", value: "v2" },
      ]),
      EXPECTED_UPDATED_AT,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("KMB-E101");
      expect(result.detail).not.toMatch(/"code"|項目名が重複しています/);
      expect(result.detail).not.toBe("項目が多すぎます。不要な行を削除してください。");
      expect(result.detail).toBeTruthy();
    }
    expect(updateCustomerMock).not.toHaveBeenCalled();
  });

  it("custom_fields の 1 行だけ value が 301 文字 (個別 too_big) のとき「項目が多すぎます」を誤爆しない", async () => {
    const result = await updateCustomerAction(
      CUSTOMER_ID,
      baseFormInput([{ label: "備考", value: "a".repeat(301) }]),
      EXPECTED_UPDATED_AT,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("KMB-E101");
      // 件数超過のメッセージ (誤爆) ではないこと — 1 行しかないので件数の話ではない
      expect(result.detail).not.toBe("項目が多すぎます。不要な行を削除してください。");
      expect(result.detail).not.toMatch(/too_big|origin|maximum|"code"/);
      expect(result.detail).toBeTruthy();
    }
    expect(updateCustomerMock).not.toHaveBeenCalled();
  });

  it("custom_fields 以外の validation エラー (名前が空) は too_big 用の変換を行わない", async () => {
    const result = await updateCustomerAction(CUSTOMER_ID, { ...baseFormInput([]), name: "" }, EXPECTED_UPDATED_AT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("KMB-E101");
      expect(result.detail).not.toBe("項目が多すぎます。不要な行を削除してください。");
    }
    expect(updateCustomerMock).not.toHaveBeenCalled();
  });

  it("requireAdmin が失敗した場合は facade も zod parse も呼ばれない", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, code: "KMB-E201" });

    const result = await updateCustomerAction(CUSTOMER_ID, baseFormInput(customFieldsRows(51)), EXPECTED_UPDATED_AT);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E201");
    expect(updateCustomerMock).not.toHaveBeenCalled();
  });
});
