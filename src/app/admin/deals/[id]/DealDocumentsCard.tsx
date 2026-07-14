import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Surface } from "@/app/admin/_ui";
import { DOC_TYPE_LABEL, DocumentStatusBadge, formatJpy } from "@/app/admin/documents/_shared";
import type { Paged, Result } from "@/modules/platform/contracts";
import type { DocumentListItem } from "@/modules/sales/contracts";

/**
 * 案件詳細ページの帳票カード (Issue #96 設計 §C-左3、実配線)。
 * `salesFacade.listDocuments({deal_id})` の結果を page.tsx から props で受け取るだけの
 * 表示専用コンポーネント (Result を握り潰さず、失敗時は code+detail を表示する)。
 */
export function DealDocumentsCard({
  dealId,
  documentsResult,
}: {
  dealId: string;
  documentsResult: Result<Paged<DocumentListItem>>;
}) {
  return (
    <Surface className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">帳票</h3>
        <Link href={`/admin/documents/new?deal_id=${dealId}`} className="text-sm underline underline-offset-4">
          新規帳票 →
        </Link>
      </div>

      {!documentsResult.ok && (
        <p className="text-sm text-destructive">
          取得に失敗しました ({documentsResult.code}): {documentsResult.detail}
        </p>
      )}

      {documentsResult.ok && documentsResult.value.items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          まだ帳票がありません。{" "}
          <Link href={`/admin/documents/new?deal_id=${dealId}`} className="underline underline-offset-4">
            作成する →
          </Link>
        </p>
      )}

      {documentsResult.ok && documentsResult.value.items.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {documentsResult.value.items.map((doc) => (
            <li key={doc.id}>
              <Link
                href={`/admin/documents/${doc.id}`}
                className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm hover:bg-muted/60"
              >
                <Badge variant="outline">{DOC_TYPE_LABEL[doc.doc_type]}</Badge>
                <span className="font-medium">{doc.doc_no ?? "下書き"}</span>
                <DocumentStatusBadge status={doc.status} />
                <span className="ml-auto text-muted-foreground">{formatJpy(doc.total_jpy)}</span>
                <span className="text-xs text-muted-foreground">{doc.issue_date ?? "—"}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Surface>
  );
}
