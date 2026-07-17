import type { Metadata } from "next";

import { PageHeader, PillToggle, Surface } from "@/app/admin/_ui";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { aiProvidersFacade } from "@/modules/ai-providers/facade";

import {
  formatUsd,
  toByFeature,
  toByKey,
  toByModel,
  toDailyByProvider,
  toStackedBarInputs,
} from "./aggregate";
import { BudgetProgressBar } from "./BudgetProgressBar";
import { isPeriodKey, last30DaysRange, PERIOD_OPTIONS, resolvePeriodRange, type PeriodKey } from "./period";
import { PROVIDER_BADGE_CLASS, PROVIDER_LABEL } from "./provider-meta";
import { UsageStackedBarChart } from "./UsageStackedBarChart";

export const metadata: Metadata = { title: "利用料金" };
export const dynamic = "force-dynamic";

/**
 * /admin/costs (設計書 §9)。
 *
 * 認可: middleware (未ログインは /admin/login へ) + RLS (ai_usage_log/ai_provider_keys は
 * admin only、migration 20260710000015) + facade 内のセッション確認の3層で保護する
 * (prices/settings 等、他の読み取り専用 admin ページと同じ規約。本ページ自体に
 * 書き込み Server Action は無いため requireAdmin() 直呼び出しは無い)。
 *
 * データは aiProvidersFacade.getUsageSummary({from,to}) のみを使う。同 facade は
 * repository.getUsageSummaryRows() で `created_at` の範囲条件を SQL 側 (`.gte`/`.lt`) で
 * 絞り込んだ上で (provider, model, feature, key, date) 単位まで折り畳んだ行を返す
 * (P1 で実装・テスト契約済み)。本ページが行うのはその行を 4 つの表示軸
 * (日別×プロバイダ / モデル別 / キー別 / feature別) に整形するだけで、
 * 生イベントを数え直す集計はしない (整形関数は aggregate.ts に純関数として切り出し、
 * tests/admin-costs-aggregate.test.ts で検証する)。
 */
