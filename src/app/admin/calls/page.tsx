import Link from "next/link";
import type { Metadata } from "next";

import { NoticePanel, PageHeader, PillToggle, type PillItem } from "@/app/admin/_ui";
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

  const handlingPills: PillItem[] = HANDLING_FILTERS.map((f) => ({
    key: String(f.value),
    label: f.label,
    href: buildFilterHref({ handling: f.value, needsReview, jobFailed }),
    active: handling === f.value,
  }));

  const modePills: PillItem[] = [
    {
      key: "needsReview",
      label: "要確認のみ",
      href: buildFilterHref({ handling, needsReview: !needsReview, jobFailed }),
      active: needsReview,
    },
    {
      key: "jobFailed",
      label: "処理失敗のみ",
      href: buildFilterHref({ handling, needsReview, jobFailed: !jobFailed }),
      active: jobFailed,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="通話"
        description="↑↓ で移動、Enter で詳細、Esc で選択解除、r で失敗ジョブの再実行 (一覧は保存対象が無いため Cmd+S は N/A)。"
        actions={
          setupStatus && setupStatus.staleJobs > 0 ? (
            <Badge variant="urgent">処理の滞留 {setupStatus.staleJobs} 件</Badge>
          ) : undefined
        }
      />

      {showDegradeBanner && (
        <NoticePanel tone="warning" title="電話連携は未設定です">
          着信を留守電として受けるには設定が必要です。
          <Link href="/admin/settings?tab=telephony" className="ml-1">
            設定手順を見る →
          </Link>
        </NoticePanel>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <PillToggle items={handlingPills} ariaLabel="種別で絞り込み" />
        <PillToggle items={modePills} ariaLabel="対応状況で絞り込み" />
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
