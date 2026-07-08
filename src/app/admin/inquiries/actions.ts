"use server";

import { revalidatePath } from "next/cache";

import { getErrorInfo } from "@/modules/platform/errors";
import { platformFacade } from "@/modules/platform/facade";
import { inquiryFacade } from "@/modules/inquiry/facade";
import type { InquiryStatus } from "@/modules/inquiry/contracts";

export type UpdateInquiryStatusState = { error: string | null; success: boolean };

export async function updateInquiryStatusAction(
  id: string,
  status: InquiryStatus,
): Promise<UpdateInquiryStatusState> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { error: getErrorInfo(admin.code).message, success: false };

  const result = await inquiryFacade.updateStatus(id, status);
  if (!result.ok) {
    return { error: result.detail ?? getErrorInfo(result.code).message, success: false };
  }

  revalidatePath("/admin/inquiries");
  revalidatePath("/admin");
  return { error: null, success: true };
}
