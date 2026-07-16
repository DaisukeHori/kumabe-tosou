import type { Metadata } from "next";

import { NoticePanel, PageHeader } from "@/app/admin/_ui";
import { isGoogleCalendarConfigured, isMsCalendarConfigured } from "@/lib/env";
import { KMB_ERRORS, type KmbErrorCode } from "@/modules/platform/errors";
import type { CalendarProvider } from "@/modules/scheduling/contracts";
import { createSchedulingFacade } from "@/modules/scheduling/facade";

import { CalendarSettingsTabs } from "../_ui/secondary-tabs";
import { CalendarConnectionCards } from "./connection-cards";
import { SyncIssuesTable } from "./sync-issues-table";

export const metadata: Metadata = { title: "外部連携 | カレンダー" };
export const dynamic = "force-dynamic";

function isKmbErrorCode(code: string): code is KmbErrorCode {
  return code in KMB_ERRORS;
}

const PROVIDER_LABEL: Record<CalendarProvider, string> = {
  google: "Google カレンダー",
  microsoft: "Microsoft カレンダー",
};

function isCalendarProvider(value: string): value is CalendarProvider {
  return value === "google" || value === "microsoft";
}

/**
 * /admin/calendar/connections (03-scheduling.md §10.4)。
 * Server Component が getCalendarConnections + listSyncIssues を並列取得 → Client へ渡す。
 * query param フィードバック (`?cal_connected=google` / `?cal_error=...`) はサーバ側で
 * バナー表示する (`/admin/channels` の x_connected/x_error 前例と同型 — トーストではなく
 * インラインバナーが既存規約のため、そちらに合わせる)。
 */
export default async function AdminCalendarConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ cal_connected?: string; cal_error?: string }>;
}) {
  const params = await searchParams;
  const schedulingFacade = createSchedulingFacade();

  const [connectionsResult, issuesResult] = await Promise.all([
    schedulingFacade.getCalendarConnections(),
    schedulingFacade.listSyncIssues(),
  ]);

  const errorInfo =
    params.cal_error && params.cal_error !== "disabled" && isKmbErrorCode(params.cal_error)
      ? KMB_ERRORS[params.cal_error]
      : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="外部連携"
        description="Google / Microsoft カレンダーとの双方向同期の接続状態・同期の問題を管理します。"
        backHref="/admin/calendar"
        backLabel="← 予定表へ"
      />
      <CalendarSettingsTabs />

      {params.cal_connected && (
        <NoticePanel tone="success">
          {isCalendarProvider(params.cal_connected) ? PROVIDER_LABEL[params.cal_connected] : params.cal_connected}
          に接続しました。
        </NoticePanel>
      )}
      {params.cal_error === "disabled" && (
        <NoticePanel tone="danger">外部カレンダー連携が設定されていません (env 未設定)。</NoticePanel>
      )}
      {params.cal_error && params.cal_error !== "disabled" && (
        <NoticePanel tone="danger">
          接続でエラーが発生しました: {errorInfo?.message ?? "不明なエラー"} ({params.cal_error})
        </NoticePanel>
      )}

      {!connectionsResult.ok && (
        <p className="text-sm text-destructive">接続状態の取得に失敗しました: {connectionsResult.detail ?? connectionsResult.code}</p>
      )}
      <CalendarConnectionCards
        connections={connectionsResult.ok ? connectionsResult.value : []}
        googleEnabled={isGoogleCalendarConfigured()}
        msEnabled={isMsCalendarConfigured()}
      />

      <div className="flex flex-col gap-3">
        <div>
          <h2 className="font-heading text-sm font-semibold">同期の問題</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            外部で削除された予定・送信できなかった予定・照合が必要な予定の一覧です。
          </p>
        </div>
        {!issuesResult.ok && (
          <p className="text-sm text-destructive">同期の問題の取得に失敗しました: {issuesResult.detail ?? issuesResult.code}</p>
        )}
        <SyncIssuesTable items={issuesResult.ok ? issuesResult.value : []} />
      </div>
    </div>
  );
}
