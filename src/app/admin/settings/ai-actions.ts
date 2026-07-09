"use server";

import { revalidatePath } from "next/cache";

import { aiProvidersFacade } from "@/modules/ai-providers/facade";
import { zSaveKeyInput } from "@/modules/ai-providers/contracts";
import { getErrorInfo } from "@/modules/platform/errors";
import { platformFacade } from "@/modules/platform/facade";

import type { SettingsFormState } from "./form-state";

/**
 * AI タブ (/admin/settings §6) の Server Actions。
 * 契約書 §11: 生成系 Server Action / Route Handler はすべて requireAdmin 先頭。
 */

async function requireAdminError(): Promise<string | null> {
  const admin = await platformFacade.requireAdmin();
  return admin.ok ? null : getErrorInfo(admin.code).message;
}

export async function saveAiKeyAction(
  _prevState: SettingsFormState,
  formData: FormData,
): Promise<SettingsFormState> {
  const adminError = await requireAdminError();
  if (adminError) return { error: adminError, conflict: false, success: false };

  const parsed = zSaveKeyInput.safeParse({
    provider: String(formData.get("provider") ?? ""),
    label: String(formData.get("label") ?? ""),
    apiKey: String(formData.get("apiKey") ?? ""),
    priority: Number(formData.get("priority") ?? 100),
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "入力内容を確認してください。",
      conflict: false,
      success: false,
    };
  }

  const result = await aiProvidersFacade.saveKey(parsed.data);
  if (!result.ok) {
    return { error: result.detail ?? getErrorInfo(result.code).message, conflict: false, success: false };
  }

  revalidatePath("/admin/settings");
  return { error: null, conflict: false, success: true };
}

export async function deleteAiKeyAction(id: string): Promise<{ error: string | null }> {
  const adminError = await requireAdminError();
  if (adminError) return { error: adminError };

  const result = await aiProvidersFacade.deleteKey(id);
  if (!result.ok) return { error: result.detail ?? getErrorInfo(result.code).message };

  revalidatePath("/admin/settings");
  return { error: null };
}

export type TestAiKeyResult = { error: string | null; ok: boolean; modelCount: number };

export async function testAiKeyAction(id: string): Promise<TestAiKeyResult> {
  const adminError = await requireAdminError();
  if (adminError) return { error: adminError, ok: false, modelCount: 0 };

  const result = await aiProvidersFacade.testKey(id);
  if (!result.ok) return { error: result.detail ?? getErrorInfo(result.code).message, ok: false, modelCount: 0 };

  revalidatePath("/admin/settings");
  return { error: result.value.error, ok: result.value.ok, modelCount: result.value.modelCount };
}

export async function setAiKeyPriorityAction(id: string, priority: number): Promise<{ error: string | null }> {
  const adminError = await requireAdminError();
  if (adminError) return { error: adminError };

  const result = await aiProvidersFacade.setKeyPriority(id, priority);
  if (!result.ok) return { error: result.detail ?? getErrorInfo(result.code).message };

  revalidatePath("/admin/settings");
  return { error: null };
}

export async function setAiEnabledModelsAction(
  id: string,
  models: string[],
  defaultModel: string | null,
): Promise<{ error: string | null }> {
  const adminError = await requireAdminError();
  if (adminError) return { error: adminError };

  const result = await aiProvidersFacade.setEnabledModels(id, models, defaultModel);
  if (!result.ok) return { error: result.detail ?? getErrorInfo(result.code).message };

  revalidatePath("/admin/settings");
  return { error: null };
}
