import type { TaskListItem } from "@/modules/crm/contracts";

/**
 * やることの期日グルーピング (01-crm.md §8.4)。#99 で page.tsx から抽出し、リスト表示
 * (page.tsx) とカンバン表示 (tasks-kanban.tsx) で共用する。
 *
 * jstTodayDateOnly/jstWeekRange は crm/internal/jst.ts と同じ +9h シフト方式の UI 層再実装
 * (crm/internal は admin UI から import 不可 — MODULES 境界。deals/deals-kanban.tsx の同名関数と
 * 同じ理由の重複であり、page.tsx に元々あった実装をそのままここへ移設しただけで挙動は変えていない)。
 */

export type TaskDueBucket = "overdue" | "today" | "week" | "later" | "no_due";

export const TASK_DUE_BUCKET_LABEL: Record<TaskDueBucket, string> = {
  overdue: "期日超過",
  today: "今日",
  week: "今週",
  later: "それ以降",
  no_due: "期日なし",
};

// tasks-kanban.tsx の列表示順・キーボード移動順序としても使う (deals-kanban.tsx の STAGE_ORDER と同型)。
export const TASK_DUE_BUCKET_ORDER: TaskDueBucket[] = ["overdue", "today", "week", "later", "no_due"];

export function jstTodayDateOnly(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function jstWeekRange(): { from: string; to: string } {
  const shifted = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const dow = shifted.getUTCDay();
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(shifted);
  monday.setUTCDate(monday.getUTCDate() + diffToMonday);
  monday.setUTCHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
}

/** open タスクを期日バケットに分配する (§8.4 の分類規則そのもの。groupOpenTasks/tasks-kanban.tsx が使う)。 */
export function bucketOpenTasks(items: TaskListItem[]): Record<TaskDueBucket, TaskListItem[]> {
  const today = jstTodayDateOnly();
  const week = jstWeekRange();
  const buckets: Record<TaskDueBucket, TaskListItem[]> = {
    overdue: [],
    today: [],
    week: [],
    later: [],
    no_due: [],
  };

  for (const t of items) {
    if (t.due_on === null) {
      buckets.no_due.push(t);
    } else if (t.overdue) {
      buckets.overdue.push(t);
    } else if (t.due_on === today) {
      buckets.today.push(t);
    } else if (t.due_on >= week.from && t.due_on <= week.to) {
      buckets.week.push(t);
    } else {
      buckets.later.push(t);
    }
  }
  return buckets;
}

export type TaskGroup = { key: TaskDueBucket; label: string; tasks: TaskListItem[] };

/** page.tsx のリスト表示用。空グループは非表示にする (既存挙動そのまま — tasks-kanban.tsx は
 *  逆に「空列もドロップ先として表示する」ため bucketOpenTasks を直接使う)。 */
export function groupOpenTasks(items: TaskListItem[]): TaskGroup[] {
  const buckets = bucketOpenTasks(items);
  return TASK_DUE_BUCKET_ORDER.map((key) => ({ key, label: TASK_DUE_BUCKET_LABEL[key], tasks: buckets[key] })).filter(
    (g) => g.tasks.length > 0,
  );
}

/**
 * やることカンバンの DnD/Shift+←→ による期日変更先の決定規則 (#99 受入基準、決定的・JST):
 * 今日→今日日付 / 今週→今週日曜 (week.to。今日が日曜なら today と同じ日になる) /
 * それ以降→来週月曜 (week.to+1日) / 期日なし→null。
 * 「期日超過」列への変更はここでは扱わない (呼び出し元がドロップ・キーボード移動とも禁止する —
 * 過去日への変更は編集 Sheet の担当)。
 */
export function dueDateForBucket(bucket: Exclude<TaskDueBucket, "overdue">): string | null {
  if (bucket === "no_due") return null;
  const today = jstTodayDateOnly();
  if (bucket === "today") return today;
  const week = jstWeekRange();
  if (bucket === "week") return week.to;
  // later: 来週月曜 = 今週日曜 (week.to) + 1日
  const nextMonday = new Date(`${week.to}T00:00:00Z`);
  nextMonday.setUTCDate(nextMonday.getUTCDate() + 1);
  return nextMonday.toISOString().slice(0, 10);
}
