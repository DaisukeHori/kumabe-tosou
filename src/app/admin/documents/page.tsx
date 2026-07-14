import Link from "next/link";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/app/admin/_ui";
import { createSalesFacade } from "@/modules/sales/facade";
import { zDocType, zDocumentStatus, type DocumentListFilter } from "@/modules/sales/contracts";

import { DOC_TYPE_LABEL, DOCUMENT_STATUS_LABEL } from "./_shared";
import { DocumentsSearch } from "./documents-search";
import { DocumentsTable } from "./documents-table";

export const metadata: Metadata = { title: "帳票" };
export const dynamic = "force-dynamic";

const TYPE_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "すべて" },
  ...zDocType.options.map((t) => ({ value: t, label: DOC_TYPE_LABEL[t] })),
];

const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "すべての状態" },
  ...zDocumentStatus.options.map((s) => ({ value: s, label: DOCUMENT_STATUS_LABEL[s] })),
];

export default async function AdminDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; status?: string; q?: string; cursor?: string }>;
}) {
  const { type, status, q, cursor } = await searchParams;

  const docType = zDocType.options.includes((type ?? "") as (typeof zDocType.options)[number])
    ? (type as (typeof zDocType.options)[number])
    : null;
  const docStatus = zDocumentStatus.options.includes((status ?? "") as (typeof zDocumentStatus.options)[number])
    ? (status as (typeof zDocumentStatus.options)[number])
    : null;
  const filter: DocumentListFilter = {
    doc_type: docType,
    status: docStatus,
    deal_id: null,
    q: q?.trim() || null,
  };

  const result = await createSalesFacade().listDocuments(filter, { cursor: cursor ?? null, limit: 50 });

  function filterHref(next: { type?: string; status?: string }) {
    const params = new URLSearchParams();
    const t = next.type !== undefined ? next.type : (type ?? "");
    const s = next.status !== undefined ? next.status : (status ?? "");
    if (t) params.set("type", t);
    if (s) params.set("status", s);
    if (q) params.set("q", q);
    const qs = params.toString();
    return `/admin/documents${qs ? `?${qs}` : ""}`;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="帳票"
        description="↑↓ で行移動、Enter で詳細へ、/ で検索にフォーカスします。"
        actions={<Button render={<Link href="/admin/documents/new" />}>新規作成</Button>}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {TYPE_FILTERS.map((f) => (
            <Link key={f.value || "all"} href={filterHref({ type: f.value })}>
              <Badge variant={(type ?? "") === f.value ? "default" : "outline"} className="cursor-pointer px-3 py-1">
                {f.label}
              </Badge>
            </Link>
          ))}
        </div>
        <DocumentsSearch initialQuery={q ?? ""} type={type ?? ""} status={status ?? ""} />
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <Link key={f.value || "all"} href={filterHref({ status: f.value })}>
            <Badge variant={(status ?? "") === f.value ? "default" : "outline"} className="cursor-pointer px-2.5 py-0.5 text-xs">
              {f.label}
            </Badge>
          </Link>
        ))}
      </div>

      {!result.ok && (
        <p className="text-sm text-destructive">
          一覧の取得に失敗しました ({result.code}): {result.detail}
        </p>
      )}
      {result.ok && (
        <>
          <DocumentsTable items={result.value.items} />
          {result.value.next_cursor && (
            <Link
              href={`${filterHref({})}${filterHref({}).includes("?") ? "&" : "?"}cursor=${encodeURIComponent(result.value.next_cursor)}`}
              className="text-sm underline underline-offset-4"
            >
              次の50件へ →
            </Link>
          )}
        </>
      )}
    </div>
  );
}
