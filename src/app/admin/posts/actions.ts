"use server";

import { contentFacade } from "@/modules/content/facade";
import {
  zPostInput,
  zStatusTransition,
  type PostInput,
  type StatusTransition,
} from "@/modules/content/contracts";
import type { Result } from "@/modules/platform/contracts";
import { platformFacade } from "@/modules/platform/facade";

/**
 * /admin/posts の Server Actions。認可の方針は src/app/admin/works/actions.ts と同じ
 * (各 Action の先頭で platformFacade.requireAdmin()。未認証 KMB-E201 / 非 admin KMB-E202)。
 */

export async function createPostAction(input: PostInput): Promise<Result<{ id: string }>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return admin;

  const parsed = zPostInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "KMB-E101",
      detail: parsed.error.issues.map((issue) => issue.message).join(" / "),
    };
  }
  return contentFacade.createPost(parsed.data);
}

export async function updatePostAction(
  id: string,
  input: PostInput,
  expectedUpdatedAt: string,
): Promise<Result<{ updated_at: string }>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return admin;

  const parsed = zPostInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      code: "KMB-E101",
      detail: parsed.error.issues.map((issue) => issue.message).join(" / "),
    };
  }
  return contentFacade.updatePost(id, parsed.data, expectedUpdatedAt);
}

export async function transitionPostAction(
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
  return contentFacade.transitionPost(id, parsed.data, expectedUpdatedAt);
}
