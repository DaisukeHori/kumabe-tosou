"use server";

import { z } from "zod";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getErrorInfo } from "@/modules/platform/errors";
import { platformFacade } from "@/modules/platform/facade";

import type { SettingsFormState } from "./form-state";

/**
 * 「アカウント」タブ (/admin/settings?tab=account) のパスワード変更 Server Action。
 *
 * 再認証: Supabase Auth の updateUser は現在のパスワードを要求しないため、
 * signInWithPassword で現在のパスワードを検証してから updateUser を呼ぶ
 * (ログイン済み端末を放置した第三者による無断変更を防ぐ)。
 */

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

const zChangePasswordInput = z
  .object({
    currentPassword: z.string().min(1, "現在のパスワードを入力してください。"),
    newPassword: z
      .string()
      .min(PASSWORD_MIN, `新しいパスワードは ${PASSWORD_MIN} 文字以上で入力してください。`)
      .max(PASSWORD_MAX, `新しいパスワードは ${PASSWORD_MAX} 文字以内で入力してください。`),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "新しいパスワード (確認) が一致しません。",
    path: ["confirmPassword"],
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: "新しいパスワードは現在のパスワードと異なるものを指定してください。",
    path: ["newPassword"],
  });

function fail(error: string): SettingsFormState {
  return { error, conflict: false, success: false };
}

export async function changePasswordAction(
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return fail(getErrorInfo(admin.code).message);

  const parsed = zChangePasswordInput.safeParse({
    currentPassword: String(formData.get("currentPassword") ?? ""),
    newPassword: String(formData.get("newPassword") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "入力内容を確認してください。");

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return fail(getErrorInfo("KMB-E201").message);

  const reauth = await supabase.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.currentPassword,
  });
  if (reauth.error) return fail("現在のパスワードが正しくありません。");

  const updated = await supabase.auth.updateUser({ password: parsed.data.newPassword });
  if (updated.error) return fail(`パスワードの変更に失敗しました: ${updated.error.message}`);

  return { error: null, conflict: false, success: true };
}
