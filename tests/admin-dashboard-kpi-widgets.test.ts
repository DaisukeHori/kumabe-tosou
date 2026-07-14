import { describe, expect, it } from "vitest";

import { formatCallAlertBadge, formatRemainingHoursBadge } from "@/app/admin/page";

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
