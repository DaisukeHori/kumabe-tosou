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
    billing_info: null,
    shipping_info: null,
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

  // ---- 請求先/配送先 (billing_info / shipping_info) の検証エラー変換 (生 JSON 露出の回帰) ----

  function emptyBlock() {
    return { postal_code: null, address: null, tel_raw: null, name: null, suffix: null } as {
      postal_code: string | null;
      address: string | null;
      tel_raw: string | null;
      name: string | null;
      suffix: "様" | "御中" | null;
    };
  }

  it("billing_info の名前が 81 字のとき請求先ラベル付き日本語メッセージを返す (生 JSON 非露出)", async () => {
    const input = { ...baseFormInput([]), billing_info: { ...emptyBlock(), name: "あ".repeat(81) } };
    const result = await updateCustomerAction(CUSTOMER_ID, input, EXPECTED_UPDATED_AT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("KMB-E101");
      expect(result.detail).toBe("請求先の名前は80文字以内で入力してください。");
      expect(result.detail).not.toMatch(/too_big|origin|maximum|"code"/);
    }
    expect(updateCustomerMock).not.toHaveBeenCalled();
  });

  it("billing_info の郵便番号が不正 (5 桁) のとき請求先の郵便番号エラー (KMB-E610) へ変換する", async () => {
    const input = { ...baseFormInput([]), billing_info: { ...emptyBlock(), name: "太郎", postal_code: "12345" } };
    const result = await updateCustomerAction(CUSTOMER_ID, input, EXPECTED_UPDATED_AT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("KMB-E101");
      expect(result.detail).toBe("請求先の郵便番号は7桁の数字で入力してください (KMB-E610)。");
      expect(result.detail).not.toMatch(/invalid_string|regex|"code"/);
    }
    expect(updateCustomerMock).not.toHaveBeenCalled();
  });

  it("shipping_info の住所が 191 字のとき配送先ラベル付き日本語メッセージを返す", async () => {
    const input = { ...baseFormInput([]), shipping_info: { ...emptyBlock(), address: "あ".repeat(191) } };
    const result = await updateCustomerAction(CUSTOMER_ID, input, EXPECTED_UPDATED_AT);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("KMB-E101");
      expect(result.detail).toBe("配送先の住所は190文字以内で入力してください。");
      expect(result.detail).not.toMatch(/too_big|origin|maximum|"code"/);
    }
    expect(updateCustomerMock).not.toHaveBeenCalled();
  });

  it("有効な billing_info / shipping_info は facade へ委譲される", async () => {
    updateCustomerMock.mockResolvedValue({ ok: true, value: undefined });
    const input = {
      ...baseFormInput([]),
      billing_info: { ...emptyBlock(), name: "請求太郎", postal_code: "860-0801", address: "熊本市", suffix: "御中" as const },
      shipping_info: { ...emptyBlock(), name: "現場A", address: "工事現場" },
    };
    const result = await updateCustomerAction(CUSTOMER_ID, input, EXPECTED_UPDATED_AT);

    expect(result.ok).toBe(true);
    expect(updateCustomerMock).toHaveBeenCalledTimes(1);
    // postal は 7 桁へ正規化されて facade に渡ること
    const passed = updateCustomerMock.mock.calls[0]?.[1] as { billing_info: { postal_code: string } };
    expect(passed.billing_info.postal_code).toBe("8600801");
  });

  // ---- 3 本の tel_raw 失敗はブロック別ラベルで区別する ----

  it("基本連絡先の電話番号が不正なとき基本ラベルの文言を返す", async () => {
    const input = { ...baseFormInput([]), tel_raw: "abc" };
    const result = await updateCustomerAction(CUSTOMER_ID, input, EXPECTED_UPDATED_AT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toBe("基本連絡先の電話番号の形式が正しくありません。");
    expect(updateCustomerMock).not.toHaveBeenCalled();
  });

  it("請求先の電話番号が不正なとき請求先ラベルの文言を返す", async () => {
    const input = { ...baseFormInput([]), billing_info: { ...emptyBlock(), name: "太郎", tel_raw: "abc" } };
    const result = await updateCustomerAction(CUSTOMER_ID, input, EXPECTED_UPDATED_AT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toBe("請求先の電話番号の形式が正しくありません。");
    expect(updateCustomerMock).not.toHaveBeenCalled();
  });

  it("配送先の電話番号が不正なとき配送先ラベルの文言を返す", async () => {
    const input = { ...baseFormInput([]), shipping_info: { ...emptyBlock(), name: "現場", tel_raw: "abc" } };
    const result = await updateCustomerAction(CUSTOMER_ID, input, EXPECTED_UPDATED_AT);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toBe("配送先の電話番号の形式が正しくありません。");
    expect(updateCustomerMock).not.toHaveBeenCalled();
  });
});
