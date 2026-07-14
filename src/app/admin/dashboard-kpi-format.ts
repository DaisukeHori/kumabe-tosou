import type { WeeklyCapacity } from "@/modules/scheduling/contracts";

/**
 * ダッシュボードKPIウィジェットの表示分岐ロジック (純関数抽出、実装計画書 issue-61.md 成果物11)。
 *
 * src/app/admin/page.tsx (Next.js Page) は async 関数以外の export を許可しない
 * (`export function` は "not a valid Page export field" でビルド時型エラーになる — Next.js の
 * 制約)。RTL 未導入で JSX ごとの単体テストができないため、負値赤字化・0 件平常表示・
 * null/エラー時の degrade 表示の分岐だけをこのファイルへ切り出し、page.tsx とテストの両方から
 * import する。
 */

export type CallAlertCounts = { failed: number; needsReview: number; stalled: number };

export function formatRemainingHoursBadge(capacity: WeeklyCapacity | null): { label: string; negative: boolean } {
  if (capacity === null) return { label: "—", negative: false };
  return { label: `あと ${capacity.remaining_hours}h`, negative: capacity.remaining_hours < 0 };
}

export function formatCallAlertBadge(counts: CallAlertCounts | null): { label: string; hasAlert: boolean } {
  if (counts === null) return { label: "—", hasAlert: false };
  const { failed, needsReview, stalled } = counts;
  return {
    label: `失敗 ${failed} / 要確認 ${needsReview} / 滞留 ${stalled}`,
    hasAlert: failed > 0 || needsReview > 0 || stalled > 0,
  };
}
