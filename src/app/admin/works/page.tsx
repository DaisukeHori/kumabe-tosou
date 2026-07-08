import Link from "next/link";

import { PageHeader } from "@/app/admin/_ui";
import { contentFacade } from "@/modules/content/facade";
import type { ContentStatus } from "@/modules/content/contracts";

import { WorksListTable } from "./WorksListTable";

export const dynamic = "force-dynamic";

const STATUS_OPTIONS: { value: ContentStatus | ""; label: string }[] = [
  { value: "", label: "すべての状態" },
  { value: "draft", label: "下書き" },
  { value: "review", label: "レビュー待ち" },
  { value: "published", label: "公開中" },
  { value: "archived", label: "アーカイブ" },
];

type SearchParams = { status?: string; q?: string; cursor?: string };

export default async function WorksListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const status = (params.status || undefined) as ContentStatus | undefined;
  const search = params.q?.trim() || undefined;

  const result = await contentFacade.listWorksAdmin({
    status,
    search,
    cursor: params.cursor ?? null,
    limit: 50,
  });

  if (!result.ok) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">一覧の取得に失敗しました ({result.code}): {result.detail}</p>
      </div>
    );
  }

  const nextQuery = new URLSearchParams();
  if (status) nextQuery.set("status", status);
  if (search) nextQuery.set("q", search);
  if (result.value.next_cursor) nextQuery.set("cursor", result.value.next_cursor);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="施工事例"
        actions={
          <Link
            href="/admin/works/new"
            className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/80"
          >
            新規作成
          </Link>
        }
      />

      <form method="get" className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="タイトル・slug・カテゴリで検索"
          className="h-8 w-64 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <select
          name="status"
          defaultValue={params.status ?? ""}
          className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="h-8 rounded-lg border border-input px-3 text-sm hover:bg-muted"
        >
          検索
        </button>
      </form>

      <WorksListTable items={result.value.items} />

      {result.value.next_cursor && (
        <Link
          href={`/admin/works?${nextQuery.toString()}`}
          className="inline-flex h-8 items-center rounded-lg border border-input px-3 text-sm hover:bg-muted"
        >
          次の50件
        </Link>
      )}
    </div>
  );
}
