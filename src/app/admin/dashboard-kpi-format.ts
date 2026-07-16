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

/**
 * [#119 R2] 「今日の仕事」アクションカードの派生ロジック (純関数)。
 *
 * page.tsx は Server Component で JSX 単体テストができない (dashboard-kpi-format.ts 冒頭の
 * 注記参照) ため、既存 facade データから「今すぐ対応したいこと」の優先度付きリストを組み立てる
 * 分岐だけをここに切り出し、page.tsx とテストの両方から import する。**新規 facade は追加せず**、
 * 現行ダッシュボードが取得済みのデータ (問い合わせ/CRM/通話/請求/仮素材) のみを入力に取る。
 * 各カードの遷移先 href は現行 KPI 導線と同一に保つ (?status= / ?filter= / ?type=&status= を維持)。
 */
export type DashboardActionTone = "urgent" | "warning" | "info" | "success";

export type DashboardActionItem = {
  key: string;
  tone: DashboardActionTone;
  title: string;
  description: string;
  href: string;
  actionLabel: string;
};

export type DashboardActionInput = {
  newInquiries: number | null;
  awaitingLeadCount: number | null;
  callAlerts: CallAlertCounts | null;
  overdueTaskCount: number | null;
  unpaidCount: number | null;
  unpaidTotalJpy: number | null;
  placeholders: number | null;
};

const actionJpy = new Intl.NumberFormat("ja-JP");

/**
 * 優先度順 (問い合わせ → 相談の見積待ち → 通話 → 期限切れやること → 未消込請求 → 仮素材) に
 * 「対応が必要なもの」だけを積む。件数 0 / null (facade 失敗の degrade) のものはカード化しない
 * (該当 KPI/導線は下段の KPI グリッドに常設されるため導線自体は失われない)。
 */
export function buildDashboardActions(input: DashboardActionInput): DashboardActionItem[] {
  const items: DashboardActionItem[] = [];

  if (input.newInquiries !== null && input.newInquiries > 0) {
    items.push({
      key: "inquiries",
      tone: "urgent",
      title: `新しい問い合わせが ${input.newInquiries}件 届いています`,
      description: "早めの返信が受注につながります。内容を見て対応しましょう。",
      href: "/admin/inquiries?status=new",
      actionLabel: "内容を見て返信する →",
    });
  }

  if (input.awaitingLeadCount !== null && input.awaitingLeadCount > 0) {
    items.push({
      key: "awaiting-lead",
      tone: "urgent",
      title: `見積書を待たせている相談が ${input.awaitingLeadCount}件 あります`,
      description: "相談段階の案件です。見積書を作って送ると次の段階に進みます。",
      href: "/admin/deals",
      actionLabel: "案件を確認する →",
    });
  }

  if (input.callAlerts !== null) {
    const { failed, needsReview, stalled } = input.callAlerts;
    if (failed > 0 || needsReview > 0 || stalled > 0) {
      items.push({
        key: "calls",
        tone: "urgent",
        title: "折り返しや確認が必要な通話があります",
        description: `失敗 ${failed} / 要確認 ${needsReview} / 滞留 ${stalled}`,
        href: "/admin/calls",
        actionLabel: "通話を確認する →",
      });
    }
  }

  if (input.overdueTaskCount !== null && input.overdueTaskCount > 0) {
    items.push({
      key: "overdue-tasks",
      tone: "warning",
      title: `期限が過ぎたやることが ${input.overdueTaskCount}件 あります`,
      description: "期日を過ぎたタスクです。対応するか、期日を見直しましょう。",
      href: "/admin/tasks",
      actionLabel: "やることを確認する →",
    });
  }

  if (input.unpaidCount !== null && input.unpaidCount > 0) {
    const total = input.unpaidTotalJpy ?? 0;
    items.push({
      key: "unpaid",
      tone: "warning",
      title: `入金がまだの請求が ${input.unpaidCount}件 あります`,
      description: `未消込の合計は ¥${actionJpy.format(total)} です。入金状況を確認しましょう。`,
      href: "/admin/documents?type=invoice&status=issued",
      actionLabel: "入金を確認する →",
    });
  }

  if (input.placeholders !== null && input.placeholders > 0) {
    items.push({
      key: "placeholders",
      tone: "info",
      title: `差し替えが必要な仮画像が ${input.placeholders}枚 あります`,
      description: "公開ページに仮素材が残っています。本番の写真へ差し替えましょう。",
      href: "/admin/media?filter=placeholder",
      actionLabel: "写真を差し替える →",
    });
  }

  return items;
}
