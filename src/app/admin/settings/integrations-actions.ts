"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  deleteIntegrationCredentials,
  isIntegrationProvider,
  saveIntegrationCredentials,
} from "@/lib/integration-credentials";
import { getErrorInfo } from "@/modules/platform/errors";
import { platformFacade } from "@/modules/platform/facade";

import type { SettingsFormState } from "./form-state";

/**
 * 「外部連携」タブ (/admin/settings?tab=integrations) の Server Actions。
 * 認証情報の実体 (Vault / integration_credentials) は @/lib/integration-credentials に委譲し、
 * ここでは requireAdmin ガード・provider 検証・入力の正規化・revalidate だけを担う。
 *
 * 保存/削除の結果は接続 UI (カレンダー接続・チャネル) の有効化判定に直結するため、
 * /admin/settings に加えてそれらのページも revalidate する。
 */

const REVALIDATE_PATHS = ["/admin/settings", "/admin/calendar/connections", "/admin/channels"] as const;

const zIntegrationInput = z.object({
  publicId: z.string().trim().max(200, "識別子は 200 文字以内で入力してください。"),
  secret: z.string().trim().max(500, "シークレットは 500 文字以内で入力してください。"),
});

function revalidateIntegrationPages(): void {
  for (const path of REVALIDATE_PATHS) revalidatePath(path);
}

export async function saveIntegrationCredentialsAction(
  provider: string,
  formData: FormData,
): Promise<SettingsFormState> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { error: getErrorInfo(admin.code).message, conflict: false, success: false };

  if (!isIntegrationProvider(provider)) {
    return { error: getErrorInfo("KMB-E101").message, conflict: false, success: false };
  }

  const parsed = zIntegrationInput.safeParse({
    publicId: String(formData.get("publicId") ?? ""),
    secret: String(formData.get("secret") ?? ""),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "入力内容を確認してください。",
      conflict: false,
      success: false,
    };
  }

  const result = await saveIntegrationCredentials(
    provider,
    {
      publicId: parsed.data.publicId.length > 0 ? parsed.data.publicId : null,
      secret: parsed.data.secret.length > 0 ? parsed.data.secret : null,
    },
    admin.value.userId,
  );
  if (!result.ok) {
    return { error: result.detail ?? getErrorInfo(result.code).message, conflict: false, success: false };
  }

  revalidateIntegrationPages();
  return { error: null, conflict: false, success: true };
}

export async function deleteIntegrationCredentialsAction(provider: string): Promise<{ error: string | null }> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { error: getErrorInfo(admin.code).message };

  if (!isIntegrationProvider(provider)) return { error: getErrorInfo("KMB-E101").message };

  const result = await deleteIntegrationCredentials(provider);
  if (!result.ok) return { error: result.detail ?? getErrorInfo(result.code).message };

  revalidateIntegrationPages();
  return { error: null };
}
