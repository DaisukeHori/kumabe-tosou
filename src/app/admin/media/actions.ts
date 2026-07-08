"use server";

import { revalidatePath, revalidateTag } from "next/cache";

import { getErrorInfo } from "@/modules/platform/errors";
import { platformFacade } from "@/modules/platform/facade";
import { mediaFacade, type CompleteMediaUploadInput } from "@/modules/media/facade";
import { zMediaPatch, type MediaPatch } from "@/modules/media/contracts";

export type ActionResult = { error: string | null };

export async function requestUploadUrlAction(input: {
  filename: string;
  contentType: string;
  sizeBytes: number;
}): Promise<{ error: string | null; uploadUrl?: string; storagePath?: string; token?: string }> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { error: getErrorInfo(admin.code).message };

  const result = await mediaFacade.createUploadUrl(input);
  if (!result.ok) return { error: result.detail ?? getErrorInfo(result.code).message };

  return {
    error: null,
    uploadUrl: result.value.uploadUrl,
    storagePath: result.value.storagePath,
    token: result.value.token,
  };
}

export async function completeUploadAction(input: CompleteMediaUploadInput): Promise<ActionResult> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { error: getErrorInfo(admin.code).message };

  const result = await mediaFacade.completeUpload(input);
  if (!result.ok) return { error: result.detail ?? getErrorInfo(result.code).message };

  revalidatePath("/admin/media");
  revalidatePath("/admin");
  return { error: null };
}

export async function patchMediaAction(id: string, rawPatch: MediaPatch): Promise<ActionResult> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { error: getErrorInfo(admin.code).message };

  const parsed = zMediaPatch.safeParse(rawPatch);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "入力内容を確認してください。" };

  const result = await mediaFacade.patch(id, parsed.data);
  if (!result.ok) return { error: result.detail ?? getErrorInfo(result.code).message };

  revalidatePath("/admin/media");
  // media.replaced 相当の一括 revalidate (設計書 §4.4)。参照先の kind タグは未確定のため
  // 汎用タグのみ再検証する (content 側が独自タグを張る場合は別途 revalidateTag が必要)。
  revalidateTag("media");
  return { error: null };
}

export async function deleteMediaAction(id: string): Promise<ActionResult> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { error: getErrorInfo(admin.code).message };

  const result = await mediaFacade.remove(id);
  if (!result.ok) return { error: result.detail ?? getErrorInfo(result.code).message };

  revalidatePath("/admin/media");
  revalidatePath("/admin");
  return { error: null };
}
