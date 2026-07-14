import Link from "next/link";
import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from "@/app/admin/_ui";
import { Badge } from "@/components/ui/badge";
import { inquiryFacade } from "@/modules/inquiry/facade";
import { mediaFacade } from "@/modules/media/facade";
import { crmFacade } from "@/modules/crm/facade";
import type { CrmDashboardKpi } from "@/modules/crm/contracts";
import { createSchedulingFacade } from "@/modules/scheduling/facade";
import type { WeeklyCapacity } from "@/modules/scheduling/contracts";
import { createSalesFacade } from "@/modules/sales/facade";
import type { SalesDigest } from "@/modules/sales/contracts";
import { telephonyFacade } from "@/modules/telephony/facade";

import { mondayOfWeekJst, todayJstDateOnly } from "@/app/admin/calendar/_ui/jst-time";

export const metadata: Metadata = { title: "ダッシュボード" };
export const dynamic = "force-dynamic";

type CallAlertCounts = { failed: number; needsReview: number; stalled: number };

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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="ダッシュボード" description="未処理の問い合わせ・仮素材の残数・配信状況の概況です。" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/admin/inquiries?status=new">
          <Card className="transition-colors hover:bg-muted/40">
            <CardHeader>
              <CardDescription>未処理の問い合わせ</CardDescription>
              <CardTitle className="text-2xl">
                {newInquiries === null ? "—" : newInquiries}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Badge variant={newInquiries ? "default" : "secondary"}>status = new</Badge>
            </CardContent>
          </Card>
        </Link>

        <Card>
          <CardHeader>
            <CardDescription>review 待ち (事例/記事/声)</CardDescription>
            <CardTitle className="text-2xl">—</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="outline">content モジュール実装待ち</Badge>
          </CardContent>
        </Card>

        <Link href="/admin/media?filter=placeholder">
          <Card className="transition-colors hover:bg-muted/40">
            <CardHeader>
              <CardDescription>仮素材 (is_placeholder) 残数</CardDescription>
              <CardTitle className="text-2xl">
                {placeholders === null ? "—" : placeholders}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Badge variant={placeholders ? "default" : "secondary"}>要差し替え</Badge>
            </CardContent>
          </Card>
        </Link>

        <Card>
          <CardHeader>
            <CardDescription>配信 (X / Instagram / note)</CardDescription>
            <CardTitle className="text-2xl">—</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="secondary">未接続</Badge>
          </CardContent>
        </Card>
      </div>

      {/* crm KPI 4 枚 (01-crm.md §8.6)。既存カード群の改変を避け、独立したグリッド行として追記
          (他モジュールが並行してこのファイルにカードを追加する可能性があるため — #44 計画書注記)。 */}
      <CrmKpiSection kpi={crmKpi} error={crmKpiError} />

      {/* sales/scheduling/telephony KPI 3 枚 (実装計画書 issue-61.md 成果物7、00-overview §9.3)。
          crm 4 枚と同じ理由で独立した第 3 のグリッド行として追記し、既存 2 セクションは一切改変しない。 */}
      <SchedulingSalesTelephonyKpiSection
        capacity={capacity}
        capacityError={capacityError}
        salesDigest={salesDigest}
        salesDigestError={salesDigestError}
        callAlerts={callAlerts}
        callAlertsError={callAlertsError}
      />
    </div>
  );
}

function CrmKpiSection({ kpi, error }: { kpi: CrmDashboardKpi | null; error: string | null }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Link href="/admin/deals">
        <Card className="transition-colors hover:bg-muted/40">
          <CardHeader>
            <CardDescription>未対応の相談</CardDescription>
            <CardTitle className="text-2xl">{kpi ? kpi.awaiting_lead_count : "—"}</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={kpi && kpi.awaiting_lead_count > 0 ? "default" : "secondary"}>stage = 相談</Badge>
          </CardContent>
        </Card>
      </Link>

      <Link href="/admin/deals">
        <Card className="transition-colors hover:bg-muted/40">
          <CardHeader>
            <CardDescription>見込み合計 (加重)</CardDescription>
            <CardTitle className="text-2xl">{kpi ? `¥${jpy.format(kpi.weighted_pipeline_jpy)}` : "—"}</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="outline">Σ floor(金額×確度)</Badge>
          </CardContent>
        </Card>
      </Link>

      <Link href="/admin/tasks">
        <Card className="transition-colors hover:bg-muted/40">
          <CardHeader>
            <CardDescription>期限切れのやること</CardDescription>
            <CardTitle className="text-2xl">{kpi ? kpi.overdue_task_count : "—"}</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={kpi && kpi.overdue_task_count > 0 ? "destructive" : "secondary"}>要対応</Badge>
          </CardContent>
        </Card>
      </Link>

      <Link href="/admin/tasks">
        <Card className="transition-colors hover:bg-muted/40">
          <CardHeader>
            <CardDescription>今週のやること</CardDescription>
            <CardTitle className="text-2xl">{kpi ? kpi.week_open_task_count : "—"}</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="outline">今週期日</Badge>
          </CardContent>
        </Card>
      </Link>

      {error && (
        <p className="sm:col-span-2 lg:col-span-4 text-sm text-destructive">
          CRM KPI の取得に失敗しました: {error}
        </p>
      )}
    </div>
  );
}

