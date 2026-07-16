import Link from "next/link";
import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { PageHeader, PillToggle } from "@/app/admin/_ui";
import { crmFacade } from "@/modules/crm/facade";
import { DEAL_STAGE_REGISTRY, zDealListFilter, zDealStage, type DealListFilter } from "@/modules/crm/contracts";

import { DealsKanban } from "./deals-kanban";
import { DealsTable } from "./deals-table";

export const metadata: Metadata = { title: "案件" };
export const dynamic = "force-dynamic";

const STAGE_FILTERS: { value: DealListFilter["stage"]; label: string }[] = [
  { value: "open", label: "進行中" },
  { value: "all", label: "すべて" },
  ...zDealStage.options.map((s) => ({ value: s, label: DEAL_STAGE_REGISTRY[s].label })),
];

/** カンバン⇄表 の表示切替ピル。URL は現行の /admin/deals と ?view=table をそのまま維持する。 */
function viewToggleItems(isTableView: boolean) {
  return [
    { key: "kanban", label: "カンバン", href: "/admin/deals", active: !isTableView },
    { key: "table", label: "表", href: "/admin/deals?view=table", active: isTableView },
  ];
}

export default async function AdminDealsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; stage?: string; q?: string; cursor?: string }>;
}) {
  const { view, stage: stageParam, q, cursor } = await searchParams;
  const isTableView = view === "table";

  if (!isTableView) {
    const [kanbanResult] = await Promise.all([crmFacade.listDealsKanban()]);
    if (!kanbanResult.ok) {
      return (
        <div className="flex flex-col gap-6">
          <PageHeader title="案件" actions={<Button render={<Link href="/admin/deals/new" />}>新規案件</Button>} />
          <p className="text-sm text-destructive">
            取得に失敗しました ({kanbanResult.code}): {kanbanResult.detail}
          </p>
        </div>
      );
    }
    // 加重パイプライン合計 (§8.6): Σ floor(amount×probability/100)、stage ∉ {paid, lost}。
    // crm/internal/digest.ts の weightedPipelineJpy と同じ式だが、admin UI から
    // crm/internal を import できない (MODULES 境界) ため Server Component 側で再実装している
    // (「クライアント集計禁止規約」は SQL 集計済みの行に対する registry 掛け算をコード側で
    // 行うこと自体は許容 — listDealsKanban は既に stage 別 SQL 集計済みの行を返す)。
    const weightedPipelineJpy = kanbanResult.value.reduce((sum, column) => {
      if (column.stage === "paid" || column.stage === "lost") return sum;
      const probability = DEAL_STAGE_REGISTRY[column.stage].probability;
      return sum + column.deals.reduce((s, d) => s + Math.floor(((d.amount_jpy ?? 0) * probability) / 100), 0);
    }, 0);

    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="案件"
          description="←→ で列移動、↑↓ でカード移動、Shift+←/→ でステージ移動、Enter で詳細です。"
          actions={
            <>
              <PillToggle ariaLabel="表示切替" items={viewToggleItems(false)} />
              <Button render={<Link href="/admin/deals/new" />}>新規案件</Button>
            </>
          }
        />
        <DealsKanban initialColumns={kanbanResult.value} weightedPipelineJpy={weightedPipelineJpy} />
      </div>
    );
  }

  const stage: DealListFilter["stage"] = (
    ["open", "all", ...zDealStage.options] as string[]
  ).includes(stageParam ?? "")
    ? (stageParam as DealListFilter["stage"])
    : "open";
  const filterParsed = zDealListFilter.safeParse({ q: q?.trim() || null, stage });
  const filter: DealListFilter = filterParsed.success ? filterParsed.data : { q: null, stage: "open" };

  const dealsResult = await crmFacade.listDeals(filter, { cursor: cursor ?? null, limit: 50 });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="案件"
        description="↑↓ で移動、Enter で詳細です。"
        actions={
          <>
            <PillToggle ariaLabel="表示切替" items={viewToggleItems(true)} />
            <Button render={<Link href="/admin/deals/new" />}>新規案件</Button>
          </>
        }
      />

      <PillToggle
        ariaLabel="ステージで絞り込み"
        className="flex w-full"
        items={STAGE_FILTERS.map((f) => ({
          key: String(f.value),
          label: f.label,
          href: `/admin/deals?view=table&stage=${f.value}`,
          active: stage === f.value,
        }))}
      />

      {!dealsResult.ok && (
        <p className="text-sm text-destructive">
          一覧の取得に失敗しました ({dealsResult.code}): {dealsResult.detail}
        </p>
      )}
      {dealsResult.ok && (
        <>
          <DealsTable items={dealsResult.value.items} />
          {dealsResult.value.next_cursor && (
            <Link
              href={`/admin/deals?view=table&stage=${stage}&cursor=${encodeURIComponent(dealsResult.value.next_cursor)}`}
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
