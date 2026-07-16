import type { Metadata } from "next";

import { PageHeader } from "@/app/admin/_ui";
import { inquiryFacade } from "@/modules/inquiry/facade";
import { mediaFacade } from "@/modules/media/facade";
import { crmFacade } from "@/modules/crm/facade";
import { createSchedulingFacade } from "@/modules/scheduling/facade";
import type { WeeklyCapacity } from "@/modules/scheduling/contracts";
import { createSalesFacade } from "@/modules/sales/facade";
import { telephonyFacade } from "@/modules/telephony/facade";

import { mondayOfWeekJst, todayJstDateOnly } from "@/app/admin/calendar/_ui/jst-time";
import {
  buildDashboardActions,
  formatCallAlertBadge,
  formatRemainingHoursBadge,
  type CallAlertCounts,
} from "@/app/admin/dashboard-kpi-format";
import { ActionCard, ActionEmptyState, KpiSection, KpiTile } from "@/app/admin/dashboard-cards";

export const metadata: Metadata = { title: "今日の仕事" };
export const dynamic = "force-dynamic";

async function loadDashboardData() {
  const weekStart = mondayOfWeekJst(todayJstDateOnly());
  const [inquiryResult, placeholderResult, crmKpiResult, capacityResult, salesDigestResult, callAlertResult] =
    await Promise.all([
      inquiryFacade.countByStatus("new"),
      mediaFacade.countPlaceholders(),
      crmFacade.getDashboardKpi(),
      // ctx 省略 = session (getWeeklyCapacity は ctx 引数自体を持たない、実測 scheduling/facade.ts)
      createSchedulingFacade().getWeeklyCapacity(weekStart),
      // ctx 省略 = session (02-sales §7.5「ダッシュボード『未消込請求』バッジ | app層 | ctx省略=session」)
      createSalesFacade().getSalesDigest(),
      // 内部で requireAdminClient() を呼ぶため admin セッション必須 (/admin は middleware+requireAdmin 配下)
      telephonyFacade.getCallAlertCounts(),
    ]);

  return {
    newInquiries: inquiryResult.ok ? inquiryResult.value : null,
    placeholders: placeholderResult.ok ? placeholderResult.value : null,
    crmKpi: crmKpiResult.ok ? crmKpiResult.value : null,
    crmKpiError: crmKpiResult.ok ? null : `${crmKpiResult.code}${crmKpiResult.detail ? `: ${crmKpiResult.detail}` : ""}`,
    capacity: capacityResult.ok ? capacityResult.value : null,
    capacityError: capacityResult.ok ? null : `${capacityResult.code}${capacityResult.detail ? `: ${capacityResult.detail}` : ""}`,
    salesDigest: salesDigestResult.ok ? salesDigestResult.value : null,
    salesDigestError: salesDigestResult.ok
      ? null
      : `${salesDigestResult.code}${salesDigestResult.detail ? `: ${salesDigestResult.detail}` : ""}`,
    callAlerts: callAlertResult.ok ? callAlertResult.value : null,
    callAlertsError: callAlertResult.ok
      ? null
      : `${callAlertResult.code}${callAlertResult.detail ? `: ${callAlertResult.detail}` : ""}`,
  };
}

const jpy = new Intl.NumberFormat("ja-JP");

