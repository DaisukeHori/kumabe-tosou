"use server";

import { contentFacade } from "@/modules/content/facade";
import {
  zStatusTransition,
  zWorkInput,
  type StatusTransition,
  type WorkInput,
} from "@/modules/content/contracts";
import type { Result } from "@/modules/platform/contracts";

/**
 * /admin/works の Server Actions。
 * 契約書 §3.5「全 Action の先頭で requireAdmin() + Zod parse を必須とする」のうち、
 * requireAdmin() は platform モジュール (Wave1-A 担当) の実装待ちのため未接続。
 * 認可は (1) admin layout の middleware 認証ゲート (Wave1-A) と
 * (2) works テーブル RLS (works_admin_insert/update、is_admin()) の 2 層で担保する
 * (未認証・非 admin の書込は RLS が KMB-E202 相当で拒否する)。要 platform 実装後の追認。
 */

export async function createWorkAction(input: WorkInput): Promise<Result<{ id: string }>> {
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
