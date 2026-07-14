"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { Result } from "@/modules/platform/contracts";
import { getErrorInfo } from "@/modules/platform/errors";
import { platformFacade } from "@/modules/platform/facade";
import { computeVersionDiff, createSalesFacade, type IssuedSnapshotDiff } from "@/modules/sales/facade";
import {
  zCreateDocumentInput,
  zDocType,
  zPaymentInput,
  zReviseDocumentInput,
  zUpdateDraftDocumentInput,
  type CreateDocumentInput,
  type DocType,
  type IssuedContentSnapshot,
  type PaymentInput,
  type ReviseDocumentInput,
  type UpdateDraftDocumentInput,
} from "@/modules/sales/contracts";
import { crmFacade } from "@/modules/crm/facade";
import type { DealStage } from "@/modules/crm/contracts";

/**
 * `src/app/admin/documents/` の Server Actions (canonical: docs/design/crm-suite/02-sales.md §7.1)。
 *
 * このファイル・ディレクトリ自体は #50 が最初に作成した (`createPrintPreviewUrlAction` のみ実装)。
 * 本 Issue (#51) が残り 12 本を追記する (実装計画書「成果物3」— #50 のファイル冒頭コメントに
 * 明記されていた追記予告のとおり)。
 *
 * 全 Action 共通の規約 (§7.1): 先頭 `platformFacade.requireAdmin()` → Zod parse → facade →
 * `revalidatePath` (該当があれば) → Result をそのまま返す (deals/actions.ts の
 * updateDealStageAction と同型 — 呼び出し側のクライアントコンポーネントが `.ok`/`.detail` を見て
 * toast (sonner) を出す)。
 *
 * `export const maxDuration = 60`: PDF 生成 (issueDocument/reissueDocument/reviseAndReissueDocument)
 * を含むため (§7.1 表)。Next.js のファイル単位設定はファイル内の全 Action に適用されるが、
 * 他の軽量 Action への実害はない (実装計画書「注意・地雷」に明記済み)。
 */
export const maxDuration = 60;

const DOC_TYPE_TO_STAGE: Record<DocType, DealStage> = {
  quote: "quote_sent",
  order: "ordered",
  delivery: "delivered",
  invoice: "invoiced",
};

function revalidateDocumentPaths(documentId?: string) {
  revalidatePath("/admin/documents");
  if (documentId) revalidatePath(`/admin/documents/${documentId}`);
}

async function requireAdminResult(): Promise<Result<void>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { ok: false, code: admin.code, detail: admin.detail };
  return { ok: true, value: undefined };
}

// ============================================================
// draft CRUD
// ============================================================

export async function createDraftDocumentAction(input: CreateDocumentInput): Promise<Result<{ document_id: string }>> {
  const admin = await requireAdminResult();
  if (!admin.ok) return admin;

  const parsed = zCreateDocumentInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

  const result = await createSalesFacade().createDraftDocument(parsed.data);
  if (!result.ok) return result;

  revalidateDocumentPaths();
  return result;
}

export async function updateDraftDocumentAction(
  documentId: string,
  input: UpdateDraftDocumentInput,
  expectedUpdatedAt: string,
): Promise<Result<{ updated_at: string }>> {
  const admin = await requireAdminResult();
  if (!admin.ok) return admin;

  const idParsed = z.string().uuid().safeParse(documentId);
  if (!idParsed.success) return { ok: false, code: "KMB-E101", detail: idParsed.error.message };
  const inputParsed = zUpdateDraftDocumentInput.safeParse(input);
  if (!inputParsed.success) return { ok: false, code: "KMB-E101", detail: inputParsed.error.message };

  const result = await createSalesFacade().updateDraftDocument(idParsed.data, inputParsed.data, expectedUpdatedAt);
  if (!result.ok) return result;

  revalidateDocumentPaths(idParsed.data);
  return result;
}

export async function deleteDraftDocumentAction(
  documentId: string,
  expectedUpdatedAt: string,
): Promise<Result<void>> {
  const admin = await requireAdminResult();
  if (!admin.ok) return admin;

  const idParsed = z.string().uuid().safeParse(documentId);
  if (!idParsed.success) return { ok: false, code: "KMB-E101", detail: idParsed.error.message };

  const result = await createSalesFacade().deleteDraftDocument(idParsed.data, expectedUpdatedAt);
  if (!result.ok) return result;

  revalidatePath("/admin/documents");
  return result;
}

