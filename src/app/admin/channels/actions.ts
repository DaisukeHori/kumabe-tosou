"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { decryptCookiePayload } from "@/lib/oauth/state-cookie";
import {
  zManualReconcileAction,
  zNoteAccountInput,
  zStyleProfileInput,
  type ManualReconcileAction,
} from "@/modules/distribution/contracts";
import { distributionFacade } from "@/modules/distribution/facade";
import type { Channel } from "@/modules/platform/contracts";
import { getErrorInfo } from "@/modules/platform/errors";
import { platformFacade } from "@/modules/platform/facade";

import type { ChannelsFormState } from "./form-state";

async function requireAdminError(): Promise<string | null> {
  const admin = await platformFacade.requireAdmin();
  return admin.ok ? null : getErrorInfo(admin.code).message;
}

export async function updateNoteAccountAction(
  _prevState: ChannelsFormState,
  formData: FormData,
): Promise<ChannelsFormState> {
  const adminError = await requireAdminError();
  if (adminError) return { error: adminError, success: false };

  const profileUrlRaw = String(formData.get("profile_url") ?? "").trim();
  const parsed = zNoteAccountInput.safeParse({
    account_label: String(formData.get("account_label") ?? ""),
    profile_url: profileUrlRaw.length === 0 ? null : profileUrlRaw,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "入力内容を確認してください。", success: false };
  }

  const result = await distributionFacade.updateNoteAccount(parsed.data);
  if (!result.ok) return { error: result.detail ?? getErrorInfo(result.code).message, success: false };

  revalidatePath("/admin/channels");
  return { error: null, success: true };
}

export async function updateStyleProfileAction(
  channel: Channel,
  _prevState: ChannelsFormState,
  formData: FormData,
): Promise<ChannelsFormState> {
  const adminError = await requireAdminError();
  if (adminError) return { error: adminError, success: false };

  const exampleRaw = String(formData.get("example_output") ?? "").trim();
  const parsed = zStyleProfileInput.safeParse({
    tone_instructions: String(formData.get("tone_instructions") ?? ""),
    format_rules: String(formData.get("format_rules") ?? ""),
    example_output: exampleRaw.length === 0 ? null : exampleRaw,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "入力内容を確認してください。", success: false };
  }

  const result = await distributionFacade.updateStyleProfile(channel, parsed.data);
  if (!result.ok) return { error: result.detail ?? getErrorInfo(result.code).message, success: false };

  revalidatePath("/admin/channels");
  return { error: null, success: true };
}

export async function cancelChannelPostAction(postId: string): Promise<ChannelsFormState> {
  const adminError = await requireAdminError();
  if (adminError) return { error: adminError, success: false };

  const result = await distributionFacade.cancel(postId);
  if (!result.ok) return { error: result.detail ?? getErrorInfo(result.code).message, success: false };

  revalidatePath("/admin/channels");
  return { error: null, success: true };
}

export async function retryFailedChannelPostAction(postId: string): Promise<ChannelsFormState> {
  const adminError = await requireAdminError();
  if (adminError) return { error: adminError, success: false };

  const result = await distributionFacade.retryFailed(postId);
  if (!result.ok) return { error: result.detail ?? getErrorInfo(result.code).message, success: false };

  revalidatePath("/admin/channels");
  return { error: null, success: true };
}

/** manual_required の人間照合: 「投稿済み → published」/「未投稿 → scheduled に戻す」(設計書 §4.3) */
export async function resolveManualRequiredAction(
  postId: string,
  action: ManualReconcileAction,
): Promise<ChannelsFormState> {
  const adminError = await requireAdminError();
  if (adminError) return { error: adminError, success: false };

  const parsed = zManualReconcileAction.safeParse(action);
  if (!parsed.success) return { error: "入力内容を確認してください。", success: false };

  const result = await distributionFacade.resolveManualRequired(postId, parsed.data);
  if (!result.ok) return { error: result.detail ?? getErrorInfo(result.code).message, success: false };

  revalidatePath("/admin/channels");
  return { error: null, success: true };
}

export type NoteCopyContentState =
  | { ok: true; content: { title: string; body_md: string; hashtags: string[] } }
  | { ok: false; error: string };

/** note コピペ支援ダイアログが開かれたときに呼ばれる (設計書 §8.3) */
export async function getNoteCopyContentAction(draftId: string): Promise<NoteCopyContentState> {
  const adminError = await requireAdminError();
  if (adminError) return { ok: false, error: adminError };

  const result = await distributionFacade.getNoteDraftForCopy(draftId);
  if (!result.ok) return { ok: false, error: result.detail ?? getErrorInfo(result.code).message };
  return { ok: true, content: result.value };
}

/** Meta OAuth callback 後のページ選択 UI から呼ばれる (契約書 §7.4 の残り) */
export async function finalizeMetaConnectionAction(
  _prevState: ChannelsFormState,
  formData: FormData,
): Promise<ChannelsFormState> {
  const adminError = await requireAdminError();
  if (adminError) return { error: adminError, success: false };

  const pageId = String(formData.get("page_id") ?? "");
  if (!pageId) return { error: "ページを選択してください。", success: false };

  const cookieStore = await cookies();
  const raw = cookieStore.get("kmb_meta_pending")?.value ?? null;
  if (!raw) {
    return { error: "選択セッションの有効期限が切れました。再度接続してください。", success: false };
  }

  const payload = decryptCookiePayload<{
    pages: { id: string; name: string; access_token: string }[];
    expiresAt: string;
  }>(raw);
  const page = payload?.pages.find((p) => p.id === pageId);
  if (!payload || !page) {
    return { error: "選択したページが見つかりません。再度接続してください。", success: false };
  }

  const result = await distributionFacade.finalizeMetaConnection({
    pageId: page.id,
    pageAccessToken: page.access_token,
    expiresAt: payload.expiresAt,
  });
  cookieStore.delete("kmb_meta_pending");

  if (!result.ok) return { error: result.detail ?? getErrorInfo(result.code).message, success: false };

  revalidatePath("/admin/channels");
  return { error: null, success: true };
}
