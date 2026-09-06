import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * contact フォーム Server Action (src/components/contact/actions.ts) の入口検証と
 * ガード順序 (honeypot / 送信最小時間 → zod → rate limit → 保存) の単体テスト
 * (cms-ai-pipeline.md §3.3)。next/headers・rate limit・inquiry facade はモックし DB には触れない。
 */

const headersGetMock = vi.fn();
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (...args: unknown[]) => headersGetMock(...args) }),
}));

const checkAndRecordRateLimitMock = vi.fn();
vi.mock("@/components/contact/rate-limit.server", () => ({
  checkAndRecordRateLimit: (...args: unknown[]) => checkAndRecordRateLimitMock(...args),
}));

const inquirySubmitMock = vi.fn();
vi.mock("@/modules/inquiry/facade", () => ({
  inquiryFacade: {
    submit: (...args: unknown[]) => inquirySubmitMock(...args),
  },
}));

import { submitContactFormAction } from "@/components/contact/actions";
import type { ContactFormPayload } from "@/components/contact/actions";

function validPayload(overrides: Partial<ContactFormPayload> = {}): ContactFormPayload {
  return {
    name: "山田太郎",
    email: "yamada@example.com",
    phone: "",
    inquiryType: "construction",
    targetItem: "",
    message: "外壁の塗り替えについて相談したいです。",
    agree: true,
    honeypot: "",
    formRenderedAt: Date.now() - 60_000,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  headersGetMock.mockReturnValue(null);
  checkAndRecordRateLimitMock.mockResolvedValue({ ok: true, value: undefined });
  inquirySubmitMock.mockResolvedValue({ ok: true, value: { id: "inquiry-1" } });
});

describe("submitContactFormAction — payload の入口検証", () => {
  it("正常な payload は success を返し、facade に null 変換済みの入力が渡る", async () => {
    const res = await submitContactFormAction(validPayload({ phone: " 090-1234-5678 ", targetItem: "" }));
    expect(res).toEqual({ status: "success" });
    expect(inquirySubmitMock).toHaveBeenCalledWith(
      expect.objectContaining({ tel: "090-1234-5678", item: null, inquiry_type: "construction" }),
    );
  });

  it("任意項目 (phone / targetItem / honeypot) が欠落しても TypeError にならず処理できる", async () => {
    const partial: Record<string, unknown> = { ...validPayload() };
    delete partial.phone;
    delete partial.targetItem;
    delete partial.honeypot;
    const res = await submitContactFormAction(partial as unknown as ContactFormPayload);
    expect(res).toEqual({ status: "success" });
    expect(inquirySubmitMock).toHaveBeenCalledWith(expect.objectContaining({ tel: null, item: null }));
  });

  it("必須項目 (message) が欠落した payload は invalid を返し、rate limit も保存も呼ばれない", async () => {
    const partial: Record<string, unknown> = { ...validPayload() };
    delete partial.message;
    const res = await submitContactFormAction(partial as unknown as ContactFormPayload);
    expect(res).toEqual({ status: "invalid", message: "入力内容をご確認ください。" });
    expect(checkAndRecordRateLimitMock).not.toHaveBeenCalled();
    expect(inquirySubmitMock).not.toHaveBeenCalled();
  });

  it("型不正 (phone が数値・formRenderedAt が文字列) でも invalid で返す", async () => {
    const res = await submitContactFormAction({
      ...validPayload(),
      phone: 12345,
      formRenderedAt: "yesterday",
    } as unknown as ContactFormPayload);
    expect(res).toEqual({ status: "invalid", message: "入力内容をご確認ください。" });
  });

  it("payload が null / undefined でも例外にならず invalid", async () => {
    await expect(
      submitContactFormAction(null as unknown as ContactFormPayload),
    ).resolves.toEqual({ status: "invalid", message: "入力内容をご確認ください。" });
    await expect(
      submitContactFormAction(undefined as unknown as ContactFormPayload),
    ).resolves.toEqual({ status: "invalid", message: "入力内容をご確認ください。" });
  });
});

describe("submitContactFormAction — ガード順序 (honeypot/最小時間 → zod → rate limit → 保存)", () => {
  it("honeypot 充填時は stealth で success を返し、rate limit も保存も呼ばれない", async () => {
    const res = await submitContactFormAction(validPayload({ honeypot: "http://spam.example" }));
    expect(res).toEqual({ status: "success" });
    expect(checkAndRecordRateLimitMock).not.toHaveBeenCalled();
    expect(inquirySubmitMock).not.toHaveBeenCalled();
  });

  it("3秒未満の送信は stealth で success を返し、rate limit も保存も呼ばれない", async () => {
    const res = await submitContactFormAction(validPayload({ formRenderedAt: Date.now() - 500 }));
    expect(res).toEqual({ status: "success" });
    expect(checkAndRecordRateLimitMock).not.toHaveBeenCalled();
    expect(inquirySubmitMock).not.toHaveBeenCalled();
  });

  it("契約違反 (email 不正) は invalid を返し、rate limit にカウントされない", async () => {
    const res = await submitContactFormAction(validPayload({ email: "not-an-email" }));
    expect(res).toEqual({ status: "invalid", message: "入力内容をご確認ください。" });
    expect(checkAndRecordRateLimitMock).not.toHaveBeenCalled();
    expect(inquirySubmitMock).not.toHaveBeenCalled();
  });

  it("rate limit 超過時は rate_limited を返し、保存は呼ばれない", async () => {
    checkAndRecordRateLimitMock.mockResolvedValueOnce({
      ok: false,
      code: "KMB-E105",
      detail: "rate_limit_exceeded",
    });
    const res = await submitContactFormAction(validPayload());
    expect(res).toEqual({ status: "rate_limited" });
    expect(inquirySubmitMock).not.toHaveBeenCalled();
  });

  it("rate limit は x-real-ip 由来の hash と契約検証通過後に 1 回だけ呼ばれる", async () => {
    headersGetMock.mockImplementation((name: string) =>
      name === "x-real-ip" ? "203.0.113.9" : name === "x-forwarded-for" ? "198.51.100.7" : null,
    );
    await submitContactFormAction(validPayload());
    expect(checkAndRecordRateLimitMock).toHaveBeenCalledTimes(1);
    const [ipHash, at] = checkAndRecordRateLimitMock.mock.calls[0] as [string, Date];
    expect(ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(at).toBeInstanceOf(Date);
  });

  it("facade.submit 失敗時は error を返す", async () => {
    inquirySubmitMock.mockResolvedValueOnce({ ok: false, code: "KMB-E901", detail: "db down" });
    const res = await submitContactFormAction(validPayload());
    expect(res).toEqual({ status: "error" });
  });
});
