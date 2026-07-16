import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { NoticePanel, PageHeader, Surface } from "@/app/admin/_ui";
import { ActivityTimeline } from "@/app/admin/_ui/activity-timeline";
import { MiniTaskList } from "@/app/admin/_ui/mini-task-list";
import { crmFacade } from "@/modules/crm/facade";

import { CustomerProfileCard } from "./CustomerProfileCard";

export const dynamic = "force-dynamic";
// 静的タイトルに固定 (地雷回避: generateMetadata 内で cookie 依存クライアントを使わない —
// documents/[id]/page.tsx:14-17 / deals/[id]/page.tsx の裁定を踏襲。Issue #96 §G:
// カード再構成は別 Issue、本 Issue では metadata + PageHeader(backHref) の追加のみ)。
export const metadata: Metadata = { title: "顧客詳細" };

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const customerResult = await crmFacade.getCustomer(id);
  if (!customerResult.ok) {
    if (customerResult.code === "KMB-E603") notFound();
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="顧客詳細" backHref="/admin/customers" />
        <NoticePanel tone="danger">
          取得に失敗しました ({customerResult.code}): {customerResult.detail}
        </NoticePanel>
      </div>
    );
  }
  const customer = customerResult.value;
  const isMerged = customer.merged_into_customer_id !== null;

  const [dealsResult, tasksResult, timelineResult] = await Promise.all([
    crmFacade.listDealsByCustomer(id, { cursor: null, limit: 50 }),
    crmFacade.listTasksByCustomer(id, { cursor: null, limit: 50 }),
    crmFacade.listTimeline({ customer_id: id }, { cursor: null, limit: 50 }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={customer.name} backHref="/admin/customers" />

      {isMerged && (
        <NoticePanel tone="warning">
          この顧客は統合済みです。
          {customer.merged_into_customer_id && (
            <Link href={`/admin/customers/${customer.merged_into_customer_id}`} className="ml-2">
              統合先を開く →
            </Link>
          )}
        </NoticePanel>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <CustomerProfileCard customer={customer} />

          <Surface className="flex flex-col gap-2 p-4">
            <h3 className="text-label font-bold text-foreground">進行中の案件</h3>
            {!dealsResult.ok && (
              <p className="text-label text-destructive">
                取得に失敗しました ({dealsResult.code}): {dealsResult.detail}
              </p>
            )}
            {dealsResult.ok && dealsResult.value.items.length === 0 && (
              <p className="text-label text-muted-foreground">進行中の案件はありません。</p>
            )}
            {dealsResult.ok && dealsResult.value.items.length > 0 && (
              <ul className="flex flex-col divide-y divide-admin-divider rounded-lg border border-border">
                {dealsResult.value.items.map((deal) => (
                  <li key={deal.id}>
                    <Link
                      href={`/admin/deals/${deal.id}`}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-label hover:bg-muted"
                    >
                      <span className="truncate">{deal.title}</span>
                      <span className="shrink-0 text-meta text-muted-foreground">
                        {deal.amount_jpy !== null ? `¥${new Intl.NumberFormat("ja-JP").format(deal.amount_jpy)}` : "—"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href={`/admin/deals/new?customer_id=${customer.id}`}
              className="text-label text-primary underline-offset-4 hover:underline"
            >
              新規案件を作成 →
            </Link>
          </Surface>

          <Surface className="flex flex-col gap-2 p-4">
            <h3 className="text-label font-bold text-foreground">やること</h3>
            {!tasksResult.ok && (
              <p className="text-label text-destructive">
                取得に失敗しました ({tasksResult.code}): {tasksResult.detail}
              </p>
            )}
            {tasksResult.ok && <MiniTaskList tasks={tasksResult.value.items} />}
          </Surface>
        </div>

        <div className="flex flex-col gap-4">
          <h3 className="text-label font-bold text-foreground">タイムライン</h3>
          {!timelineResult.ok && (
            <p className="text-label text-destructive">
              取得に失敗しました ({timelineResult.code}): {timelineResult.detail}
            </p>
          )}
          {timelineResult.ok && (
            <ActivityTimeline
              target={{ customer_id: id }}
              initialItems={timelineResult.value.items}
              initialNextCursor={timelineResult.value.next_cursor}
            />
          )}
        </div>
      </div>
    </div>
  );
}
