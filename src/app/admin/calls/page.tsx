import Link from "next/link";
import type { Metadata } from "next";

import { PageHeader, Surface } from "@/app/admin/_ui";
import { Badge } from "@/components/ui/badge";
import type { CallHandling } from "@/modules/telephony/contracts";
import { telephonyFacade } from "@/modules/telephony/facade";

import { CallsListTable } from "./CallsListTable";

export const metadata: Metadata = { title: "通話" };
export const dynamic = "force-dynamic";

const HANDLING_FILTERS: { value: CallHandling | "all"; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "forwarded", label: "転送" },
  { value: "voicemail", label: "留守電" },
  { value: "after_hours_voicemail", label: "時間外留守電" },
  { value: "missed", label: "不在着信" },
];

function buildFilterHref(params: {
  handling: CallHandling | "all";
  needsReview: boolean;
  jobFailed: boolean;
}): string {
  const qs = new URLSearchParams();
  if (params.handling !== "all") qs.set("handling", params.handling);
  if (params.needsReview) qs.set("needsReview", "1");
  if (params.jobFailed) qs.set("jobFailed", "1");
  const query = qs.toString();
  return query.length > 0 ? `/admin/calls?${query}` : "/admin/calls";
}

export default async function AdminCallsPage({
  searchParams,
}: {
  searchParams: Promise<{
    handling?: string;
    needsReview?: string;
    jobFailed?: string;
    filter?: string;
    cursor?: string;
  }>;
}) {
  const params = await searchParams;

  const validHandling = HANDLING_FILTERS.map((f) => f.value).includes(
    (params.handling ?? "all") as CallHandling | "all",
  );
  const handling: CallHandling | "all" = validHandling ? ((params.handling ?? "all") as CallHandling | "all") : "all";

  // ダッシュボード (04-telephony.md §8.4) からの遷移は ?filter=failed / ?filter=needsReview の
  // 1 種類のクエリ形で届く。一覧内部のフィルタ状態 (jobFailed/needsReview) へマップする
  // (計画書「フィルタ UI の内部状態とダッシュボードからの受け口を一致させる」指示どおり)。
  const needsReview = params.needsReview === "1" || params.filter === "needsReview";
  const jobFailed = params.jobFailed === "1" || params.filter === "failed";

  const [setupStatusResult, listResult] = await Promise.all([
    telephonyFacade.getTelephonySetupStatus(),
    telephonyFacade.listCalls({
      cursor: params.cursor ?? null,
      filter: {
        handling: handling === "all" ? undefined : handling,
        needsReview: needsReview || undefined,
        jobFailed: jobFailed || undefined,
      },
    }),
  ]);

  const items = listResult.ok ? listResult.value.items : [];
  const nextCursor = listResult.ok ? listResult.value.next_cursor : null;
  const setupStatus = setupStatusResult.ok ? setupStatusResult.value : null;

  // env 未設定 (E802 degrade) — セットアップ未了時は着信そのものが留守電扱いにならず失敗する
  // 恐れがあるため、明示バナーで案内する (§8.1)。
  const showDegradeBanner = setupStatus !== null && !setupStatus.envConfigured;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="通話"
        description="↑↓ で移動、Enter で詳細、Esc で選択解除、r で失敗ジョブの再実行 (一覧は保存対象が無いため Cmd+S は N/A)。"
        actions={
          setupStatus && setupStatus.staleJobs > 0 ? (
            <Badge variant="destructive">処理の滞留 {setupStatus.staleJobs} 件</Badge>
          ) : undefined
        }
      />

      {showDegradeBanner && (
        <Surface className="border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          電話連携は未設定です。
          <Link href="/admin/settings" className="ml-1 underline underline-offset-4">
            設定手順を見る →
          </Link>
        </Surface>
      )}

      <div className="flex flex-wrap gap-2">
        {HANDLING_FILTERS.map((f) => (
          <Link key={f.value} href={buildFilterHref({ handling: f.value, needsReview, jobFailed })}>
            <Badge variant={handling === f.value ? "default" : "outline"} className="cursor-pointer px-3 py-1">
              {f.label}
            </Badge>
          </Link>
        ))}
        <Link href={buildFilterHref({ handling, needsReview: !needsReview, jobFailed })}>
          <Badge variant={needsReview ? "default" : "outline"} className="cursor-pointer px-3 py-1">
            要確認のみ
          </Badge>
        </Link>
        <Link href={buildFilterHref({ handling, needsReview, jobFailed: !jobFailed })}>
          <Badge variant={jobFailed ? "default" : "outline"} className="cursor-pointer px-3 py-1">
            処理失敗のみ
          </Badge>
        </Link>
      </div>

      {!listResult.ok && (
        <p className="text-sm text-destructive">
          一覧の取得に失敗しました: {listResult.detail ?? listResult.code}
        </p>
      )}

      <CallsListTable items={items} />

      {nextCursor &&
        (() => {
          const baseHref = buildFilterHref({ handling, needsReview, jobFailed });
          const nextHref = `${baseHref}${baseHref.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(nextCursor)}`;
          return (
            <div>
              <Link href={nextHref} className="text-sm underline underline-offset-4">
                さらに読み込む →
              </Link>
            </div>
          );
        })()}
    </div>
  );
}
