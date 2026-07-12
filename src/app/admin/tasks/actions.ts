"use server";

import { revalidatePath } from "next/cache";

import { platformFacade } from "@/modules/platform/facade";
import type { Result } from "@/modules/platform/contracts";
import { crmFacade } from "@/modules/crm/facade";
import { zTaskInput, zTaskUpdateInput, type TaskInput, type TaskUpdateInput } from "@/modules/crm/contracts";

/**
 * /admin/tasks の Server Actions (01-crm.md §7.1)。全 Action 先頭で requireAdmin() + Zod parse。
 * customers/[id] や deals/[id] の open タスクリスト (MiniTaskList) からも import される
 * (完了/取消/元に戻す は画面共通の挙動のため)。
 */

export async function createTaskAction(input: TaskInput): Promise<Result<{ task_id: string }>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { ok: false, code: admin.code, detail: admin.detail };

  const parsed = zTaskInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

  const result = await crmFacade.createTask(parsed.data);
  if (!result.ok) return result;

  revalidatePath("/admin/tasks");
  revalidatePath("/admin");
  if (parsed.data.customer_id) revalidatePath(`/admin/customers/${parsed.data.customer_id}`);
  if (parsed.data.deal_id) revalidatePath(`/admin/deals/${parsed.data.deal_id}`);
  return result;
}

export async function completeTaskAction(taskId: string, expectedUpdatedAt: string): Promise<Result<void>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { ok: false, code: admin.code, detail: admin.detail };

  const result = await crmFacade.completeTask(taskId, expectedUpdatedAt);
  if (!result.ok) return result;

  revalidatePath("/admin/tasks");
  revalidatePath("/admin");
  return result;
}

export async function cancelTaskAction(taskId: string, expectedUpdatedAt: string): Promise<Result<void>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { ok: false, code: admin.code, detail: admin.detail };

  const result = await crmFacade.cancelTask(taskId, expectedUpdatedAt);
  if (!result.ok) return result;

  revalidatePath("/admin/tasks");
  revalidatePath("/admin");
  return result;
}

export async function reopenTaskAction(taskId: string, expectedUpdatedAt: string): Promise<Result<void>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { ok: false, code: admin.code, detail: admin.detail };

  const result = await crmFacade.reopenTask(taskId, expectedUpdatedAt);
  if (!result.ok) return result;

  revalidatePath("/admin/tasks");
  revalidatePath("/admin");
  return result;
}

/**
 * 「完了 → toast『元に戻す』」専用の追撃 reopen (01-crm.md §8.4)。完了直後の同一セッション内操作
 * のため、CAS 用の expectedUpdatedAt をクライアントに持たせず `getTaskRef` で都度取得してから
 * reopenTask を呼ぶ (facade.ts の getTaskRef コメント参照 — 通常の reopen 導線は
 * reopenTaskAction の expectedUpdatedAt 必須のまま CAS 保護を維持する)。
 */
export async function undoCompleteTaskAction(taskId: string): Promise<Result<void>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { ok: false, code: admin.code, detail: admin.detail };

  const ref = await crmFacade.getTaskRef(taskId);
  if (!ref.ok) return ref;

  const result = await crmFacade.reopenTask(taskId, ref.value.updated_at);
  if (!result.ok) return result;

  revalidatePath("/admin/tasks");
  revalidatePath("/admin");
  return result;
}

export async function updateTaskAction(
  taskId: string,
  input: TaskUpdateInput,
  expectedUpdatedAt: string,
): Promise<Result<void>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { ok: false, code: admin.code, detail: admin.detail };

  const parsed = zTaskUpdateInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

  const result = await crmFacade.updateTask(taskId, parsed.data, expectedUpdatedAt);
  if (!result.ok) return result;

  revalidatePath("/admin/tasks");
  if (parsed.data.customer_id) revalidatePath(`/admin/customers/${parsed.data.customer_id}`);
  if (parsed.data.deal_id) revalidatePath(`/admin/deals/${parsed.data.deal_id}`);
  return result;
}
