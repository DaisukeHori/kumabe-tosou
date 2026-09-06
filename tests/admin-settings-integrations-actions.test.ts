import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /admin/settings「外部連携」タブの Server Actions (integrations-actions.ts)。
 * tests/settings-actions.test.ts と同じく next/cache・platformFacade を最小フェイクに差し替え、
 * 認証情報の実体 (@/lib/integration-credentials) もモックして委譲の引数だけを検証する。
 */

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));

const requireAdminMock = vi.fn();
vi.mock("@/modules/platform/facade", () => ({
  platformFacade: { requireAdmin: (...args: unknown[]) => requireAdminMock(...args) },
}));

const saveMock = vi.fn();
const deleteMock = vi.fn();
vi.mock("@/lib/integration-credentials", () => ({
  isIntegrationProvider: (value: string) =>
    ["google_calendar", "ms_calendar", "x", "meta", "twilio", "resend"].includes(value),
  saveIntegrationCredentials: (...args: unknown[]) => saveMock(...args),
  deleteIntegrationCredentials: (...args: unknown[]) => deleteMock(...args),
}));

import {
  deleteIntegrationCredentialsAction,
  saveIntegrationCredentialsAction,
} from "@/app/admin/settings/integrations-actions";

const ADMIN_OK = { ok: true as const, value: { userId: "admin-1" } };

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue(ADMIN_OK);
  saveMock.mockResolvedValue({ ok: true, value: undefined });
  deleteMock.mockResolvedValue({ ok: true, value: undefined });
});

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("saveIntegrationCredentialsAction", () => {
  it("非 admin (KMB-E202) は保存せずエラーを返す", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, code: "KMB-E202" });

    const result = await saveIntegrationCredentialsAction(
      "google_calendar",
      makeFormData({ publicId: "id", secret: "sec" }),
    );

    expect(result).toEqual({ error: "この操作を行う権限がありません。", conflict: false, success: false });
    expect(saveMock).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("不正な provider は KMB-E101 のメッセージを返し保存しない", async () => {
    const result = await saveIntegrationCredentialsAction("slack", makeFormData({ publicId: "id", secret: "sec" }));

    expect(result.success).toBe(false);
    expect(result.error).toBe("入力内容に誤りがあります。フォームの表示内容をご確認ください。");
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("識別子が 200 文字を超える場合は zod エラーを返し保存しない", async () => {
    const result = await saveIntegrationCredentialsAction(
      "twilio",
      makeFormData({ publicId: "a".repeat(201), secret: "tok" }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("識別子は 200 文字以内で入力してください。");
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("保存は saveIntegrationCredentials に trim 済みの値と admin の userId で委譲し、関連ページを revalidate する", async () => {
    const result = await saveIntegrationCredentialsAction(
      "google_calendar",
      makeFormData({ publicId: "  client-id  ", secret: " secret-value " }),
    );

    expect(result).toEqual({ error: null, conflict: false, success: true });
    expect(saveMock).toHaveBeenCalledWith(
      "google_calendar",
      { publicId: "client-id", secret: "secret-value" },
      "admin-1",
    );
    expect(revalidatePath).toHaveBeenCalledWith("/admin/settings");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/calendar/connections");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/channels");
  });

  it("空欄は null として渡す (secret 空 = 既存維持、resend は publicId なし)", async () => {
    await saveIntegrationCredentialsAction("resend", makeFormData({ secret: "" }));

    expect(saveMock).toHaveBeenCalledWith("resend", { publicId: null, secret: null }, "admin-1");
  });

  it("saveIntegrationCredentials の失敗は detail をそのまま返し revalidate しない", async () => {
    saveMock.mockResolvedValue({ ok: false, code: "KMB-E101", detail: "シークレットは必須です" });

    const result = await saveIntegrationCredentialsAction("meta", makeFormData({ publicId: "app", secret: "" }));

    expect(result).toEqual({ error: "シークレットは必須です", conflict: false, success: false });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteIntegrationCredentialsAction", () => {
  it("非 admin は削除しない", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, code: "KMB-E202" });

    const result = await deleteIntegrationCredentialsAction("twilio");

    expect(result).toEqual({ error: "この操作を行う権限がありません。" });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("不正な provider は KMB-E101 を返す", async () => {
    const result = await deleteIntegrationCredentialsAction("nope");

    expect(result.error).toBe("入力内容に誤りがあります。フォームの表示内容をご確認ください。");
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("削除は deleteIntegrationCredentials に委譲し、関連ページを revalidate する", async () => {
    const result = await deleteIntegrationCredentialsAction("twilio");

    expect(result).toEqual({ error: null });
    expect(deleteMock).toHaveBeenCalledWith("twilio");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/settings");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/calendar/connections");
    expect(revalidatePath).toHaveBeenCalledWith("/admin/channels");
  });
});
