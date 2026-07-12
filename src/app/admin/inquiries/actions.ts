"use server";

import { revalidatePath } from "next/cache";

import type { Result } from "@/modules/platform/contracts";
import { getErrorInfo } from "@/modules/platform/errors";
import { platformFacade } from "@/modules/platform/facade";
import { inquiryFacade } from "@/modules/inquiry/facade";
import type { InquiryStatus } from "@/modules/inquiry/contracts";
import { crmFacade } from "@/modules/crm/facade";
import { zIntakeFromInquiryInput } from "@/modules/crm/contracts";

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

/**
 * 「リード化」ボタン (01-crm.md §8.7)。inquiry 行 (一覧に既に読み込み済みの内容) から
 * zIntakeFromInquiryInput を組み立てて intakeFromInquiry を呼ぶ。inquiryFacade に単票 get が
 * 無いため、クライアント側で既に持っている InquiryRow の内容をそのまま渡す設計にしている
 * (二重フェッチを避ける — 一覧/詳細 Dialog は既に該当行のデータを保持している)。
 */
export type IntakeInquiryActionInput = {
  inquiry_id: string;
  name: string;
  email: string | null;
  tel: string | null;
  inquiry_type: string;
  body: string;
};

export async function intakeInquiryAction(
  input: IntakeInquiryActionInput,
): Promise<Result<{ customer_id: string; deal_id: string }>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { ok: false, code: admin.code, detail: admin.detail };

  const parsed = zIntakeFromInquiryInput.safeParse({
    inquiry_id: input.inquiry_id,
    contact: { name: input.name, email: input.email, tel: input.tel },
    inquiry_type: input.inquiry_type,
    body_excerpt: input.body.slice(0, 300),
  });
  if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

  const result = await crmFacade.intakeFromInquiry(parsed.data);
  if (!result.ok) return result;

  revalidatePath("/admin/inquiries");
  revalidatePath("/admin/customers");
  revalidatePath("/admin/deals");
  revalidatePath("/admin");
  return result;
}

/**
 * 「リード化」ボタンの 2 段の済み判定 (01-crm.md §8.7 v1.1 是正)。InquiryLeadButton (client) が
 * 行ごとに個別に呼ぶ (N+1 だが admin 一覧は 50 件/頁上限のため実用上許容 — 大量データでの
 * パフォーマンス改善が必要になれば page.tsx 側でのバッチ取得に切り替える余地を残す)。
 */
export async function getIntakeStatusAction(
  inquiryId: string,
): Promise<Result<{ dealId: string | null; hasMarker: boolean }>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { ok: false, code: admin.code, detail: admin.detail };

  const dealResult = await crmFacade.findDealByInquiry(inquiryId);
  if (!dealResult.ok) return dealResult;
  if (dealResult.value !== null) return { ok: true, value: { dealId: dealResult.value.deal_id, hasMarker: true } };

  const markerResult = await crmFacade.hasIntakeMarker(inquiryId);
  if (!markerResult.ok) return markerResult;
  return { ok: true, value: { dealId: null, hasMarker: markerResult.value } };
}