export default async function AdminCostsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period: periodParam } = await searchParams;
  const period: PeriodKey = isPeriodKey(periodParam) ? periodParam : "this_month";

  const now = new Date();
  const periodRange = resolvePeriodRange(period, now);
  const dailyRange = last30DaysRange(now);

  const [periodSummary, dailySummary, keysResult] = await Promise.all([
    aiProvidersFacade.getUsageSummary(periodRange),
    aiProvidersFacade.getUsageSummary(dailyRange),
    aiProvidersFacade.listKeys(),
  ]);

  const periodRows = periodSummary.ok ? periodSummary.value.rows : [];
  const dailyRows = dailySummary.ok ? dailySummary.value.rows : [];
  const budget = periodSummary.ok ? periodSummary.value.budget : null;

  const labelByKeyId = new Map<string, string>(
    (keysResult.ok ? keysResult.value : []).map((k) => [k.id, `${PROVIDER_LABEL[k.provider]} · ${k.label}`]),
  );

  const dailyPoints = toDailyByProvider(dailyRows, dailyRange.from, dailyRange.to);
  const chartData = toStackedBarInputs(dailyPoints);
  const byModel = toByModel(periodRows);
  const byKey = toByKey(periodRows, labelByKeyId);
  const byFeature = toByFeature(periodRows);

  const costUsed = budget ? budget.reservedMicroUsd + budget.settledMicroUsd : 0;
  const costLimit = budget?.budgetLimitMicroUsd ?? 0;
  const imagesUsed = budget ? budget.reservedImageCount + budget.settledImageCount : 0;
  const imagesLimit = budget?.imageLimit ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="利用料金" description="AI プロバイダの利用料金と月次予算の状況です (µUSD は表示時に USD へ換算)。" />

      {!periodSummary.ok && (
        <p className="text-sm text-destructive">
          利用状況の取得に失敗しました ({periodSummary.code}): {periodSummary.detail}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Surface className="flex flex-col gap-4 p-6">
          <div>
            <p className="text-sm text-muted-foreground">今月の合計</p>
            <p className="font-heading text-3xl font-semibold text-foreground">
              {formatUsd(periodSummary.ok ? periodSummary.value.totalCostMicroUsd : 0)}
            </p>
          </div>
          {budget ? (
            <BudgetProgressBar
              label="月次予算"
              usedLabel={formatUsd(costUsed)}
              limitLabel={formatUsd(costLimit)}
              ratio={costLimit > 0 ? costUsed / costLimit : 0}
            />
          ) : (
            <p className="text-xs text-muted-foreground">予算情報を取得できませんでした。</p>
          )}
        </Surface>

        <Surface className="flex flex-col gap-4 p-6">
          <div>
            <p className="text-sm text-muted-foreground">画像生成枚数 (今月)</p>
            <p className="font-heading text-3xl font-semibold text-foreground">
              {imagesUsed}
              <span className="text-base font-normal text-muted-foreground"> / {imagesLimit} 枚</span>
            </p>
          </div>
          {budget && (
            <BudgetProgressBar
              label="画像生成上限"
              usedLabel={`${imagesUsed} 枚`}
              limitLabel={`${imagesLimit} 枚`}
              ratio={imagesLimit > 0 ? imagesUsed / imagesLimit : 0}
            />
          )}
        </Surface>
      </div>

      <Surface className="flex flex-col gap-4 p-6">
        <p className="text-sm font-medium text-foreground">日別の利用料金 (直近30日、プロバイダ別)</p>
        <UsageStackedBarChart data={chartData} />
      </Surface>

      <PillToggle
        ariaLabel="集計期間"
        items={PERIOD_OPTIONS.map((opt) => ({
          key: opt.key,
          label: opt.label,
          href: `/admin/costs?period=${opt.key}`,
          active: period === opt.key,
        }))}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Surface className="overflow-hidden p-0">
          <p className="border-b border-border px-4 py-3 text-sm font-medium text-foreground">モデル別</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>モデル</TableHead>
                <TableHead className="text-right">金額</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byModel.length === 0 && (
                <TableRow>
                  <TableCell colSpan={2} className="text-center text-muted-foreground">
                    データがありません
                  </TableCell>
                </TableRow>
              )}
              {byModel.map((row) => (
                <TableRow key={`${row.provider}-${row.model}`}>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Badge variant="outline" className={PROVIDER_BADGE_CLASS[row.provider]}>
                        {PROVIDER_LABEL[row.provider]}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{row.model}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{formatUsd(row.costMicroUsd)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Surface>

        <Surface className="overflow-hidden p-0">
          <p className="border-b border-border px-4 py-3 text-sm font-medium text-foreground">キー別</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>キー</TableHead>
                <TableHead className="text-right">金額</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byKey.length === 0 && (
                <TableRow>
                  <TableCell colSpan={2} className="text-center text-muted-foreground">
                    データがありません
                  </TableCell>
                </TableRow>
              )}
              {byKey.map((row) => (
                <TableRow key={row.keyId ?? "none"}>
                  <TableCell>{row.label}</TableCell>
                  <TableCell className="text-right">{formatUsd(row.costMicroUsd)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Surface>

        <Surface className="overflow-hidden p-0">
          <p className="border-b border-border px-4 py-3 text-sm font-medium text-foreground">feature別</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>feature</TableHead>
                <TableHead className="text-right">金額</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byFeature.length === 0 && (
                <TableRow>
                  <TableCell colSpan={2} className="text-center text-muted-foreground">
                    データがありません
                  </TableCell>
                </TableRow>
              )}
              {byFeature.map((row) => (
                <TableRow key={row.feature}>
                  <TableCell>{row.feature}</TableCell>
                  <TableCell className="text-right">{formatUsd(row.costMicroUsd)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Surface>
      </div>
    </div>
  );
}
