import Link from "next/link";
import { notFound } from "next/navigation";

import { Surface } from "@/app/admin/_ui";
import { ActivityTimeline } from "@/app/admin/_ui/activity-timeline";
import { MiniTaskList } from "@/app/admin/_ui/mini-task-list";
import { crmFacade } from "@/modules/crm/facade";

import { CustomerProfileCard } from "./CustomerProfileCard";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const customerResult = await crmFacade.getCustomer(id);
  if (!customerResult.ok) {
    if (customerResult.code === "KMB-E603") notFound();
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">
          取得に失敗しました ({customerResult.code}): {customerResult.detail}
        </p>
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
      {isMerged && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
          この顧客は統合済みです。
          {customer.merged_into_customer_id && (
            <Link
              href={`/admin/customers/${customer.merged_into_customer_id}`}
              className="ml-2 underline underline-offset-4"
            >
              統合先を開く →
            </Link>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <CustomerProfileCard customer={customer} />

          <Surface className="flex flex-col gap-2 p-4">
            <h3 className="text-sm font-medium">進行中の案件</h3>
            {!dealsResult.ok && (
              <p className="text-sm text-destructive">
                取得に失敗しました ({dealsResult.code}): {dealsResult.detail}
              </p>
            )}
            {dealsResult.ok && dealsResult.value.items.length === 0 && (
              <p className="text-sm text-muted-foreground">進行中の案件はありません。</p>
            )}
            {dealsResult.ok && dealsResult.value.items.length > 0 && (
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {dealsResult.value.items.map((deal) => (
                  <li key={deal.id}>
                    <Link
                      href={`/admin/deals/${deal.id}`}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-muted/60"
                    >
                      <span className="truncate">{deal.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {deal.amount_jpy !== null ? `¥${new Intl.NumberFormat("ja-JP").format(deal.amount_jpy)}` : "—"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href={`/admin/deals/new?customer_id=${customer.id}`}
              className="text-sm underline underline-offset-4"
            >
              新規案件を作成 →
            </Link>
          </Surface>

          <Surface className="flex flex-col gap-2 p-4">
            <h3 className="text-sm font-medium">やること</h3>
            {!tasksResult.ok && (
              <p className="text-sm text-destructive">
                取得に失敗しました ({tasksResult.code}): {tasksResult.detail}
              </p>
            )}
            {tasksResult.ok && <MiniTaskList tasks={tasksResult.value.items} />}
          </Surface>
        </div>

        <div className="flex flex-col gap-4">
          <h3 className="text-sm font-medium">タイムライン</h3>
          {!timelineResult.ok && (
            <p className="text-sm text-destructive">
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
