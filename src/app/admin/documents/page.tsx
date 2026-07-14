import Link from "next/link";
import type { Metadata } from "next";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/app/admin/_ui";
import { crmFacade } from "@/modules/crm/facade";
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
  searchParams: Promise<{ type?: string; status?: string; q?: string; cursor?: string; deal_id?: string }>;
}) {
  const { type, status, q, cursor, deal_id } = await searchParams;

  const docType = zDocType.options.includes((type ?? "") as (typeof zDocType.options)[number])
    ? (type as (typeof zDocType.options)[number])
    : null;
  const docStatus = zDocumentStatus.options.includes((status ?? "") as (typeof zDocumentStatus.options)[number])
    ? (status as (typeof zDocumentStatus.options)[number])
    : null;
  const dealIdParsed = z.string().uuid().safeParse(deal_id);
  const dealIdFilter = dealIdParsed.success ? dealIdParsed.data : null;
  const filter: DocumentListFilter = {
    doc_type: docType,
    status: docStatus,
    deal_id: dealIdFilter,
    q: q?.trim() || null,
  };

  const [result, dealRef] = await Promise.all([
    createSalesFacade().listDocuments(filter, { cursor: cursor ?? null, limit: 50 }),
    dealIdFilter ? crmFacade.getDealRef(dealIdFilter) : Promise.resolve(null),
  ]);

  function filterHref(next: { type?: string; status?: string; deal_id?: string | null }) {
    const params = new URLSearchParams();
    const t = next.type !== undefined ? next.type : (type ?? "");
    const s = next.status !== undefined ? next.status : (status ?? "");
    const d = next.deal_id !== undefined ? next.deal_id : (dealIdFilter ?? "");
    if (t) params.set("type", t);
    if (s) params.set("status", s);
    if (q) params.set("q", q);
    if (d) params.set("deal_id", d);
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

      {dealIdFilter && (
        <div className="flex flex-wrap gap-2">
          <Link href={filterHref({ deal_id: null })}>
            <Badge variant="secondary" className="cursor-pointer gap-1 px-3 py-1">
              案件: {dealRef?.ok ? dealRef.value.title : dealIdFilter} ×
            </Badge>
          </Link>
        </div>
      )}

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
