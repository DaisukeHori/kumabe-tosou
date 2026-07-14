import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
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

// §8.2: draft=灰, issued=青, accepted=緑, paid=緑, declined/expired=黄, voided=赤
const DOCUMENT_STATUS_CLASS: Record<DocumentStatus, string> = {
  draft: "border-transparent bg-muted text-muted-foreground",
  issued: "border-transparent bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  accepted: "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  paid: "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  declined: "border-transparent bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  expired: "border-transparent bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  voided: "border-transparent bg-destructive/15 text-destructive",
};

export function DocumentStatusBadge({ status }: { status: DocumentStatus | string }) {
  const key = (status in DOCUMENT_STATUS_LABEL ? status : "draft") as DocumentStatus;
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap font-medium", DOCUMENT_STATUS_CLASS[key])}>
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
