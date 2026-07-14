import Link from "next/link";
import type { Metadata } from "next";

import { PageHeader, Surface } from "@/app/admin/_ui";
import { telephonyFacade } from "@/modules/telephony/facade";

import { CallHandlingBadge } from "../_ui/badges";
import { CallDetailInteractive } from "./CallDetailInteractive";
import { CustomerLinkSection } from "./CustomerLinkSection";

export const metadata: Metadata = { title: "通話詳細" };
export const dynamic = "force-dynamic";

const DIRECTION_LABEL: Record<string, string> = { inbound: "着信", outbound: "発信" };

export default async function AdminCallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await telephonyFacade.getCallDetail(id);

  if (!result.ok) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="通話詳細" />
        <Surface className="p-6 text-sm text-destructive">
          通話の取得に失敗しました: {result.detail ?? result.code}
          <div className="mt-3">
            <Link href="/admin/calls" className="underline underline-offset-4">
              一覧へ戻る
            </Link>
          </div>
        </Surface>
      </div>
    );
  }

  const { call, recordings, jobs } = result.value;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={call.customer_name ?? call.from_e164 ?? "番号非通知"}
        description="Esc で一覧へ戻る、Space でプレイヤー再生/停止 (フォーカス時)、Cmd+S でメモを保存します。"
        actions={
          <Link href="/admin/calls" className="text-sm underline underline-offset-4">
            ← 一覧へ
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <CallHandlingBadge handling={call.handling} />
        <span className="text-muted-foreground">{DIRECTION_LABEL[call.direction] ?? call.direction}</span>
      </div>

      <CustomerLinkSection
        callId={call.id}
        customerId={call.customer_id}
        customerName={call.customer_name}
        matchStatus={call.match_status}
        fromE164={call.from_e164}
        expectedUpdatedAt={call.updated_at}
      />

      <CallDetailInteractive call={call} recordings={recordings} jobs={jobs} />
    </div>
  );
}