// ============================================================
// issueDocument (§7.1-2: deal ステージ自動適用込み)
// ============================================================

export type IssueDocumentActionValue = {
  doc_no: string;
  version: number;
  pdf_storage_path: string;
  /** 自動適用に成功した場合のみ非 null (トースト「元に戻す」ボタンが使う — §7.1-2)。 */
  dealStage: { from: DealStage; to: DealStage; dealUpdatedAt: string } | null;
  /** 自動適用をスキップした場合の理由 (E602 不正遷移 / E103 楽観排他競合 / deal 参照失敗)。
   *  帳票操作自体は成功しているため、これはエラーではなく情報バッジ用 (§7.1-2)。 */
  dealStageSkippedReason: string | null;
};

/**
 * 発行 (§6.1 issueDocument) + deal ステージ自動適用 (§7.1-2 / §4.6 — app 層合成)。
 * dealId は呼び出し側 (画面) が既に DocumentDetail.document.deal_id として保持しているものを渡す
 * (getDocumentDetail の再フェッチを避けるための実装者判断 — 契約に手順の明記は無いが、
 * canonical §7.1-2 の「(1) CrmFacade で deal を read」を満たせば取得経路は問わない)。
 * E602 (不正遷移) / E103 (楽観排他競合) はエラー化せず dealStageSkippedReason に格納する
 * (§7.1-2「スキップ + 乖離表示」— 帳票操作自体は成功のまま)。
 */
export async function issueDocumentAction(
  documentId: string,
  dealId: string,
  expectedUpdatedAt: string,
): Promise<Result<IssueDocumentActionValue>> {
  const admin = await requireAdminResult();
  if (!admin.ok) return admin;

  const idParsed = z.string().uuid().safeParse(documentId);
  if (!idParsed.success) return { ok: false, code: "KMB-E101", detail: idParsed.error.message };
  const dealIdParsed = z.string().uuid().safeParse(dealId);
  if (!dealIdParsed.success) return { ok: false, code: "KMB-E101", detail: dealIdParsed.error.message };

  const issued = await createSalesFacade().issueDocument(idParsed.data, expectedUpdatedAt);
  if (!issued.ok) return issued;

  revalidateDocumentPaths(idParsed.data);

  const toStage = DOC_TYPE_TO_STAGE[issued.value.event.doc_type];
  const dealRef = await crmFacade.getDealRef(dealIdParsed.data);
  if (!dealRef.ok) {
    return {
      ok: true,
      value: {
        ...issued.value,
        dealStage: null,
        dealStageSkippedReason: `案件の取得に失敗したためステージは変更していません (${dealRef.code})。`,
      },
    };
  }
  const fromStage = dealRef.value.stage;
  const applied = await crmFacade.updateDealStage(dealIdParsed.data, toStage, dealRef.value.updated_at);
  if (!applied.ok) {
    return {
      ok: true,
      value: {
        ...issued.value,
        dealStage: null,
        dealStageSkippedReason:
          applied.detail ?? `案件ステージの自動変更をスキップしました (${applied.code})。`,
      },
    };
  }

  revalidatePath("/admin/deals");
  revalidatePath(`/admin/deals/${dealIdParsed.data}`);

  // undo (直前ステージへの後退) 用に、変更後の deal.updated_at を再取得する (楽観排他 — undo 側の
  // updateDealStageAction 呼び出しがこの updated_at を expectedUpdatedAt として使う)。取得に失敗した
  // 場合でも帳票操作・ステージ変更自体は既に成功しているため、フォールバックとして現在時刻を使う
  // (undo 操作が万一 E103 になっても、undo は「後退」の補助機能でありエラーにはしない設計 — §7.1-2)。
  const refreshed = await crmFacade.getDealRef(dealIdParsed.data);
  const dealUpdatedAt = refreshed.ok ? refreshed.value.updated_at : new Date().toISOString();

  return {
    ok: true,
    value: { ...issued.value, dealStage: { from: fromStage, to: toStage, dealUpdatedAt }, dealStageSkippedReason: null },
  };
}

// ============================================================
// derive / reissue / revise
// ============================================================

const zDeriveInput = z.object({ source_document_id: z.string().uuid(), to_type: zDocType }).strict();

