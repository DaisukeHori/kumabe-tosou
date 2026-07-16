import { describe, expect, it } from "vitest";

import type { CustomerRef, DealRef } from "@/modules/crm/contracts";
import { previewBillingFields, previewShippingDefaults } from "@/modules/sales/facade";

/**
 * canonical: docs/design/crm-suite/02-sales.md §6.1 (宛名複製規則改訂) / §5.2 (previewBillingFields)。
 * 顧客の billing_info / shipping_info を帳票の billing_* / site_* 初期値へ複製する純粋関数の単体テスト。
 * billing_info が null の顧客では従来 fallback (company 有無で御中/様) とバイト単位で同一結果になる
 * (後方互換の回帰網)。DB 接続不要。
 */

function addressBlock(overrides: Partial<CustomerRef["billing"] & object> = {}): NonNullable<CustomerRef["billing"]> {
  return {
    postal_code: null,
    address: null,
    tel_e164: null,
    name: null,
    suffix: null,
    ...overrides,
  };
}

function dealRef(overrides: {
  billing?: CustomerRef["billing"];
  shipping?: CustomerRef["shipping"];
  company?: DealRef["company"];
} = {}): DealRef {
  return {
    deal_id: "d-1",
    title: "案件",
    stage: "quote_sent",
    updated_at: "2026-07-01T00:00:00Z",
    customer: {
      customer_id: "c-1",
      name: "田中太郎",
      kind: "person",
      address: "顧客住所",
      billing: overrides.billing ?? null,
      shipping: overrides.shipping ?? null,
    },
    company: overrides.company ?? null,
  };
}

const COMPANY: NonNullable<DealRef["company"]> = { company_id: "co-1", name: "サンプル建設", address: "会社住所" };

describe("previewBillingFields — billing_info null (後方互換の回帰網)", () => {
  it("company 有: 会社名 + 御中 + 会社住所", () => {
    expect(previewBillingFields(dealRef({ company: COMPANY }))).toEqual({
      billing_name: "サンプル建設",
      billing_suffix: "御中",
      billing_address: "会社住所",
    });
  });

  it("company 無: 顧客名 + 様 + 顧客住所", () => {
    expect(previewBillingFields(dealRef())).toEqual({
      billing_name: "田中太郎",
      billing_suffix: "様",
      billing_address: "顧客住所",
    });
  });
});

describe("previewBillingFields — billing_info によるフィールド単位フォールバック", () => {
  it("name のみ: name は billing、suffix/address は fallback", () => {
    expect(previewBillingFields(dealRef({ billing: addressBlock({ name: "請求太郎" }) }))).toEqual({
      billing_name: "請求太郎",
      billing_suffix: "様",
      billing_address: "顧客住所",
    });
  });

  it("address のみ (postal なし): billing_address は住所そのまま、name/suffix は fallback", () => {
    expect(previewBillingFields(dealRef({ billing: addressBlock({ address: "請求先住所" }) }))).toEqual({
      billing_name: "田中太郎",
      billing_suffix: "様",
      billing_address: "請求先住所",
    });
  });

  it("postal のみ (address なし): composePostalAddress は不採用 → address は fallback", () => {
    expect(previewBillingFields(dealRef({ billing: addressBlock({ postal_code: "8600801" }) }))).toEqual({
      billing_name: "田中太郎",
      billing_suffix: "様",
      billing_address: "顧客住所",
    });
  });

  it("全部あり: すべて billing 由来 (postal + address は 〒 合成)", () => {
    expect(
      previewBillingFields(
        dealRef({ billing: addressBlock({ postal_code: "8600801", address: "熊本市中央区", name: "請求太郎", suffix: "御中" }) }),
      ),
    ).toEqual({
      billing_name: "請求太郎",
      billing_suffix: "御中",
      billing_address: "〒860-0801 熊本市中央区",
    });
  });

  it("billing.suffix 非 null は最優先で採用する (company 有でも billing.suffix を勝たせる)", () => {
    expect(
      previewBillingFields(dealRef({ company: COMPANY, billing: addressBlock({ name: "個人名", suffix: "様" }) })),
    ).toEqual({
      billing_name: "個人名",
      billing_suffix: "様",
      billing_address: "会社住所",
    });
  });

  it("billing.suffix null は従来規則 (company 有 → 御中) にフォールバック", () => {
    expect(previewBillingFields(dealRef({ company: COMPANY, billing: addressBlock({ name: "担当者名" }) }))).toEqual({
      billing_name: "担当者名",
      billing_suffix: "御中",
      billing_address: "会社住所",
    });
  });
});

describe("composePostalAddress (billing_address 経由で観測)", () => {
  it("190 字 address + 〒 = ちょうど 200 字 (documents 側 Zod 上限)", () => {
    const addr = "あ".repeat(190);
    const result = previewBillingFields(dealRef({ billing: addressBlock({ postal_code: "1234567", address: addr }) }));
    expect(result.billing_address).toBe(`〒123-4567 ${addr}`);
    expect(result.billing_address?.length).toBe(200);
  });

  it("postal null: 住所そのまま", () => {
    const result = previewBillingFields(dealRef({ billing: addressBlock({ address: "住所のみ" }) }));
    expect(result.billing_address).toBe("住所のみ");
  });

  it("address null: null 扱い → fallback へ", () => {
    const result = previewBillingFields(dealRef({ billing: addressBlock({ postal_code: "1234567" }) }));
    expect(result.billing_address).toBe("顧客住所");
  });
});

describe("previewShippingDefaults — site_name/site_address 初期値", () => {
  it("shipping null: 両方 null", () => {
    expect(previewShippingDefaults(dealRef())).toEqual({ site_name: null, site_address: null });
  });

  it("shipping 全部あり: name と 〒 合成住所", () => {
    expect(
      previewShippingDefaults(dealRef({ shipping: addressBlock({ name: "現場A", postal_code: "8600801", address: "熊本市" }) })),
    ).toEqual({ site_name: "現場A", site_address: "〒860-0801 熊本市" });
  });

  it("shipping postal のみ (address なし): site_address は null", () => {
    expect(previewShippingDefaults(dealRef({ shipping: addressBlock({ postal_code: "8600801" }) }))).toEqual({
      site_name: null,
      site_address: null,
    });
  });
});
