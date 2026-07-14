import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/crm-suite/02-sales.md §6.1 issueDocument 手順 2 / §13.1。
 * internal/issuer.ts は settingsFacade (`@/modules/settings/facade`) にのみ依存するため、
 * settingsFacade.get をモックして DB 非依存で検証する (tests/inquiry-notify.test.ts の
 * vi.mock パターン踏襲)。
 */

const settingsGetMock = vi.fn();
vi.mock("@/modules/settings/facade", () => ({
  settingsFacade: {
    get: (...args: unknown[]) => settingsGetMock(...args),
  },
}));

import { buildIssuerSnapshot } from "@/modules/sales/internal/issuer";
import type { SettingsValue } from "@/modules/settings/contracts";

type CompanySettings = SettingsValue<"company">;
type InvoiceIssuerSettings = SettingsValue<"invoice_issuer">;

const FULL_COMPANY: CompanySettings = {
  name: "隈部塗装",
  representative: "隈部太郎",
  address: "大分県豊後高田市○○1-2-3",
  tel: "0978-12-3456",
  email: "info@example.com",
  founded: "2010-04",
  business_hours: "9:00-18:00",
};

const FULL_ISSUER: InvoiceIssuerSettings = {
  issuer_name: "隈部塗装",
  registration_number: "T1234567890123",
  tax_rounding: "floor",
  bank_account: {
    bank_name: "大分銀行",
    branch_name: "豊後高田支店",
    account_type: "ordinary",
    account_number: "1234567",
    account_holder_kana: "クマベトソウ",
  },
  transfer_fee_note: "振込手数料はお客様負担でお願いいたします。",
  seal_storage_path: "seal/kumabe.png",
  quote_valid_days: 30,
};

function mockSettingsGet(
  company: { ok: true; value: CompanySettings } | { ok: false; code: string; detail?: string },
  issuer: { ok: true; value: InvoiceIssuerSettings } | { ok: false; code: string; detail?: string },
): void {
  settingsGetMock.mockImplementation(async (key: string) => {
    if (key === "company") return company;
    if (key === "invoice_issuer") return issuer;
    throw new Error(`unexpected settings key: ${key}`);
  });
}

beforeEach(() => {
  settingsGetMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("internal/issuer.ts buildIssuerSnapshot", () => {
  it("company + invoice_issuer の合成 (全項目あり)", async () => {
    mockSettingsGet({ ok: true, value: FULL_COMPANY }, { ok: true, value: FULL_ISSUER });

    const result = await buildIssuerSnapshot();

    expect(result).toEqual({
      ok: true,
      value: {
        issuer_name: "隈部塗装",
        registration_number: "T1234567890123",
        address: "大分県豊後高田市○○1-2-3",
        tel: "0978-12-3456",
        email: "info@example.com",
        seal_storage_path: "seal/kumabe.png",
        bank_account: FULL_ISSUER.bank_account,
        transfer_fee_note: "振込手数料はお客様負担でお願いいたします。",
      },
    });
  });

  it("registration_number が null (免税モード) はそのまま null として保持される", async () => {
    mockSettingsGet(
      { ok: true, value: FULL_COMPANY },
      { ok: true, value: { ...FULL_ISSUER, registration_number: null } },
    );

    const result = await buildIssuerSnapshot();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.registration_number).toBeNull();
  });

  it.each<[string, Partial<InvoiceIssuerSettings>]>([
    ["bank_account", { bank_account: null }],
    ["seal_storage_path", { seal_storage_path: null }],
    ["transfer_fee_note", { transfer_fee_note: null }],
  ])("invoice_issuer 側の任意項目 null (%s)", async (_label, patch) => {
    mockSettingsGet({ ok: true, value: FULL_COMPANY }, { ok: true, value: { ...FULL_ISSUER, ...patch } });
    const result = await buildIssuerSnapshot();
    expect(result.ok).toBe(true);
  });

  it("company 側の任意項目 null (tel/email)", async () => {
    mockSettingsGet(
      { ok: true, value: { ...FULL_COMPANY, tel: null, email: null } },
      { ok: true, value: FULL_ISSUER },
    );
    const result = await buildIssuerSnapshot();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.tel).toBeNull();
      expect(result.value.email).toBeNull();
    }
  });

  it("全ての nullable 項目が null でも成立する", async () => {
    mockSettingsGet(
      { ok: true, value: { ...FULL_COMPANY, tel: null, email: null, founded: null, business_hours: null } },
      {
        ok: true,
        value: {
          ...FULL_ISSUER,
          registration_number: null,
          bank_account: null,
          transfer_fee_note: null,
          seal_storage_path: null,
        },
      },
    );
    const result = await buildIssuerSnapshot();
    expect(result).toEqual({
      ok: true,
      value: {
        issuer_name: "隈部塗装",
        registration_number: null,
        address: "大分県豊後高田市○○1-2-3",
        tel: null,
        email: null,
        seal_storage_path: null,
        bank_account: null,
        transfer_fee_note: null,
      },
    });
  });

  it("invoice_issuer 設定行が存在しない (settingsFacade.get 失敗) は KMB-E626 に変換される (E901 を透過しない)", async () => {
    mockSettingsGet(
      { ok: true, value: FULL_COMPANY },
      { ok: false, code: "KMB-E901", detail: "site_settings.invoice_issuer が未設定です" },
    );
    const result = await buildIssuerSnapshot();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E626");
  });

  it("issuer_name が空文字は KMB-E626", async () => {
    mockSettingsGet({ ok: true, value: FULL_COMPANY }, { ok: true, value: { ...FULL_ISSUER, issuer_name: "" } });
    const result = await buildIssuerSnapshot();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E626");
  });

  it("issuer_name が空白のみは KMB-E626 (trim 後の長さで判定)", async () => {
    mockSettingsGet({ ok: true, value: FULL_COMPANY }, { ok: true, value: { ...FULL_ISSUER, issuer_name: "   " } });
    const result = await buildIssuerSnapshot();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("KMB-E626");
  });

  it("company 取得失敗は E626 にせず address/tel/email を null 埋めして継続する (安全側の縮退 — facade.ts resolveTaxRounding と同型の判断)", async () => {
    mockSettingsGet(
      { ok: false, code: "KMB-E901", detail: "site_settings.company が未設定です" },
      { ok: true, value: FULL_ISSUER },
    );
    const result = await buildIssuerSnapshot();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.address).toBeNull();
      expect(result.value.tel).toBeNull();
      expect(result.value.email).toBeNull();
      expect(result.value.issuer_name).toBe("隈部塗装");
    }
  });
});
