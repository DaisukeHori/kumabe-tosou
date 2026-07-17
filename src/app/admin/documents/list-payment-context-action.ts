"use server";

import { z } from "zod";

import { crmFacade } from "@/modules/crm/facade";
import type { Result } from "@/modules/platform/contracts";
import { platformFacade } from "@/modules/platform/facade";
import { createSalesFacade } from "@/modules/sales/facade";

/**
 * [R4a] 一覧行から入金記録ダイアログ (payment-dialog.tsx) を開くための読み取り専用コンテキスト。
 *
 * `DocumentListItem` は残高 (balance_jpy) と案件の updated_at を持たない (total_jpy と
 * 帳票自身の updated_at のみ)。PaymentDialog が正しく動く (既定金額=残高プリフィル / 完済時の
 * 案件ステージ確認 updateDealStageAction の楽観排他) には、詳細ページと同じ精度の値が要る。
 * ここでは既存 facade の read (getDocumentDetail + getDealRef) を app 層で合成するだけで、
 * `actions.ts` の既存 Server Action・facade シグネチャ・recordPayment の書き込み契約には一切
 * 触れない (getDealShippingDefaultsAction が getDealRef を app 層で合成するのと同型)。
 *
 * 呼び出し口 (documents-table.tsx) 専用のため、既存 actions.ts とは別ファイルに分離してある
 * (既存アクションのロジックを 1 行も変えないため)。
 */
export type ListPaymentContext = {
  document_id: string;
  deal_id: string;
  deal_updated_at: string;
  balance_jpy: number;
  /** ダイアログで入金対象を目視確認するための識別情報 (getDocumentDetail の戻りから取得。読み取りのみ)。 */
  doc_no: string | null;
  billing_name: string;
};

export async function getListPaymentContextAction(
  documentId: string,
): Promise<Result<ListPaymentContext>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { ok: false, code: admin.code, detail: admin.detail };

  const idParsed = z.string().uuid().safeParse(documentId);
  if (!idParsed.success) return { ok: false, code: "KMB-E101", detail: idParsed.error.message };

  const detail = await createSalesFacade().getDocumentDetail(idParsed.data);
  if (!detail.ok) return detail;

  const dealRef = await crmFacade.getDealRef(detail.value.document.deal_id);
  if (!dealRef.ok) return dealRef;

  return {
    ok: true,
    value: {
      document_id: detail.value.document.id,
      deal_id: detail.value.document.deal_id,
      deal_updated_at: dealRef.value.updated_at,
      balance_jpy: detail.value.balance_jpy,
      doc_no: detail.value.document.doc_no,
      billing_name: detail.value.document.billing_name,
    },
  };
}