/**
 * 表示分岐ロジックの純関数抽出 (実装計画書 issue-61.md 成果物11 の設計意図に従う — Server
 * Component である本ファイルは RTL 未導入のため JSX ごとの単体テストができない。負値赤字化・
 * 0 件平常表示・null/エラー時の degrade 表示の分岐だけを純関数として切り出し、テストから直接
 * import できるようにしておく)。
 */
export function formatRemainingHoursBadge(capacity: WeeklyCapacity | null): { label: string; negative: boolean } {
  if (capacity === null) return { label: "—", negative: false };
  return { label: `あと ${capacity.remaining_hours}h`, negative: capacity.remaining_hours < 0 };
}

export function formatCallAlertBadge(counts: CallAlertCounts | null): { label: string; hasAlert: boolean } {
  if (counts === null) return { label: "—", hasAlert: false };
  const { failed, needsReview, stalled } = counts;
  return {
    label: `失敗 ${failed} / 要確認 ${needsReview} / 滞留 ${stalled}`,
    hasAlert: failed > 0 || needsReview > 0 || stalled > 0,
  };
}

function SchedulingSalesTelephonyKpiSection({
  capacity,
  capacityError,
  salesDigest,
  salesDigestError,
  callAlerts,
  callAlertsError,
}: {
  capacity: WeeklyCapacity | null;
  capacityError: string | null;
  salesDigest: SalesDigest | null;
  salesDigestError: string | null;
  callAlerts: CallAlertCounts | null;
  callAlertsError: string | null;
}) {
  const remaining = formatRemainingHoursBadge(capacity);
  const callAlertBadge = formatCallAlertBadge(callAlerts);
  const unpaidCount = salesDigest ? salesDigest.unpaid_invoices.length : null;
  const unpaidTotalJpy = salesDigest ? salesDigest.unpaid_invoices.reduce((sum, d) => sum + d.balance_jpy, 0) : null;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Link href="/admin/calendar">
        <Card className="transition-colors hover:bg-muted/40">
          <CardHeader>
            <CardDescription>今週のキャパ残</CardDescription>
            <CardTitle className={`text-2xl ${remaining.negative ? "text-destructive" : ""}`}>
              {remaining.label}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={remaining.negative ? "destructive" : "outline"}>
              {capacity ? `週 ${capacity.weekly_hours}h / 予定 ${capacity.booked_hours}h` : capacityError ?? "取得失敗"}
            </Badge>
          </CardContent>
        </Card>
      </Link>

      <Link href="/admin/documents?type=invoice&status=issued">
        <Card className="transition-colors hover:bg-muted/40">
          <CardHeader>
            <CardDescription>未消込の請求</CardDescription>
            <CardTitle className="text-2xl">{unpaidCount === null ? "—" : `${unpaidCount}件`}</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={unpaidCount ? "default" : "secondary"}>
              {unpaidTotalJpy === null ? (salesDigestError ?? "取得失敗") : `¥${jpy.format(unpaidTotalJpy)}`}
            </Badge>
          </CardContent>
        </Card>
      </Link>

      <Link href="/admin/calls">
        <Card className="transition-colors hover:bg-muted/40">
          <CardHeader>
            <CardDescription>通話の滞留</CardDescription>
            <CardTitle className="text-2xl">{callAlerts === null ? "—" : callAlertBadge.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant={callAlertBadge.hasAlert ? "destructive" : "secondary"}>
              {callAlerts === null ? callAlertsError ?? "取得失敗" : callAlertBadge.hasAlert ? "要対応" : "平常"}
            </Badge>
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
