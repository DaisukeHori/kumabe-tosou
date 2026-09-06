"use server";

import { contentFacade } from "@/modules/content/facade";
import {
  zStatusTransition,
  zVoiceInput,
  type StatusTransition,
  type VoiceInput,
} from "@/modules/content/contracts";
import type { Result } from "@/modules/platform/contracts";
import { platformFacade } from "@/modules/platform/facade";

/**
 * /admin/voices の Server Actions。認可の方針は src/app/admin/works/actions.ts と同じ
 * (各 Action の先頭で platformFacade.requireAdmin()。未認証 KMB-E201 / 非 admin KMB-E202)。
 */

export async function createVoiceAction(input: VoiceInput): Promise<Result<{ id: string }>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return admin;

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
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return admin;

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
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return admin;

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
