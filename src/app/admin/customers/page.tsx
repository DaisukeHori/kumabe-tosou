import Link from "next/link";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NoticePanel, PageHeader } from "@/app/admin/_ui";
import { crmFacade } from "@/modules/crm/facade";

import { CompaniesTable } from "./companies-table";
import { CustomersKanban } from "./customers-kanban";
import { CustomersSearchBar, type LifecycleFilterValue } from "./customers-search-bar";
import { CustomersTable } from "./customers-table";

export const metadata: Metadata = { title: "顧客" };
export const dynamic = "force-dynamic";

const LIFECYCLE_FILTERS: { value: LifecycleFilterValue; label: string }[] = [
  { value: "active", label: "有効" },
  { value: "all", label: "すべて" },
  { value: "lead", label: "見込み" },
  { value: "customer", label: "取引中" },
  { value: "archived", label: "アーカイブ" },
];
const LIFECYCLE_VALUES = LIFECYCLE_FILTERS.map((f) => f.value);

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; lifecycle?: string; tab?: string; view?: string; cursor?: string }>;
}) {
  const { q, lifecycle: lifecycleParam, tab: tabParam, view, cursor } = await searchParams;
  const tab: "customers" | "companies" = tabParam === "companies" ? "companies" : "customers";
  const lifecycle: LifecycleFilterValue = (
    LIFECYCLE_VALUES as string[]
  ).includes(lifecycleParam ?? "")
    ? (lifecycleParam as LifecycleFilterValue)
    : "active";
  const trimmedQ = q?.trim() || null;
  // 顧客カンバン (#99)。deals カンバンと異なり既定はテーブル (検索・会社タブ・ページングが主導線 —
  // 01-crm-suite issue-99.md の判断)。companies タブにはカンバンが無いため tab === "customers" 限定。
  const isKanbanView = view === "kanban" && tab === "customers";

  const kanbanResult = isKanbanView ? await crmFacade.listCustomersKanban() : null;
  const customersResult =
    tab === "customers" && !isKanbanView
      ? await crmFacade.listCustomers(
          { q: trimmedQ, lifecycle, include_merged: false },
          { cursor: cursor ?? null, limit: 50 },
        )
      : null;
  const companiesResult =
    tab === "companies"
      ? await crmFacade.listCompanies({ q: trimmedQ }, { cursor: cursor ?? null, limit: 50 })
      : null;

  function tabHref(nextTab: "customers" | "companies"): string {
    const params = new URLSearchParams();
    if (trimmedQ) params.set("q", trimmedQ);
    if (nextTab === "customers" && lifecycle !== "active") params.set("lifecycle", lifecycle);
    if (nextTab !== "customers") params.set("tab", nextTab);
    // 顧客タブ+カンバン表示中に顧客タブピルを再クリックしても view=kanban を維持する
    // (維持しないと href から view が落ち、意図せずテーブル表示に戻ってしまう)。
    // 会社タブへの遷移では view を保持しない = Kanban を離脱するのが意図通りなのでこの分岐で十分。
    if (nextTab === "customers" && isKanbanView) params.set("view", "kanban");
    const qs = params.toString();
    return qs ? `/admin/customers?${qs}` : "/admin/customers";
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="顧客"
        description={
          isKanbanView
            ? "←→ で列移動、↑↓ でカード移動、Shift+←/→ で状態移動、Enter で詳細です。"
            : "↑↓ で移動、Enter で詳細、/ で検索、Esc で選択解除します。"
        }
        actions={
          <>
            {tab === "customers" &&
              (isKanbanView ? (
                <Link href="/admin/customers">
                  <Badge variant="outline" className="cursor-pointer">
                    テーブル表示
                  </Badge>
                </Link>
              ) : (
                <Link href="/admin/customers?view=kanban">
                  <Badge variant="default" className="cursor-pointer">
                    カンバン表示
                  </Badge>
                </Link>
              ))}
            <Button render={<Link href="/admin/customers/new" />}>新規顧客</Button>
          </>
        }
      />

      <div className="flex gap-2">
        <Link href={tabHref("customers")}>
          <Badge variant={tab === "customers" ? "default" : "outline"} className="cursor-pointer">
            顧客
          </Badge>
        </Link>
        <Link href={tabHref("companies")}>
          <Badge variant={tab === "companies" ? "default" : "outline"} className="cursor-pointer">
            会社
          </Badge>
        </Link>
      </div>

      {!isKanbanView && (
        <CustomersSearchBar q={q ?? ""} lifecycle={lifecycle} tab={tab} filters={LIFECYCLE_FILTERS} />
      )}

      {isKanbanView && kanbanResult && (
        <>
          {!kanbanResult.ok && (
            <NoticePanel tone="danger">
              取得に失敗しました ({kanbanResult.code}): {kanbanResult.detail}
            </NoticePanel>
          )}
          {kanbanResult.ok && <CustomersKanban initialColumns={kanbanResult.value} />}
        </>
      )}

      {tab === "customers" && !isKanbanView && customersResult && (
        <>
          {!customersResult.ok && (
            <NoticePanel tone="danger">
              一覧の取得に失敗しました ({customersResult.code}): {customersResult.detail}
            </NoticePanel>
          )}
          {customersResult.ok && (
            <>
              <CustomersTable items={customersResult.value.items} />
              {customersResult.value.next_cursor && (
                <Link
                  href={`/admin/customers?${new URLSearchParams({
                    ...(trimmedQ ? { q: trimmedQ } : {}),
                    ...(lifecycle !== "active" ? { lifecycle } : {}),
                    cursor: customersResult.value.next_cursor,
                  }).toString()}`}
                  className="text-label text-primary underline-offset-4 hover:underline"
                >
                  次の50件へ →
                </Link>
              )}
            </>
          )}
        </>
      )}

      {tab === "companies" && companiesResult && (
        <>
          {!companiesResult.ok && (
            <NoticePanel tone="danger">
              一覧の取得に失敗しました ({companiesResult.code}): {companiesResult.detail}
            </NoticePanel>
          )}
          {companiesResult.ok && (
            <>
              <CompaniesTable items={companiesResult.value.items} />
              {companiesResult.value.next_cursor && (
                <Link
                  href={`/admin/customers?${new URLSearchParams({
                    ...(trimmedQ ? { q: trimmedQ } : {}),
                    tab: "companies",
                    cursor: companiesResult.value.next_cursor,
                  }).toString()}`}
                  className="text-label text-primary underline-offset-4 hover:underline"
                >
                  次の50件へ →
                </Link>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
