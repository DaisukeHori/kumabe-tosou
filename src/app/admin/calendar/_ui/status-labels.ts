import type { WorkBlockStatus } from "@/modules/scheduling/contracts";

/** work_blocks 状態表示ラベル (03-scheduling.md §5.1) */
export const STATUS_LABEL: Record<WorkBlockStatus, string> = {
  backlog: "未配置",
  scheduled: "配置済み",
  in_progress: "着手中",
  done: "完了",
  cancelled: "キャンセル",
};

/**
 * UI 側のボタン活性制御 (§5.1 許可遷移表の写し)。
 * サーバー側 (facade + internal/block-state.ts) が正の判定を行う — ここでの判定は
 * 「ボタンを出すか」だけの UX 上のショートカットであり、権威ではない (二重検証の原則どおり、
 * 万一 UI 側の判定がズレていても facade 側が KMB-E703 で必ず拒否する)。
 */
export const CAN_PLACE: Record<WorkBlockStatus, boolean> = {
  backlog: true,
  scheduled: true,
  in_progress: true,
  done: false,
  cancelled: false,
};
export const CAN_UNSCHEDULE: Record<WorkBlockStatus, boolean> = {
  backlog: false,
  scheduled: true,
  in_progress: false,
  done: false,
  cancelled: false,
};
export const CAN_START: Record<WorkBlockStatus, boolean> = {
  backlog: false,
  scheduled: true,
  in_progress: false,
  done: false,
  cancelled: false,
};
export const CAN_CANCEL: Record<WorkBlockStatus, boolean> = {
  backlog: true,
  scheduled: true,
  in_progress: true,
  done: false,
  cancelled: false,
};
export const CAN_RECORD_ACTUAL: Record<WorkBlockStatus, boolean> = {
  backlog: false,
  scheduled: true,
  in_progress: true,
  done: true, // 訂正 (P12)
  cancelled: false,
};
export const CAN_EDIT_DETAIL: Record<WorkBlockStatus, boolean> = {
  backlog: true,
  scheduled: true,
  in_progress: true,
  done: false,
  cancelled: true,
};
export const CAN_DELETE: Record<WorkBlockStatus, boolean> = {
  backlog: true,
  scheduled: false,
  in_progress: false,
  done: false,
  cancelled: true,
};
