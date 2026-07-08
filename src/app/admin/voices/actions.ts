"use server";

import { contentFacade } from "@/modules/content/facade";
import {
  zStatusTransition,
  zVoiceInput,
  type StatusTransition,
  type VoiceInput,
} from "@/modules/content/contracts";
import type { Result } from "@/modules/platform/contracts";

/**
 * /admin/voices の Server Actions。認可の方針は src/app/admin/works/actions.ts と同じ
 * (requireAdmin() は platform 未実装のため、middleware 認証ゲート + RLS の 2 層に依拠)。
 */

export async function createVoiceAction(input: VoiceInput): Promise<Result<{ id: string }>> {
  const parsed = zVoiceInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "KMB-E101",
      detail: parsed.error.issues.map((issue) => issue.message).join(" / "),
    };
  }
  return contentFacade.createVoice(parsed.data);
}

export async function updateVoiceAction(
  id: string,
  input: VoiceInput,
  expectedUpdatedAt: string,
): Promise<Result<{ updated_at: string }>> {
  const parsed = zVoiceInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "KMB-E101",
      detail: parsed.error.issues.map((issue) => issue.message).join(" / "),
    };
  }
  return contentFacade.updateVoice(id, parsed.data, expectedUpdatedAt);
}

export async function transitionVoiceAction(
  id: string,
  transition: StatusTransition,
  expectedUpdatedAt: string,
): Promise<Result<{ updated_at: string }>> {
  const parsed = zStatusTransition.safeParse(transition);
  if (!parsed.success) {
    return {
      ok: false,
      code: "KMB-E101",
      detail: parsed.error.issues.map((issue) => issue.message).join(" / "),
    };
  }
  return contentFacade.transitionVoice(id, parsed.data, expectedUpdatedAt);
}