export async function deriveDocumentAction(input: {
  source_document_id: string;
  to_type: DocType;
}): Promise<Result<{ document_id: string }>> {
  const admin = await requireAdminResult();
  if (!admin.ok) return admin;

  const parsed = zDeriveInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

  const result = await createSalesFacade().deriveDocument(parsed.data);
  if (!result.ok) return result;

  revalidateDocumentPaths(parsed.data.source_document_id);
  return result;
}

export async function reissueDocumentAction(
  documentId: string,
  expectedUpdatedAt: string,
): Promise<Result<{ version: number; pdf_storage_path: string }>> {
  const admin = await requireAdminResult();
  if (!admin.ok) return admin;

  const idParsed = z.string().uuid().safeParse(documentId);
  if (!idParsed.success) return { ok: false, code: "KMB-E101", detail: idParsed.error.message };

  const result = await createSalesFacade().reissueDocument(idParsed.data, expectedUpdatedAt);
  if (!result.ok) return result;

  revalidateDocumentPaths(idParsed.data);
  return result;
}

export async function reviseAndReissueDocumentAction(
  documentId: string,
  input: ReviseDocumentInput,
  expectedUpdatedAt: string,
): Promise<Result<{ version: number; pdf_storage_path: string }>> {
  const admin = await requireAdminResult();
  if (!admin.ok) return admin;

  const idParsed = z.string().uuid().safeParse(documentId);
  if (!idParsed.success) return { ok: false, code: "KMB-E101", detail: idParsed.error.message };
  const inputParsed = zReviseDocumentInput.safeParse(input);
  if (!inputParsed.success) return { ok: false, code: "KMB-E101", detail: inputParsed.error.message };

  const result = await createSalesFacade().reviseAndReissueDocument(idParsed.data, inputParsed.data, expectedUpdatedAt);
  if (!result.ok) return result;

  revalidateDocumentPaths(idParsed.data);
  return result;
}

// ============================================================
// quote 状態遷移 (accept / decline / void)
// ============================================================

export async function acceptQuoteAction(documentId: string, expectedUpdatedAt: string): Promise<Result<void>> {
  const admin = await requireAdminResult();
  if (!admin.ok) return admin;

  const idParsed = z.string().uuid().safeParse(documentId);
  if (!idParsed.success) return { ok: false, code: "KMB-E101", detail: idParsed.error.message };

  const result = await createSalesFacade().acceptQuote(idParsed.data, expectedUpdatedAt);
  if (!result.ok) return result;

  revalidateDocumentPaths(idParsed.data);
  return result;
}

export async function declineQuoteAction(
  documentId: string,
  reason: string | null,
  expectedUpdatedAt: string,
): Promise<Result<void>> {
  const admin = await requireAdminResult();
  if (!admin.ok) return admin;

  const idParsed = z.string().uuid().safeParse(documentId);
  if (!idParsed.success) return { ok: false, code: "KMB-E101", detail: idParsed.error.message };

  const result = await createSalesFacade().declineQuote(idParsed.data, reason, expectedUpdatedAt);
  if (!result.ok) return result;

  revalidateDocumentPaths(idParsed.data);
  return result;
}

export async function voidDocumentAction(
  documentId: string,
  reason: string,
  expectedUpdatedAt: string,
): Promise<Result<void>> {
  const admin = await requireAdminResult();
  if (!admin.ok) return admin;

  const idParsed = z.string().uuid().safeParse(documentId);
  if (!idParsed.success) return { ok: false, code: "KMB-E101", detail: idParsed.error.message };
  if (!reason || reason.trim().length === 0) {
    return { ok: false, code: "KMB-E101", detail: "取消理由を入力してください。" };
  }

  const result = await createSalesFacade().voidDocument(idParsed.data, reason, expectedUpdatedAt);
  if (!result.ok) return result;

  revalidateDocumentPaths(idParsed.data);
  return result;
}

// ============================================================
// payments (§8.5 / §7.1-2: paid は自動適用しない — 確認ダイアログ方式)
// ============================================================

export async function recordPaymentAction(input: PaymentInput): Promise<
  Result<{ payment_id: string; invoice_paid: boolean }>
