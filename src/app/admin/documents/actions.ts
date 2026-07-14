"use server";

import { getErrorInfo } from "@/modules/platform/errors";
import { platformFacade } from "@/modules/platform/facade";
import { createSalesFacade } from "@/modules/sales/facade";

/**
 * `src/app/admin/documents/` の Server Actions (canonical: docs/design/crm-suite/02-sales.md §7.1)。
 *
 * このファイル・ディレクトリ自体は本 Issue (#50) が最初に作成する
 * (`/admin/documents` 一覧・編集・詳細画面は未着手 — #51 のスコープ)。#51 は本ファイルへ
 * 以下を追記する前提 (実装計画書「未解決点2」— 先にマージされた方が後発とのマージコンフリクトを
 * 引き受ける): createDraftDocumentAction / updateDraftDocumentAction / deleteDraftDocumentAction /
 * issueDocumentAction / deriveDocumentAction / reissueDocumentAction /
 * reviseAndReissueDocumentAction / acceptQuoteAction / declineQuoteAction / voidDocumentAction /
 * recordPaymentAction / deletePaymentAction / createPdfUrlAction (§7.1 の表参照)。
 * 本 Issue が実装するのは `createPrintPreviewUrlAction` のみ。
 *
 * 全 Action 共通の規約 (§7.1): 先頭 `platformFacade.requireAdmin()` → Zod parse → facade →
 * `revalidatePath` (該当があれば) → Result → `{ error, success }` 変換 + toast (sonner、呼び出し側)。
 * 本 Action は DB 状態を一切変更しない (印刷トークンの発行のみ — print_tokens への INSERT は
 * issued_documents/documents に影響しない) ため revalidatePath は不要。
 */

export type CreatePrintPreviewUrlState =
  | { success: true; url: string; expires_at: string; error: null }
  | { success: false; url: null; expires_at: null; error: string };

/**
 * admin 印刷プレビュー用の署名付き URL を発行する (§7.3「発行者」の admin プレビュー側)。
 * `/admin/documents/[id]` 画面 (#51) がプレビューボタン押下時に呼び、返却された url を
 * 新規タブ/iframe で開く想定 (画面側の実装は #51 のスコープ)。
 */
export async function createPrintPreviewUrlAction(documentId: string): Promise<CreatePrintPreviewUrlState> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) {
    return { success: false, url: null, expires_at: null, error: getErrorInfo(admin.code).message };
  }

  const result = await createSalesFacade().issuePrintPreviewToken(documentId);
  if (!result.ok) {
    return {
      success: false,
      url: null,
      expires_at: null,
      error: result.detail ?? getErrorInfo(result.code).message,
    };
  }

  return { success: true, url: result.value.url, expires_at: result.value.expires_at, error: null };
}