export default async function AdminDashboardPage() {
  const {
    newInquiries,
    placeholders,
    crmKpi,
    crmKpiError,
    capacity,
    capacityError,
    salesDigest,
    salesDigestError,
    callAlerts,
    callAlertsError,
  } = await loadDashboardData();

  const unpaidCount = salesDigest ? salesDigest.unpaid_invoices.length : null;
  const unpaidTotalJpy = salesDigest ? salesDigest.unpaid_invoices.reduce((sum, d) => sum + d.balance_jpy, 0) : null;

  const actions = buildDashboardActions({
    newInquiries,
    awaitingLeadCount: crmKpi ? crmKpi.awaiting_lead_count : null,
    callAlerts,
    overdueTaskCount: crmKpi ? crmKpi.overdue_task_count : null,
    unpaidCount,
    unpaidTotalJpy,
    placeholders,
  });

  const description =
    actions.length > 0
      ? `今すぐ対応したいことが ${actions.length}件 あります。上から順に片づけましょう。`
      : "今すぐ対応が必要なことはありません。下の数字で全体の状況を確認できます。";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="今日の仕事" description={description} />

      {/* 優先度付きアクションカード: 既存 facade データから「今やること」を導出 (buildDashboardActions)。
          件数 0 のカードは出さないが、対応する KPI/導線は下段グリッドに常設される。 */}
      <div className="flex flex-col gap-2.5">
        {actions.length > 0 ? (
          actions.map((item, i) => <ActionCard key={item.key} item={item} index={i + 1} />)
        ) : (
          <ActionEmptyState />
        )}
      </div>

      {/* 現行ダッシュボードの全 KPI/導線を維持 (ユーザー方針: 既存機能は落とさない)。
          問い合わせ・仮素材・review 待ち・配信の 4 枚。 */}
      <KpiSection title="受付とホームページ">
        <KpiTile
          label="未処理の問い合わせ"
          value={newInquiries === null ? "—" : newInquiries}
          href="/admin/inquiries?status=new"
          badge={{ text: "status = new", variant: newInquiries ? "warning" : "neutral" }}
        />
        <KpiTile
          label="review 待ち (事例/記事/声)"
          value="—"
          badge={{ text: "content モジュール実装待ち", variant: "outline" }}
        />
        <KpiTile
          label="仮素材 (is_placeholder) 残数"
          value={placeholders === null ? "—" : placeholders}
          href="/admin/media?filter=placeholder"
          badge={{ text: "要差し替え", variant: placeholders ? "warning" : "neutral" }}
        />
        <KpiTile
          label="配信 (X / Instagram / note)"
          value="—"
          badge={{ text: "未接続", variant: "neutral" }}
        />
      </KpiSection>

      {/* crm KPI 4 枚 (01-crm.md §8.6)。導線・数値・degrade 表示を現行から保持。 */}
      <KpiSection title="商談とやること">
        <KpiTile
          label="未対応の相談"
          value={crmKpi ? crmKpi.awaiting_lead_count : "—"}
          href="/admin/deals"
          badge={{
            text: "stage = 相談",
            variant: crmKpi && crmKpi.awaiting_lead_count > 0 ? "warning" : "neutral",
          }}
        />
        <KpiTile
          label="見込み合計 (加重)"
          value={crmKpi ? `¥${jpy.format(crmKpi.weighted_pipeline_jpy)}` : "—"}
          href="/admin/deals"
          badge={{ text: "Σ floor(金額×確度)", variant: "outline" }}
        />
        <KpiTile
          label="期限切れのやること"
          value={crmKpi ? crmKpi.overdue_task_count : "—"}
          href="/admin/tasks"
          badge={{
            text: "要対応",
            variant: crmKpi && crmKpi.overdue_task_count > 0 ? "urgent" : "neutral",
          }}
        />
        <KpiTile
          label="今週のやること"
          value={crmKpi ? crmKpi.week_open_task_count : "—"}
          href="/admin/tasks"
          badge={{ text: "今週期日", variant: "outline" }}
        />
        {crmKpiError && (
          <p className="text-sm text-destructive sm:col-span-2 lg:col-span-4">
            CRM KPI の取得に失敗しました: {crmKpiError}
          </p>
        )}
      </KpiSection>

      {/* scheduling/sales/telephony KPI 3 枚。キャパ残・未消込請求・通話滞留の導線を保持。 */}
      <KpiSection title="予定・請求・通話">
        <CapacityTile capacity={capacity} capacityError={capacityError} />
        <KpiTile
          label="未消込の請求"
          value={unpaidCount === null ? "—" : `${unpaidCount}件`}
          href="/admin/documents?type=invoice&status=issued"
          badge={{
            text: unpaidTotalJpy === null ? (salesDigestError ?? "取得失敗") : `¥${jpy.format(unpaidTotalJpy)}`,
            variant: unpaidCount ? "warning" : "neutral",
          }}
        />
        <CallAlertTile callAlerts={callAlerts} callAlertsError={callAlertsError} />
      </KpiSection>
    </div>
  );
}

function CapacityTile({
  capacity,
  capacityError,
}: {
  capacity: WeeklyCapacity | null;
  capacityError: string | null;
}) {
  const remaining = formatRemainingHoursBadge(capacity);
  return (
    <KpiTile
      label="今週のキャパ残"
      value={remaining.label}
      urgentValue={remaining.negative}
      href="/admin/calendar"
      badge={{
        text: capacity ? `週 ${capacity.weekly_hours}h / 予定 ${capacity.booked_hours}h` : (capacityError ?? "取得失敗"),
        variant: remaining.negative ? "urgent" : "outline",
      }}
    />
  );
}

function CallAlertTile({
  callAlerts,
  callAlertsError,
}: {
  callAlerts: CallAlertCounts | null;
  callAlertsError: string | null;
}) {
  const badge = formatCallAlertBadge(callAlerts);
  return (
    <KpiTile
      label="通話の滞留"
      value={callAlerts === null ? "—" : badge.label}
      href="/admin/calls"
      badge={{
        text: callAlerts === null ? (callAlertsError ?? "取得失敗") : badge.hasAlert ? "要対応" : "平常",
        variant: badge.hasAlert ? "urgent" : "neutral",
      }}
    />
  );
}
