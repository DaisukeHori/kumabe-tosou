import Link from "next/link";

import { PageHeader, PillToggle, SiteSecondaryTabs, type PillItem } from "@/app/admin/_ui";
import { contentFacade } from "@/modules/content/facade";
import type { ContentStatus, PostKind } from "@/modules/content/contracts";

import { PostsListTable } from "./PostsListTable";

export const dynamic = "force-dynamic";

const KIND_TABS: { value: PostKind; label: string }[] = [
  { value: "reading", label: "読みもの" },
  { value: "news", label: "お知らせ" },
  { value: "blog", label: "AIブログ" },
];

const STATUS_OPTIONS: { value: ContentStatus | ""; label: string }[] = [
  { value: "", label: "すべての状態" },
  { value: "draft", label: "下書き" },
  { value: "review", label: "レビュー待ち" },
  { value: "published", label: "公開中" },
  { value: "archived", label: "アーカイブ" },
];

type SearchParams = { kind?: string; status?: string; q?: string; cursor?: string };

function isPostKind(value: string | undefined): value is PostKind {
  return value === "reading" || value === "news" || value === "blog";
}

export default async function PostsListPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const kind: PostKind = isPostKind(params.kind) ? params.kind : "reading";
  const status = (params.status || undefined) as ContentStatus | undefined;
  const search = params.q?.trim() || undefined;

  const result = await contentFacade.listPostsAdmin(kind, {
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
  nextQuery.set("kind", kind);
  if (status) nextQuery.set("status", status);
  if (search) nextQuery.set("q", search);
  if (result.value.next_cursor) nextQuery.set("cursor", result.value.next_cursor);

  // ハブタブ配下の二次フィルタ (移行設計.md §1.2A: kind タブは共存)。R0 の PillToggle で
  // reading/news/blog を切り替える。URL クエリ (?kind=) は現行のまま維持する。
  const kindPills: PillItem[] = KIND_TABS.map((tab) => ({
    key: tab.value,
    label: tab.label,
    href: `/admin/posts?kind=${tab.value}`,
    active: tab.value === kind,
  }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="記事"
        actions={
          <Link
            href={`/admin/posts/new?kind=${kind}`}
            className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/80"
          >
            新規作成
          </Link>
        }
      />
      <SiteSecondaryTabs />

      <PillToggle items={kindPills} ariaLabel="記事の種類" />

      <form method="get" className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="kind" value={kind} />
        <input
          type="text"
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="タイトル・slug・抜粋で検索"
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
        <button type="submit" className="h-8 rounded-lg border border-input px-3 text-sm hover:bg-muted">
          検索
        </button>
      </form>

      <PostsListTable items={result.value.items} />

      {result.value.next_cursor && (
        <Link
          href={`/admin/posts?${nextQuery.toString()}`}
          className="inline-flex h-8 items-center rounded-lg border border-input px-3 text-sm hover:bg-muted"
        >
          次の50件
        </Link>
      )}
    </div>
  );
}
