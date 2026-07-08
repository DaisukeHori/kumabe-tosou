import Link from "next/link";
import type { Metadata } from "next";

import { Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader } from "@/app/admin/_ui";
import { Badge } from "@/components/ui/badge";
import { inquiryFacade } from "@/modules/inquiry/facade";
import { mediaFacade } from "@/modules/media/facade";

export const metadata: Metadata = { title: "ダッシュボード" };
export const dynamic = "force-dynamic";

async function loadDashboardData() {
  const [inquiryResult, placeholderResult] = await Promise.all([
    inquiryFacade.countByStatus("new"),
    mediaFacade.countPlaceholders(),
  ]);

  return {
    newInquiries: inquiryResult.ok ? inquiryResult.value : null,
    placeholders: placeholderResult.ok ? placeholderResult.value : null,
  };
}

export default async function AdminDashboardPage() {
  const { newInquiries, placeholders } = await loadDashboardData();

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
    </div>
  );
}
