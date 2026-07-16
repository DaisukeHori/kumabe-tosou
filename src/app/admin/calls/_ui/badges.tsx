import { Badge } from "@/components/ui/badge";
import { getErrorInfo, KMB_ERRORS, type KmbErrorCode } from "@/modules/platform/errors";
import type { CallHandling, CallJobStatus } from "@/modules/telephony/contracts";

type StatusVariant = "success" | "info" | "warning" | "neutral" | "urgent";

/**
 * /admin/calls 一覧・詳細で共有する 2 種のバッジ (04-telephony.md §8.1)。
 *
 * [#120 R3a] 以前の Tailwind 直値カラー (emerald/sky/indigo/violet/red) を廃止し、
 * R0 で追加した Badge のステータス variant (globals.css の --color-status-* を参照:
 * success/info/warning/neutral/urgent) へ載せ替えた。意味付けは可能な限り従前の
 * 色相を保つ (転送=成功/緑, 留守電=情報/青, 不在着信=注意/黄, 失敗=緊急/赤)。
 */

const HANDLING_LABEL: Record<CallHandling, string> = {
  forwarded: "転送",
  voicemail: "留守電",
  after_hours_voicemail: "時間外留守電",
  missed: "不在着信",
};

const HANDLING_VARIANT: Record<CallHandling, StatusVariant> = {
  forwarded: "success",
  voicemail: "info",
  after_hours_voicemail: "neutral",
  missed: "warning",
};

/** handling は dial_result 到達まで null (未確定 — 04-telephony.md §6.1)。 */
export function CallHandlingBadge({ handling }: { handling: CallHandling | null }) {
  if (handling === null) {
    return (
      <Badge variant="neutral" className="whitespace-nowrap">
        処理中
      </Badge>
    );
  }
  return (
    <Badge variant={HANDLING_VARIANT[handling]} className="whitespace-nowrap">
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

const JOB_STATUS_VARIANT: Record<CallJobStatus, StatusVariant> = {
  pending: "neutral",
  downloading: "info",
  transcribing: "info",
  analyzing: "info",
  linking: "info",
  done: "success",
  failed: "urgent",
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
      <Badge variant="neutral" className="whitespace-nowrap">
        録音なし
      </Badge>
    );
  }
  const title =
    status === "failed" && errorCode
      ? `${errorCode}: ${isKmbErrorCode(errorCode) ? getErrorInfo(errorCode).message : "詳細不明のエラー"}`
      : undefined;
  return (
    <Badge variant={JOB_STATUS_VARIANT[status]} title={title} className="whitespace-nowrap">
      {JOB_STATUS_LABEL[status]}
    </Badge>
  );
}
