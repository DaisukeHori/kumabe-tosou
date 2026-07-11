import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * canonical: docs/design/crm-suite/00-overview.md §3.1.2c (migration 0021 — site_settings の
 * anon SELECT 許可リスト化) / 07-contracts-delta.md §D5 注記。
 *
 * migration 0021 適用後、`notifications` キーは公開許可リスト (company/hero/seo_defaults/
 * analytics/branding/business_hours) に含まれないため anon から読めなくなる。
 * src/modules/inquiry/internal/notify.ts の getInquiryNotificationEmail() はこれに合わせて
 * createSupabasePublicClient (anon) → createSupabaseServiceClient (service_role) へ切替済み
 * (通知メールが静かに止まる regression の防止)。本ファイルはその配線を検証する:
 *   - service client が正しく使われ、inquiry_to を取得できること
 *   - SUPABASE_SERVICE_ROLE_KEY 未設定 (createSupabaseServiceClient が throw) 時は
 *     例外を外へ漏らさず null に degrade すること
 *   - クエリ error / 行なし / スキーマ不一致でも同様に null に degrade すること
 */

const createSupabaseServiceClientMock = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: (...args: unknown[]) => createSupabaseServiceClientMock(...args),
}));

const resendSendMock = vi.fn();
vi.mock("resend", () => ({
  // new Resend(apiKey) で呼ばれるためコンストラクタ (class) にする必要がある
  // (vi.fn().mockImplementation(() => ({...})) はアロー関数で `new` できずエラーになる)。
  Resend: class {
    emails = { send: (...args: unknown[]) => resendSendMock(...args) };
  },
}));

import { getInquiryNotificationEmail, notifyInquiryReceived } from "@/modules/inquiry/internal/notify";
import type { InquiryInput } from "@/modules/inquiry/contracts";

function buildFakeServiceClient(response: { data: unknown; error: unknown }): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => response,
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  createSupabaseServiceClientMock.mockReset();
  resendSendMock.mockReset();
  resendSendMock.mockResolvedValue({ data: { id: "email-1" }, error: null });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("getInquiryNotificationEmail: service client 経由での inquiry_to 取得", () => {
  it("正常系: notifications.inquiry_to を service client 経由で取得する", async () => {
    const client = buildFakeServiceClient({
      data: { value: { inquiry_to: "owner@example.com", on_publish_failure: false } },
      error: null,
    });
    createSupabaseServiceClientMock.mockReturnValue(client);

    const result = await getInquiryNotificationEmail();

    expect(result).toBe("owner@example.com");
    expect(createSupabaseServiceClientMock).toHaveBeenCalledTimes(1);
  });

  it("SUPABASE_SERVICE_ROLE_KEY 未設定 (createSupabaseServiceClient が throw) → null に degrade する (例外を漏らさない)", async () => {
    createSupabaseServiceClientMock.mockImplementation(() => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY が未設定です。service role 依存機能は無効化されています。");
    });

    await expect(getInquiryNotificationEmail()).resolves.toBeNull();
  });

  it("クエリが error を返す → null に degrade する", async () => {
    const client = buildFakeServiceClient({ data: null, error: { message: "boom" } });
    createSupabaseServiceClientMock.mockReturnValue(client);

    const result = await getInquiryNotificationEmail();

    expect(result).toBeNull();
  });

  it("行が存在しない (data: null) → null に degrade する", async () => {
    const client = buildFakeServiceClient({ data: null, error: null });
    createSupabaseServiceClientMock.mockReturnValue(client);

    const result = await getInquiryNotificationEmail();

    expect(result).toBeNull();
  });

  it("value が zNotificationSettings のスキーマと不一致 (inquiry_to 欠落等) → null に degrade する", async () => {
    const client = buildFakeServiceClient({
      data: { value: { on_publish_failure: false } }, // inquiry_to が無い
      error: null,
    });
    createSupabaseServiceClientMock.mockReturnValue(client);

    const result = await getInquiryNotificationEmail();

    expect(result).toBeNull();
  });
});

describe("notifyInquiryReceived: getInquiryNotificationEmail が null を返す経路のベストエフォート degrade", () => {
  const baseInput: InquiryInput = {
    name: "山田太郎",
    email: "yamada@example.com",
    tel: null,
    inquiry_type: "estimate",
    item: null,
    body: "見積もりをお願いします。塗装面積は約100平米です。",
    privacy_agreed: true,
  };

  it("RESEND_API_KEY 未設定なら getInquiryNotificationEmail すら呼ばずスキップする", async () => {
    delete process.env.RESEND_API_KEY;

    await notifyInquiryReceived(baseInput, "inquiry-1");

    expect(createSupabaseServiceClientMock).not.toHaveBeenCalled();
    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it("RESEND_API_KEY 設定済みだが通知先メール未設定 (service client throw) なら送信をスキップする", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    createSupabaseServiceClientMock.mockImplementation(() => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY が未設定です");
    });

    await notifyInquiryReceived(baseInput, "inquiry-2");

    expect(resendSendMock).not.toHaveBeenCalled();
  });

  it("正常系: 取得した inquiry_to 宛に Resend で送信する", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    const client = buildFakeServiceClient({
      data: { value: { inquiry_to: "owner@example.com", on_publish_failure: false } },
      error: null,
    });
    createSupabaseServiceClientMock.mockReturnValue(client);

    await notifyInquiryReceived(baseInput, "inquiry-3");

    expect(resendSendMock).toHaveBeenCalledTimes(1);
    expect(resendSendMock.mock.calls[0][0]).toMatchObject({ to: "owner@example.com" });
  });
});
