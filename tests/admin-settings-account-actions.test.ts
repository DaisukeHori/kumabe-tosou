import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /admin/settings「アカウント」タブのパスワード変更 Server Action (account-actions.ts)。
 * platformFacade.requireAdmin と Supabase サーバ client (auth) を最小フェイク化して、
 * 検証ルールと再認証 → updateUser の順序だけを確認する。
 */

const requireAdminMock = vi.fn();
vi.mock("@/modules/platform/facade", () => ({
  platformFacade: { requireAdmin: (...args: unknown[]) => requireAdminMock(...args) },
}));

const getUserMock = vi.fn();
const signInWithPasswordMock = vi.fn();
const updateUserMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: (...args: unknown[]) => getUserMock(...args),
      signInWithPassword: (...args: unknown[]) => signInWithPasswordMock(...args),
      updateUser: (...args: unknown[]) => updateUserMock(...args),
    },
  }),
}));

import { changePasswordAction } from "@/app/admin/settings/account-actions";
import { SETTINGS_FORM_INITIAL_STATE } from "@/app/admin/settings/form-state";

const ADMIN_OK = { ok: true as const, value: { userId: "admin-1" } };

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminMock.mockResolvedValue(ADMIN_OK);
  getUserMock.mockResolvedValue({ data: { user: { id: "admin-1", email: "admin@example.com" } }, error: null });
  signInWithPasswordMock.mockResolvedValue({ data: {}, error: null });
  updateUserMock.mockResolvedValue({ data: {}, error: null });
});

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const VALID = { currentPassword: "old-password", newPassword: "new-password-1", confirmPassword: "new-password-1" };

describe("changePasswordAction", () => {
  it("非 admin は拒否し Supabase を呼ばない", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, code: "KMB-E202" });

    const result = await changePasswordAction(SETTINGS_FORM_INITIAL_STATE, makeFormData(VALID));

    expect(result).toEqual({ error: "この操作を行う権限がありません。", conflict: false, success: false });
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("確認が一致しない場合はエラー", async () => {
    const result = await changePasswordAction(
      SETTINGS_FORM_INITIAL_STATE,
      makeFormData({ ...VALID, confirmPassword: "different-1" }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("新しいパスワード (確認) が一致しません。");
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("新しいパスワードが 8 文字未満ならエラー", async () => {
    const result = await changePasswordAction(
      SETTINGS_FORM_INITIAL_STATE,
      makeFormData({ currentPassword: "old-password", newPassword: "short", confirmPassword: "short" }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("新しいパスワードは 8 文字以上で入力してください。");
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("現在のパスワードと同一ならエラー", async () => {
    const result = await changePasswordAction(
      SETTINGS_FORM_INITIAL_STATE,
      makeFormData({ currentPassword: "same-password", newPassword: "same-password", confirmPassword: "same-password" }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("新しいパスワードは現在のパスワードと異なるものを指定してください。");
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("現在のパスワードが不一致 (再認証失敗) なら updateUser を呼ばない", async () => {
    signInWithPasswordMock.mockResolvedValue({ data: {}, error: { message: "Invalid login credentials" } });

    const result = await changePasswordAction(SETTINGS_FORM_INITIAL_STATE, makeFormData(VALID));

    expect(result).toEqual({ error: "現在のパスワードが正しくありません。", conflict: false, success: false });
    expect(signInWithPasswordMock).toHaveBeenCalledWith({ email: "admin@example.com", password: "old-password" });
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("成功時は再認証後に updateUser({ password }) を呼び success を返す", async () => {
    const result = await changePasswordAction(SETTINGS_FORM_INITIAL_STATE, makeFormData(VALID));

    expect(result).toEqual({ error: null, conflict: false, success: true });
    expect(signInWithPasswordMock).toHaveBeenCalledWith({ email: "admin@example.com", password: "old-password" });
    expect(updateUserMock).toHaveBeenCalledWith({ password: "new-password-1" });
  });
});
