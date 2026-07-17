import { Badge } from "@/components/ui/badge";
import type { TaxCategory } from "@/modules/platform/contracts";
import type { DocType, DocumentStatus } from "@/modules/sales/contracts";

/**
 * `/admin/documents` 一式 (一覧・新規・詳細) が共有する表示用の定数・小部品。
 * canonical: 02-sales.md §8.1〜8.4。
 */

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  quote: "見積",
  order: "受注",
  delivery: "納品",
  invoice: "請求",
};

export const DOCUMENT_STATUS_LABEL: Record<DocumentStatus, string> = {
  draft: "下書き",
  issued: "発行済み",
  accepted: "承諾済み",
  declined: "辞退",
  expired: "失効",
  paid: "入金済み",
  voided: "取消",
};

// §8.2: draft=灰, issued=青, accepted=緑, paid=緑, declined/expired=黄, voided=赤。
// [R4a] 直書き emerald/sky/amber を廃し、R0 の Badge ステータス variant
// (globals.css の --color-status-*) へ載せ替える (deals の DEAL_STAGE と同じ語彙)。
const DOCUMENT_STATUS_VARIANT: Record<
  DocumentStatus,
  "neutral" | "info" | "success" | "warning" | "urgent"
> = {
  draft: "neutral",
  issued: "info",
  accepted: "success",
  paid: "success",
  declined: "warning",
  expired: "warning",
  voided: "urgent",
};

export function DocumentStatusBadge({ status }: { status: DocumentStatus | string }) {
  const key = (status in DOCUMENT_STATUS_LABEL ? status : "draft") as DocumentStatus;
  return (
    <Badge variant={DOCUMENT_STATUS_VARIANT[key]} className="whitespace-nowrap">
      {DOCUMENT_STATUS_LABEL[key] ?? status}
    </Badge>
  );
}

// 印刷紙面 (`src/app/(print)/print/documents/_components/document-sheet.tsx`) と同じ表記に揃える
// (§10.4 の紙面表記と admin 画面の入力 UI で税区分の呼び方が食い違うと現場が混乱するため)。
export const TAX_CATEGORY_LABEL: Record<TaxCategory, string> = {
  standard_10: "10%対象",
  reduced_8: "8%対象(軽減税率)",
  zero: "0%対象",
  exempt: "対象外",
};

export const jpy = new Intl.NumberFormat("ja-JP");

export function formatJpy(value: number): string {
  return `¥${jpy.format(value)}`;
}

/**
 * 「作業ブロックを用意」ボタンの表示専用判定 (docType==='order' かつ status in (issued,
 * accepted))。実装計画書 issue-61.md 成果物2で `document-detail.tsx` に private 関数として実装
 * されていたものを、Issue #96 で `DealWorkSummaryCard.tsx` からも同一判定を再利用するために
 * ここへ export 移動した (2 箇所で判定がズレることを防ぐ)。他の canX 系判定と同じく表示専用の
 * ショートカットであり、実際の可否は generateBlocksAction → SalesFacade.getDocumentLinesForBlocks
 * が session client 側で再検証する (二重チェック、意図的)。
 */
export function canGenerateBlocks(docType: DocType, status: string): boolean {
  return docType === "order" && (status === "issued" || status === "accepted");
}