> {
  const admin = await requireAdminResult();
  if (!admin.ok) return admin;

  const parsed = zPaymentInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: "KMB-E101", detail: parsed.error.message };

  const result = await createSalesFacade().recordPayment(parsed.data);
  if (!result.ok) return result;

  revalidateDocumentPaths(parsed.data.document_id);
  return { ok: true, value: { payment_id: result.value.payment_id, invoice_paid: result.value.invoice_paid } };
}

export async function deletePaymentAction(paymentId: string, documentId: string): Promise<Result<void>> {
  const admin = await requireAdminResult();
  if (!admin.ok) return admin;

  const idParsed = z.string().uuid().safeParse(paymentId);
  if (!idParsed.success) return { ok: false, code: "KMB-E101", detail: idParsed.error.message };

  const result = await createSalesFacade().deletePayment(idParsed.data);
  if (!result.ok) return result;

  revalidateDocumentPaths(documentId);
  return result;
}

// ============================================================
// PDF
// ============================================================

export async function createPdfUrlAction(
  documentId: string,
  version: number,
): Promise<Result<{ url: string; expires_at: string }>> {
  const admin = await requireAdminResult();
  if (!admin.ok) return admin;

  const idParsed = z.string().uuid().safeParse(documentId);
  if (!idParsed.success) return { ok: false, code: "KMB-E101", detail: idParsed.error.message };
  const versionParsed = z.number().int().min(1).safeParse(version);
  if (!versionParsed.success) return { ok: false, code: "KMB-E101", detail: versionParsed.error.message };

  return createSalesFacade().createSignedPdfUrl(idParsed.data, versionParsed.data);
}

// ============================================================
// 版間差分ダイアログ (§11.1) の content_snapshot 取得
// ============================================================

export async function getIssuedContentSnapshotAction(
  documentId: string,
  version: number,
): Promise<Result<IssuedContentSnapshot>> {
  const admin = await requireAdminResult();
  if (!admin.ok) return admin;

  const idParsed = z.string().uuid().safeParse(documentId);
  if (!idParsed.success) return { ok: false, code: "KMB-E101", detail: idParsed.error.message };
  const versionParsed = z.number().int().min(1).safeParse(version);
  if (!versionParsed.success) return { ok: false, code: "KMB-E101", detail: versionParsed.error.message };

  return createSalesFacade().getIssuedContentSnapshot(idParsed.data, versionParsed.data);
}

/**
 * 版間差分ダイアログ (§11.1) 用: 新旧 2 版分の content_snapshot を取得して差分を計算し、結果のみを
 * クライアントへ返す。`computeVersionDiff` (sales/facade.ts) は `"server-only"` を import する
 * facade モジュールのトップレベル export のため、クライアントコンポーネントから直接呼ぶと
 * ビルド/実行時に弾かれる — 計算自体をこの Server Action 内で完結させ、結果 (JSON 化可能な純データ)
 * のみを返す設計とした (実装計画書「成果物5」が言う「facade に薄いラッパーを追加」の具体形)。
 */
export async function computeVersionDiffAction(
  documentId: string,
  olderVersion: number,
  newerVersion: number,
): Promise<Result<IssuedSnapshotDiff>> {
  const admin = await requireAdminResult();
  if (!admin.ok) return admin;

  const idParsed = z.string().uuid().safeParse(documentId);
  if (!idParsed.success) return { ok: false, code: "KMB-E101", detail: idParsed.error.message };

  const facade = createSalesFacade();
  const [olderResult, newerResult] = await Promise.all([
    facade.getIssuedContentSnapshot(idParsed.data, olderVersion),
    facade.getIssuedContentSnapshot(idParsed.data, newerVersion),
  ]);
  if (!olderResult.ok) return olderResult;
  if (!newerResult.ok) return newerResult;

  return { ok: true, value: computeVersionDiff(olderResult.value, newerResult.value) };
}

// ============================================================
// admin 印刷プレビュー (#50 実装分。変更なし — 参照のためここに残す)
// ============================================================

export type CreatePrintPreviewUrlState =
  | { success: true; url: string; expires_at: string; error: null }
  | { success: false; url: null; expires_at: null; error: string };

/**
 * admin 印刷プレビュー用の署名付き URL を発行する (§7.3「発行者」の admin プレビュー側)。
 * `/admin/documents/[id]` 画面がプレビューボタン押下時に呼び、返却された url を新規タブで開く。
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
