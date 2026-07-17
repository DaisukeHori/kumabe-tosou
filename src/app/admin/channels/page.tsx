import type { Metadata } from "next";
import { cookies } from "next/headers";

import { NoticePanel, PageHeader } from "@/app/admin/_ui";
import { isMetaOAuthConfigured, isXOAuthConfigured } from "@/lib/env";
import { decryptCookiePayload } from "@/lib/oauth/state-cookie";
import type { ChannelPostStatus, StyleProfileView } from "@/modules/distribution/contracts";
import { distributionFacade } from "@/modules/distribution/facade";
import type { Channel } from "@/modules/platform/contracts";

import { ChannelPostsQueue, ChannelPostsStatusFilter } from "./channel-posts-queue";
import { ChannelConnectionCards } from "./connection-cards";
import { MetaPageSelector } from "./meta-page-selector";
import { StyleProfileForms } from "./style-profile-forms";

export const metadata: Metadata = { title: "SNSの接続" };
export const dynamic = "force-dynamic";

const VALID_STATUSES: ChannelPostStatus[] = [
  "scheduled",
  "publishing",
  "published",
  "failed",
  "cancelled",
  "manual_required",
];

function toValidStatus(value: string | undefined): ChannelPostStatus | undefined {
  return VALID_STATUSES.includes(value as ChannelPostStatus) ? (value as ChannelPostStatus) : undefined;
}

const STYLE_CHANNELS: Channel[] = ["site_blog", "note", "x", "instagram"];

export default async function AdminChannelsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    cursor?: string;
    x_connected?: string;
    x_error?: string;
    meta_select?: string;
    meta_error?: string;
  }>;
}) {
  const params = await searchParams;
  const statusFilter = toValidStatus(params.status);

  const [accountsResult, queueResult, styleResults, cookieStore] = await Promise.all([
    distributionFacade.listChannelAccounts(),
    distributionFacade.listChannelPosts({ status: statusFilter, cursor: params.cursor ?? null, limit: 50 }),
    Promise.all(STYLE_CHANNELS.map((c) => distributionFacade.getStyleProfile(c))),
    cookies(),
  ]);

  const styleData: Record<Channel, StyleProfileView | null> = {
    site_blog: styleResults[0].ok ? styleResults[0].value : null,
    note: styleResults[1].ok ? styleResults[1].value : null,
    x: styleResults[2].ok ? styleResults[2].value : null,
    instagram: styleResults[3].ok ? styleResults[3].value : null,
  };

  const pendingRaw = cookieStore.get("kmb_meta_pending")?.value ?? null;
  const pendingPages = pendingRaw
    ? decryptCookiePayload<{ pages: { id: string; name: string; access_token: string }[]; expiresAt: string }>(
        pendingRaw,
      )
    : null;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="SNSの接続"
        description="X / Instagram の接続、note ラベル管理、チャネル別文体プロファイル、配信キューを管理します。"
      />

      {params.x_connected && <NoticePanel tone="success">X アカウントを接続しました。</NoticePanel>}
      {params.x_error && (
        <NoticePanel tone="danger">X 接続でエラーが発生しました ({params.x_error})</NoticePanel>
      )}
      {params.meta_error && (
        <NoticePanel tone="danger">Instagram 接続でエラーが発生しました ({params.meta_error})</NoticePanel>
      )}

      {!accountsResult.ok && (
        <p className="text-sm text-destructive">接続状態の取得に失敗しました: {accountsResult.detail ?? accountsResult.code}</p>
      )}
      <ChannelConnectionCards
        accounts={accountsResult.ok ? accountsResult.value : []}
        xEnabled={isXOAuthConfigured()}
        metaEnabled={isMetaOAuthConfigured()}
      />

      {params.meta_select && pendingPages && <MetaPageSelector pages={pendingPages.pages} />}

      <StyleProfileForms data={styleData} />

      <div className="flex flex-col gap-4">
        <div>
          <h2 className="font-heading text-sm font-semibold">配信キュー</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            manual_required は SNS 上の実投稿有無を確認してから「投稿済みにする」or「未投稿 (予約に戻す)」を選んでください。
          </p>
        </div>
        <ChannelPostsStatusFilter current={statusFilter ?? "all"} />
        {!queueResult.ok && (
          <p className="text-sm text-destructive">配信キューの取得に失敗しました: {queueResult.detail ?? queueResult.code}</p>
        )}
        <ChannelPostsQueue items={queueResult.ok ? queueResult.value.items : []} />
      </div>
    </div>
  );
}
