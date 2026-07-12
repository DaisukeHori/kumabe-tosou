import Link from "next/link";
import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from "@/app/admin/_ui";
import { Badge } from "@/components/ui/badge";
import { inquiryFacade } from "@/modules/inquiry/facade";
import { mediaFacade } from "@/modules/media/facade";
import { crmFacade } from "@/modules/crm/facade";
import type { CrmDashboardKpi } from "@/modules/crm/contracts";

export const metadata: Metadata = { title: "ダッシュボード" };
export const dynamic = "force-dynamic";

async function loadDashboardData() {
  const [inquiryResult, placeholderResult, crmKpiResult] = await Promise.all([
    inquiryFacade.countByStatus("new"),
    mediaFacade.countPlaceholders(),
    crmFacade.getDashboardKpi(),
  ]);

  return {
    newInquiries: inquiryResult.ok ? inquiryResult.value : null,
    placeholders: placeholderResult.ok ? placeholderResult.value : null,
    crmKpi: crmKpiResult.ok ? crmKpiResult.value : null,
    crmKpiError: crmKpiResult.ok ? null : `${crmKpiResult.code}${crmKpiResult.detail ? `: ${crmKpiResult.detail}` : ""}`,
  };
}

const jpy = new Intl.NumberFormat("ja-JP");

export default async function AdminDashboardPage() {
  const { newInquiries, placeholders, crmKpi, crmKpiError } = await loadDashboardData();

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
