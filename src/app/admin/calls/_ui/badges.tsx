import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getErrorInfo, KMB_ERRORS, type KmbErrorCode } from "@/modules/platform/errors";
import type { CallHandling, CallJobStatus } from "@/modules/telephony/contracts";

/**
 * /admin/calls 一覧・詳細で共有する 2 種のバッジ (04-telephony.md §8.1)。
 * 色構成は既存 ContentStatusBadge (src/app/admin/_ui/status-badge.tsx) の
 * Tailwind クラス (border-transparent bg-*-100 text-*-800 dark:bg-*-500/15 dark:text-*-300) を踏襲する。
 */

const HANDLING_LABEL: Record<CallHandling, string> = {
  forwarded: "転送",
  voicemail: "留守電",
  after_hours_voicemail: "時間外留守電",
  missed: "不在着信",
};

const HANDLING_CLASS: Record<CallHandling, string> = {
  forwarded: "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  voicemail: "border-transparent bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  after_hours_voicemail:
    "border-transparent bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300",
  missed: "border-transparent bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
};

/** handling は dial_result 到達まで null (未確定 — 04-telephony.md §6.1)。 */
export function CallHandlingBadge({ handling }: { handling: CallHandling | null }) {
  if (handling === null) {
    return (
      <Badge variant="outline" className="whitespace-nowrap font-medium text-muted-foreground">
        処理中
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap font-medium", HANDLING_CLASS[handling])}>
      {HANDLING_LABEL[handling]}
    </Badge>
  );
}

const JOB_STATUS_LABEL: Record<CallJobStatus, string> = {
  pending: "待機中",
  downloading: "録音DL中",
  transcribing: "文字起こし中",
  analyzing: "議事録生成中",
  linking: "顧客紐づけ中",
  done: "完了",
  failed: "失敗",
};

const JOB_STATUS_CLASS: Record<CallJobStatus, string> = {
  pending: "border-transparent bg-muted text-muted-foreground",
  downloading: "border-transparent bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  transcribing: "border-transparent bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  analyzing: "border-transparent bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
  linking: "border-transparent bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300",
  done: "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  failed: "border-transparent bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
};

function isKmbErrorCode(code: string): code is KmbErrorCode {
  return Object.prototype.hasOwnProperty.call(KMB_ERRORS, code);
}

/**
 * status===null は「録音なし」(duration=0 の空 done ジョブより前、または job 未作成) の 2 通り
 * あり得るが、いずれも一覧上は「まだ処理対象が無い」という同じ表示で十分 (§10-9)。
 * failed 時は error_code を title 属性 (簡易 Tooltip — shadcn Tooltip 未導入。計画書 6 節の指示どおり)
 * で表示する。
 */
export function JobStatusBadge({
  status,
  errorCode,
}: {
  status: CallJobStatus | null;
  errorCode?: string | null;
}) {
  if (status === null) {
    return (
      <Badge variant="outline" className="whitespace-nowrap font-medium text-muted-foreground">
        録音なし
      </Badge>
    );
  }
  const title =
    status === "failed" && errorCode
      ? `${errorCode}: ${isKmbErrorCode(errorCode) ? getErrorInfo(errorCode).message : "詳細不明のエラー"}`
      : undefined;
  return (
    <Badge
      variant="outline"
      title={title}
      className={cn("whitespace-nowrap font-medium", JOB_STATUS_CLASS[status])}
    >
      {JOB_STATUS_LABEL[status]}
    </Badge>
  );
}
