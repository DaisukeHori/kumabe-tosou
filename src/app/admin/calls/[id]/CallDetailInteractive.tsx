"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Surface } from "@/app/admin/_ui";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { getErrorInfo, KMB_ERRORS, type KmbErrorCode } from "@/modules/platform/errors";
import type { CallDetail } from "@/modules/telephony/contracts";

import { createPlaybackUrlAction, retryCallJobAction, saveCallMemoAction } from "../actions";
import { JobStatusBadge } from "../_ui/badges";

const CALLER_INTENT_LABEL: Record<string, string> = {
  estimate_request: "見積依頼",
  order: "発注",
  inquiry: "問い合わせ",
  schedule: "日程調整",
  complaint: "クレーム",
  sales_call: "営業電話",
  other: "その他",
};

/**
 * µUSD → ¥ 表示換算 (04-telephony.md §2.6/§6.6)。
 * 【判断根拠】telephony/internal/cost.ts の formatCostEstimateJpy と同一の式
 * (`Math.round((total × 150) / 1_000_000)`) を再実装している。internal/** は ESLint MODULES
 * 境界により app 層から import できず、facade にも表示専用フォーマッタは公開されていない
 * (facade 拡張は本 Issue のスコープ外の判断 — telephony facade は既に契約外拡張 5 メソッド +
 * saveCallMemo で完結させる方針のため、表示専用の純粋関数のためだけに facade 面を増やさない)。
 * 定数 150 が internal/cost.ts の USD_JPY_DISPLAY_RATE と乖離しないよう、レート変更時は
 * 両ファイルを同時更新する必要がある (openIssues 記載)。
 */
