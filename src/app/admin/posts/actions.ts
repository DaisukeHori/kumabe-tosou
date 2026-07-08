"use server";

import { contentFacade } from "@/modules/content/facade";
import {
  zPostInput,
  zStatusTransition,
  type PostInput,
  type StatusTransition,
} from "@/modules/content/contracts";
import type { Result } from "@/modules/platform/contracts";

/**
 * /admin/posts の Server Actions。認可の方針は src/app/admin/works/actions.ts と同じ
 * (requireAdmin() は platform 未実装のため、middleware 認証ゲート + RLS の 2 層に依拠)。
 */

export async function createPostAction(input: PostInput): Promise<Result<{ id: string }>> {
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
