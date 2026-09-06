"use server";

import { contentFacade } from "@/modules/content/facade";
import {
  zStatusTransition,
  zWorkInput,
  type StatusTransition,
  type WorkInput,
} from "@/modules/content/contracts";
import type { Result } from "@/modules/platform/contracts";
import { platformFacade } from "@/modules/platform/facade";

/**
 * /admin/works の Server Actions。
 * 契約書 §3.5「全 Action の先頭で requireAdmin() + Zod parse を必須とする」に従い、
 * 各 Action の先頭で platformFacade.requireAdmin() を呼ぶ (visual/actions.ts と同じパターン)。
 * 未認証は KMB-E201、認証済みでも admin (profiles) でなければ KMB-E202 をそのまま返す。
 * RLS (works_admin_insert/update、is_admin()) は最終防衛線として引き続き有効。
 */

export async function createWorkAction(input: WorkInput): Promise<Result<{ id: string }>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return admin;

  const parsed = zWorkInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "KMB-E101",
      detail: parsed.error.issues.map((issue) => issue.message).join(" / "),
    };
  }
  return contentFacade.createWork(parsed.data);
}

export async function updateWorkAction(
  id: string,
  input: WorkInput,
  expectedUpdatedAt: string,
): Promise<Result<{ updated_at: string }>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return admin;

  const parsed = zWorkInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "KMB-E101",
      detail: parsed.error.issues.map((issue) => issue.message).join(" / "),
    };
  }
  return contentFacade.updateWork(id, parsed.data, expectedUpdatedAt);
}

export async function transitionWorkAction(
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
  return contentFacade.transitionWork(id, parsed.data, expectedUpdatedAt);
}
