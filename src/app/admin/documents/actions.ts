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
import { createSchedulingFacade } from "@/modules/scheduling/facade";

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
 * PDF 生成 (issueDocument/reissueDocument/reviseAndReissueDocument) を含むため maxDuration=60 が
 * 必要 (§7.1 表)。ただし "use server" ファイルは async 関数以外の export を許可しない (Next.js の
 * 制約 — `export const maxDuration` を書くとビルドが失敗する)。Vercel 上の Server Action の
 * タイムアウトは呼び出し元ページの maxDuration に従うため、実際の設定は
 * `src/app/admin/documents/[id]/page.tsx` 側に置いてある (このファイルからは呼び出さないこと)。
 */

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
// 受注確定→work_blocks 原案生成 (app 層合成 — #61、00-overview §4.1 手順5〜6 / §2.3)
// ============================================================

export type GenerateBlocksActionValue =
  | { status: "confirm_required"; existingCount: number }
  | { status: "done"; block_ids: string[]; skipped: Array<{ description: string; reason: string }> };

/**
 * 「作業ブロックを用意」操作 (order, issued/accepted の詳細画面)。
 * `SalesFacade.getDocumentLinesForBlocks` (#50 実装済み) → `SchedulingFacade.generateBlocksFromLines`
 * (#52 実装済み) を app 層で合成する。sales⇄scheduling の相互 import はモジュール境界違反のため
 * 禁止されており、この種の合成は app 層 Server Action からのみ許可される定石
 * (00-overview §2.3、実装計画書 issue-61.md 成果物1)。
 *
 * dealId は呼び出し側 (document-detail.tsx) が既に `detail.document.deal_id` として保持している
 * ものをそのまま渡す (issueDocumentAction と同型の設計 — 上記コメント参照)。
 *
 * 二重実行ガード: `confirmed !== true` かつ同一 source_document_id の work_blocks が既に 1 件以上
 * あれば実行せず `{status:"confirm_required"}` を返す (`SchedulingFacadeExtended.
 * countBlocksBySourceDocument`、#61 でこの Issue のために新設した契約外拡張 — facade.ts 参照)。
 * `confirmed === true` で呼び直されたときはガードを再確認せず即座に生成する (呼び出し元の確認
 * ダイアログで一度提示済みのため — LostReasonDialog 等の既存「確認→再実行」パターンと同型)。
 *
 * 明細の一部が work_type_key 解決不能でも部分生成は成立させる (`generateBlocksFromLines` が
 * skipped に理由を積んで返す)。全滅時のみ `generateBlocksFromLines` 自体が KMB-E704 を返すため、
 * ここでは Result をそのまま透過する (呼び出し元 UI が `getErrorInfo("KMB-E704")` の既存文言
 * 「段取りを自動生成できませんでした。テンプレートを登録するか手動で作成してください」を表示する
 * — `src/modules/platform/errors.ts` に実装済みのため、ここで新規に文言を書かない)。
 */
export async function generateBlocksAction(
  documentId: string,
  dealId: string,
  confirmed: boolean,
): Promise<Result<GenerateBlocksActionValue>> {
  const admin = await requireAdminResult();
  if (!admin.ok) return admin;

  const idParsed = z.string().uuid().safeParse(documentId);
  if (!idParsed.success) return { ok: false, code: "KMB-E101", detail: idParsed.error.message };
  const dealIdParsed = z.string().uuid().safeParse(dealId);
  if (!dealIdParsed.success) return { ok: false, code: "KMB-E101", detail: dealIdParsed.error.message };

  const schedulingFacade = createSchedulingFacade();

  if (confirmed !== true) {
    const existing = await schedulingFacade.countBlocksBySourceDocument(idParsed.data);
    if (!existing.ok) return existing;
    if (existing.value.count >= 1) {
      return { ok: true, value: { status: "confirm_required", existingCount: existing.value.count } };
    }
  }

  const lines = await createSalesFacade().getDocumentLinesForBlocks(idParsed.data);
  if (!lines.ok) return lines;

  // MAJOR 修正 (敵対レビュー): 上のガード (confirmed!==true 時の countBlocksBySourceDocument) と
  // 実際の INSERT (generateBlocksFromLines 内 insertWorkBlocks) の間には check-then-act の
  // TOCTOU ウィンドウが残る。DB 側に source_document_id の一意制約が無く (work_blocks は #53
  // 実装済みテーブルで、本修正のスコープはマイグレーション新設不可 — DB 変更なし)、かつ
  // generateBlocksFromLines のシグネチャに confirmed を追加すると tests/documents-generate-
  // blocks-action.test.ts の固定アサーション (`generateBlocksFromLines には deal_id/
  // source_document_id/lines のみを渡す`) を壊すため、facade 側では対処しない。代わりに
  // getDocumentLinesForBlocks (往復1回分) を挟んだ直後・INSERT 直前でもう一段再検証し、この間に
  // 別セッションが先に生成済みなら INSERT せず confirm_required を返す (二重チェックのどちらか
  // 遅い方が勝つ実装だが、少なくとも一方は必ず検知する)。confirmed===true (ユーザーが確認ダイア
  // ログで再生成を明示承認した経路) はこの再検証をスキップする — 既存の設計どおり「一度提示済み
  // なら再確認しない」を維持する。なお残存する極小ウィンドウ (この再検証 〜 実 INSERT の間) は
  // DB 側の一意インデックスが無い限り理論上ゼロにできない — 別 Issue でのマイグレーション追加を
  // 推奨 (openIssues 参照)。
  if (confirmed !== true) {
    const recheck = await schedulingFacade.countBlocksBySourceDocument(idParsed.data);
    if (!recheck.ok) return recheck;
    if (recheck.value.count >= 1) {
      return { ok: true, value: { status: "confirm_required", existingCount: recheck.value.count } };
    }
  }

  const generated = await schedulingFacade.generateBlocksFromLines({
    deal_id: dealIdParsed.data,
    source_document_id: idParsed.data,
    lines: lines.value,
  });
  if (!generated.ok) return generated;

  revalidatePath("/admin/calendar");
  revalidateDocumentPaths(idParsed.data);

  return {
    ok: true,
    value: { status: "done", block_ids: generated.value.block_ids, skipped: generated.value.skipped },
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