function formatCostEstimateJpy(twilioCostMicroUsd: number, aiCostMicroUsd: number): number {
  return Math.round(((twilioCostMicroUsd + aiCostMicroUsd) * 150) / 1_000_000);
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "-";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}分${String(s).padStart(2, "0")}秒`;
}

function isDialogOpen(): boolean {
  return document.querySelector('[data-slot="dialog-content"]') !== null;
}

function AudioPlayerRow({ recording }: { recording: CallDetail["recordings"][number] }) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "ready"; url: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  async function handlePlay() {
    setState({ kind: "loading" });
    const result = await createPlaybackUrlAction({ recordingId: recording.id });
    if (!result.ok) {
      setState({ kind: "error", message: getErrorInfo(result.code).message });
      return;
    }
    setState({ kind: "ready", url: result.value.url });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">{recording.source === "dial" ? "転送録音" : "留守電"}</span>
        <span className="text-muted-foreground">{formatDuration(recording.duration_seconds)}</span>
        {state.kind !== "ready" && (
          <Button
            variant="outline"
            size="sm"
            onClick={handlePlay}
            disabled={state.kind === "loading" || recording.storage_path === null}
          >
            {recording.storage_path === null
              ? "ダウンロード待ち"
              : state.kind === "loading"
                ? "取得中..."
                : "再生"}
          </Button>
        )}
      </div>
      {state.kind === "error" && (
        <p className="text-xs text-destructive">
          {state.message}
          <Button variant="link" size="sm" className="ml-2 h-auto p-0" onClick={handlePlay}>
            再取得
          </Button>
        </p>
      )}
      {state.kind === "ready" && (
        // 電話録音に字幕トラックは無い (全文タブが文字起こし相当の代替表示を提供する)。
        <audio
          controls
          src={state.url}
          className="w-full"
          onError={() => setState({ kind: "error", message: "再生用URLの有効期限が切れた可能性があります。" })}
        />
      )}
    </div>
  );
}

function JobStepperRow({
  job,
  onRetried,
}: {
  job: CallDetail["jobs"][number];
  onRetried: () => void;
}) {
  const [isPending, startTransition] = useTransition();

  function handleRetry() {
    startTransition(async () => {
      const result = await retryCallJobAction({ callJobId: job.id });
      if (!result.ok) {
        toast.error(getErrorInfo(result.code).message);
        return;
      }
      toast.success("再実行しました。");
      onRetried();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 text-sm">
      <JobStatusBadge status={job.status} errorCode={job.error_code} />
      <span className="text-xs text-muted-foreground">
        {new Date(job.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
      </span>
      {job.status === "failed" && job.error_code && (
        <span className="text-xs text-destructive">
          {getErrorInfoSafe(job.error_code)}
        </span>
      )}
      {job.status === "failed" && (
        <Button variant="outline" size="sm" onClick={handleRetry} disabled={isPending}>
          {isPending ? "実行中..." : "再実行"}
        </Button>
      )}
    </div>
  );
}

/** job.error_code は DB 上は素の text (check 制約なし — §2.6) のため KmbErrorCode 網羅外があり得る。 */
function getErrorInfoSafe(code: string): string {
  const isKnown = Object.prototype.hasOwnProperty.call(KMB_ERRORS, code);
  return isKnown ? getErrorInfo(code as KmbErrorCode).message : code;
}

function TranscriptAndSummaryTabs({ jobs }: { jobs: CallDetail["jobs"] }) {
  // 全文/要約の表示元 job は analysis がある最新のものを優先 (§11: 併記であり diff ではない)。
  const primaryJob =
    [...jobs].reverse().find((j) => j.analysis !== null) ?? [...jobs].reverse().find((j) => j.transcript !== null);

  if (!primaryJob) {
    return <p className="text-sm text-muted-foreground">まだ文字起こし・議事録がありません。</p>;
  }

  return (
    <Tabs defaultValue="summary">
      <TabsList variant="line">
        <TabsTrigger value="summary">要約</TabsTrigger>
        <TabsTrigger value="full">全文</TabsTrigger>
      </TabsList>
      <TabsContent value="summary" className="mt-4">
        {primaryJob.analysis ? (
          <div className="flex flex-col gap-3 text-sm">
            <p className="whitespace-pre-wrap">{primaryJob.analysis.minutes.summary}</p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                {CALLER_INTENT_LABEL[primaryJob.analysis.minutes.caller_intent] ??
                  primaryJob.analysis.minutes.caller_intent}
              </span>
              {primaryJob.analysis.minutes.callback_required && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                  折り返し要
                </span>
              )}
            </div>
            {primaryJob.analysis.minutes.key_points.length > 0 && (
              <ul className="list-disc pl-5">
                {primaryJob.analysis.minutes.key_points.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}
            {primaryJob.analysis.minutes.callback_note && (
              <p className="text-muted-foreground">メモ: {primaryJob.analysis.minutes.callback_note}</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">AI 議事録は未生成です (全文タブで転写内容を確認できます)。</p>
        )}
      </TabsContent>
      <TabsContent value="full" className="mt-4">
        {primaryJob.transcript ? (
          <div className="flex flex-col gap-3 text-sm">
            {[0, 1].map((channel) => {
              const segments = primaryJob.transcript!.segments.filter((s) => s.channel === channel);
              if (segments.length === 0) return null;
              return (
                <div key={channel} className="rounded-lg bg-muted p-3">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    {channel === 0 ? "相手" : "こちら"}
                  </p>
                  <p className="whitespace-pre-wrap">{segments.map((s) => s.text).join("\n")}</p>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">まだ文字起こしがありません。</p>
        )}
      </TabsContent>
    </Tabs>
  );
}

function TaskSummaryLink({ jobs }: { jobs: CallDetail["jobs"] }) {
  // 【判断根拠 — openIssues 記載】起票タスク一覧 (§8.2-4) は jobs[].link_result.task_ids から
  // 解決する規約だが、CrmFacadeExtended には id 群でタスクを一括取得する契約外拡張が存在しない
  // (listTasks は status/scope フィルタのみ)。個別 getTask も他モジュール呼出可能な形では公開
  // されていないため、タイトル解決まではできず件数 + /admin/tasks への導線に留める
  // (安全側 — データを誤表示せず、機能自体は失わない)。
  const taskIds = [...new Set(jobs.flatMap((j) => j.link_result?.task_ids ?? []))];
  if (taskIds.length === 0) return null;
  return (
    <Surface className="p-4 text-sm">
      <p>
        起票タスク {taskIds.length} 件があります。
        <a href="/admin/tasks" className="ml-2 underline underline-offset-4">
          やること一覧へ →
        </a>
      </p>
    </Surface>
  );
}

export function CallDetailInteractive({
  call,
  recordings,
  jobs,
}: {
  call: CallDetail["call"];
  recordings: CallDetail["recordings"];
  jobs: CallDetail["jobs"];
}) {
  const router = useRouter();
  const [memo, setMemo] = useState(call.memo ?? "");
  const [isSavingMemo, startMemoTransition] = useTransition();
  const memoFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    setMemo(call.memo ?? "");
  }, [call.memo]);

  function saveMemo() {
    startMemoTransition(async () => {
      const result = await saveCallMemoAction({
        callId: call.id,
        memo: memo.trim().length === 0 ? null : memo,
        expectedUpdatedAt: call.updated_at,
      });
      if (!result.ok) {
        toast.error(
          result.code === "KMB-E103" ? "他の操作で更新されています。再読み込みしてください。" : getErrorInfo(result.code).message,
        );
        return;
      }
      toast.success("メモを保存しました。");
      router.refresh();
    });
  }

  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if (isDialogOpen()) return; // 検索/新規作成ダイアログが開いている間は本画面のキー操作を止める
      if (e.key === "Escape") {
        e.preventDefault();
        router.push("/admin/calls");
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        memoFormRef.current?.requestSubmit();
      }
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [router]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span>{new Date(call.started_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</span>
          <span>{formatDuration(call.duration_seconds)}</span>
        </div>
        <Popover>
          <PopoverTrigger render={<Button variant="outline" size="sm" />}>コスト内訳 (概算)</PopoverTrigger>
          <PopoverContent>
            <div className="flex flex-col gap-1 text-sm">
              <p>Twilio (通話・録音): {(call.twilio_cost_estimate_micro_usd / 1_000_000).toFixed(4)} USD</p>
              <p>AI (転写・議事録): {(call.ai_cost_micro_usd / 1_000_000).toFixed(4)} USD</p>
              <p className="font-medium">
                概算合計: ¥{formatCostEstimateJpy(call.twilio_cost_estimate_micro_usd, call.ai_cost_micro_usd)}
              </p>
              <p className="text-xs text-muted-foreground">請求確定額ではありません (換算レート ¥150/USD)。</p>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <Surface className="flex flex-col gap-3 p-4">
        <h3 className="text-sm font-medium text-foreground">録音</h3>
        {recordings.length === 0 && <p className="text-sm text-muted-foreground">録音はありません。</p>}
        {recordings.map((r) => (
          <AudioPlayerRow key={r.id} recording={r} />
        ))}
      </Surface>

      <Surface className="p-4">
        <h3 className="mb-3 text-sm font-medium text-foreground">議事録・全文</h3>
        <TranscriptAndSummaryTabs jobs={jobs} />
      </Surface>

      <TaskSummaryLink jobs={jobs} />

      <Surface className="flex flex-col gap-3 p-4">
        <h3 className="text-sm font-medium text-foreground">処理状態</h3>
        {jobs.length === 0 && <p className="text-sm text-muted-foreground">処理ジョブはありません。</p>}
        {jobs.map((j) => (
          <JobStepperRow key={j.id} job={j} onRetried={() => router.refresh()} />
        ))}
      </Surface>

      <Surface className="flex flex-col gap-3 p-4">
        <h3 className="text-sm font-medium text-foreground">メモ</h3>
        <form
          ref={memoFormRef}
          onSubmit={(e) => {
            e.preventDefault();
            saveMemo();
          }}
          className="flex flex-col gap-3"
        >
          <Textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            maxLength={5000}
            className="min-h-24"
            placeholder="通話内容の補足メモなど"
          />
          <div>
            <Button type="submit" disabled={isSavingMemo}>
              {isSavingMemo ? "保存中..." : "保存 (Cmd+S)"}
            </Button>
          </div>
        </form>
      </Surface>
    </div>
  );
}
