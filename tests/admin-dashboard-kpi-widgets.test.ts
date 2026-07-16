import { describe, expect, it } from "vitest";

import {
  buildDashboardActions,
  formatCallAlertBadge,
  formatRemainingHoursBadge,
  type DashboardActionInput,
} from "@/app/admin/dashboard-kpi-format";

/**
 * canonical: 実装計画書 issue-61.md 成果物7/11 (00-overview §9.3)。
 *
 * src/app/admin/page.tsx は Server Component で RTL 未導入 (vitest は environment: "node")
 * のため、JSX ごとの検証はしない。tests/crm-kpi.test.ts (weightedPipelineJpy/isDigestEmpty を
 * internal/digest.ts から直接テストするパターン) に倣い、3 カードの表示分岐ロジックを
 * 純関数として直接 import してテストする (計画書どおり)。
 *
 * "server-only" は vitest.config.ts のエイリアスで no-op スタブに差し替わっているため、
 * page.tsx が transitively import する scheduling/sales/telephony facade の実モジュールを
 * そのまま import しても例外にならない (実測確認済み)。
 */

describe("formatRemainingHoursBadge (今週のキャパ残カード)", () => {
  it("capacity が null (facade 失敗時の degrade) は '—' / negative:false を返す", () => {
    expect(formatRemainingHoursBadge(null)).toEqual({ label: "—", negative: false });
  });

  it("remaining_hours が正値なら 'あと Xh' / negative:false", () => {
    expect(
      formatRemainingHoursBadge({ week_start: "2026-07-13", weekly_hours: 40, booked_hours: 30, remaining_hours: 10 }),
    ).toEqual({ label: "あと 10h", negative: false });
  });

  it("remaining_hours がちょうど 0 のときは negative:false (境界値、赤字化しない)", () => {
    expect(
      formatRemainingHoursBadge({ week_start: "2026-07-13", weekly_hours: 40, booked_hours: 40, remaining_hours: 0 }),
    ).toEqual({ label: "あと 0h", negative: false });
  });

  it("remaining_hours が負値なら negative:true (赤字化)", () => {
    expect(
      formatRemainingHoursBadge({ week_start: "2026-07-13", weekly_hours: 40, booked_hours: 45, remaining_hours: -5 }),
    ).toEqual({ label: "あと -5h", negative: true });
  });
});

describe("formatCallAlertBadge (通話の滞留カード)", () => {
  it("counts が null (facade 失敗時の degrade) は '—' / hasAlert:false を返す", () => {
    expect(formatCallAlertBadge(null)).toEqual({ label: "—", hasAlert: false });
  });

  it("全て0件は平常表示 (hasAlert:false)", () => {
    expect(formatCallAlertBadge({ failed: 0, needsReview: 0, stalled: 0 })).toEqual({
      label: "失敗 0 / 要確認 0 / 滞留 0",
      hasAlert: false,
    });
  });

  it("failed のみ>0なら hasAlert:true", () => {
    expect(formatCallAlertBadge({ failed: 1, needsReview: 0, stalled: 0 })).toEqual({
      label: "失敗 1 / 要確認 0 / 滞留 0",
      hasAlert: true,
    });
  });

  it("needsReview のみ>0なら hasAlert:true", () => {
    expect(formatCallAlertBadge({ failed: 0, needsReview: 2, stalled: 0 })).toEqual({
      label: "失敗 0 / 要確認 2 / 滞留 0",
      hasAlert: true,
    });
  });

  it("stalled のみ>0なら hasAlert:true", () => {
    expect(formatCallAlertBadge({ failed: 0, needsReview: 0, stalled: 3 })).toEqual({
      label: "失敗 0 / 要確認 0 / 滞留 3",
      hasAlert: true,
    });
  });

  it("複数が同時に>0でも正しく併記する", () => {
    expect(formatCallAlertBadge({ failed: 1, needsReview: 2, stalled: 3 })).toEqual({
      label: "失敗 1 / 要確認 2 / 滞留 3",
      hasAlert: true,
    });
  });
});

describe("buildDashboardActions (今日の仕事アクションカード)", () => {
  const empty: DashboardActionInput = {
    newInquiries: null,
    awaitingLeadCount: null,
    callAlerts: null,
    overdueTaskCount: null,
    unpaidCount: null,
    unpaidTotalJpy: null,
    placeholders: null,
  };

  it("全て null/0 のときはカードを1枚も作らない (平常時の空状態)", () => {
    expect(buildDashboardActions(empty)).toEqual([]);
    expect(
      buildDashboardActions({
        newInquiries: 0,
        awaitingLeadCount: 0,
        callAlerts: { failed: 0, needsReview: 0, stalled: 0 },
        overdueTaskCount: 0,
        unpaidCount: 0,
        unpaidTotalJpy: 0,
        placeholders: 0,
      }),
    ).toEqual([]);
  });

  it("問い合わせ>0 で problems 1件、href は ?status=new を維持", () => {
    const [item, ...rest] = buildDashboardActions({ ...empty, newInquiries: 2 });
    expect(rest).toEqual([]);
    expect(item).toMatchObject({ key: "inquiries", tone: "urgent", href: "/admin/inquiries?status=new" });
    expect(item.title).toContain("2件");
  });

  it("各カードは既存 KPI 導線と同一 href を保つ", () => {
    const all = buildDashboardActions({
      newInquiries: 1,
      awaitingLeadCount: 1,
      callAlerts: { failed: 1, needsReview: 0, stalled: 0 },
      overdueTaskCount: 1,
      unpaidCount: 1,
      unpaidTotalJpy: 86900,
      placeholders: 3,
    });
    expect(all.map((a) => a.key)).toEqual([
      "inquiries",
      "awaiting-lead",
      "calls",
      "overdue-tasks",
      "unpaid",
      "placeholders",
    ]);
    expect(all.map((a) => a.href)).toEqual([
      "/admin/inquiries?status=new",
      "/admin/deals",
      "/admin/calls",
      "/admin/tasks",
      "/admin/documents?type=invoice&status=issued",
      "/admin/media?filter=placeholder",
    ]);
  });

  it("未消込請求カードは合計金額を千区切りで併記する", () => {
    const [item] = buildDashboardActions({ ...empty, unpaidCount: 1, unpaidTotalJpy: 86900 });
    expect(item.key).toBe("unpaid");
    expect(item.description).toContain("¥86,900");
  });

  it("通話は failed/needsReview/stalled のいずれかが>0のときのみカード化する", () => {
    expect(buildDashboardActions({ ...empty, callAlerts: { failed: 0, needsReview: 0, stalled: 0 } })).toEqual([]);
    const [item] = buildDashboardActions({ ...empty, callAlerts: { failed: 0, needsReview: 1, stalled: 0 } });
    expect(item.key).toBe("calls");
    expect(item.description).toBe("失敗 0 / 要確認 1 / 滞留 0");
  });
});
