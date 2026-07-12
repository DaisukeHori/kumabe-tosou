"use server";

import { revalidatePath } from "next/cache";

import { platformFacade } from "@/modules/platform/facade";
import type { Result } from "@/modules/platform/contracts";
import { crmFacade } from "@/modules/crm/facade";
import {
  zDealInput,
  zDealStage,
  zDealUpdateInput,
  zMarkDealLostInput,
  type DealInput,
  type DealStage,
  type DealUpdateInput,
  type MarkDealLostInput,
} from "@/modules/crm/contracts";

/**
 * /admin/deals の Server Actions (01-crm.md §7.1)。全 Action 先頭で requireAdmin() + Zod parse。
 */

export async function createDealAction(input: DealInput): Promise<Result<{ deal_id: string }>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { ok: false, code: admin.code, detail: admin.detail };

  const parsed = zDealInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

  const result = await crmFacade.createDeal(parsed.data);
  if (!result.ok) return result;

  revalidatePath("/admin/deals");
  revalidatePath("/admin");
  revalidatePath(`/admin/customers/${parsed.data.customer_id}`);
  return result;
}

export async function updateDealAction(
  id: string,
  input: DealUpdateInput,
  expectedUpdatedAt: string,
): Promise<Result<{ updated_at: string }>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { ok: false, code: admin.code, detail: admin.detail };

  const parsed = zDealUpdateInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

  const result = await crmFacade.updateDeal(id, parsed.data, expectedUpdatedAt);
  if (!result.ok) return result;

  revalidatePath(`/admin/deals/${id}`);
  revalidatePath("/admin/deals");
  return result;
}

export async function updateDealStageAction(
  dealId: string,
  to: DealStage,
  expectedUpdatedAt: string,
): Promise<Result<void>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { ok: false, code: admin.code, detail: admin.detail };

  const parsedStage = zDealStage.safeParse(to);
  if (!parsedStage.success) return { ok: false, code: "KMB-E101", detail: parsedStage.error.message };

  const result = await crmFacade.updateDealStage(dealId, parsedStage.data, expectedUpdatedAt);
  if (!result.ok) return result;

  revalidatePath("/admin/deals");
  revalidatePath(`/admin/deals/${dealId}`);
  revalidatePath("/admin");
  return result;
}

export async function markDealLostAction(
  id: string,
  input: MarkDealLostInput,
  expectedUpdatedAt: string,
): Promise<Result<void>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { ok: false, code: admin.code, detail: admin.detail };

  const parsed = zMarkDealLostInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

  const result = await crmFacade.markDealLost(id, parsed.data, expectedUpdatedAt);
  if (!result.ok) return result;

  revalidatePath("/admin/deals");
  revalidatePath(`/admin/deals/${id}`);
  revalidatePath("/admin");
  return result;
}
