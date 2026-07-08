import { describe, expect, it } from "vitest";

import { resolveInitialSchedule } from "@/modules/distribution/internal/schedule-policy";
import { zScheduleReq } from "@/modules/distribution/contracts";

const NOW = new Date("2026-07-08T00:00:00.000Z");
const FUTURE = "2026-08-01T00:00:00.000Z";
const PAST = "2026-01-01T00:00:00.000Z";

/**
 * canonical: 設計書 §8.3 (note 半自動フロー) / 契約書 §4.7 zScheduleReq 注記。
 * 「note チャネルの draft は scheduled_at: null 必須→即 manual_required、他チャネル null 禁止」
 */
describe("resolveInitialSchedule: note チャネルの null 検証", () => {
  it("note + scheduled_at=null は manual_required になる (即時)", () => {
    const result = resolveInitialSchedule("note", null, NOW);
    expect(result).toEqual({ ok: true, initialStatus: "manual_required", scheduledAt: null });
  });

  it("note + scheduled_at 指定はエラー (null 必須)", () => {
    const result = resolveInitialSchedule("note", FUTURE, NOW);
    expect(result.ok).toBe(false);
  });
});

describe("resolveInitialSchedule: 他チャネルの null 禁止 + 過去日時丸め", () => {
  it.each(["site_blog", "x", "instagram"] as const)("%s + scheduled_at=null はエラー", (channel) => {
    const result = resolveInitialSchedule(channel, null, NOW);
    expect(result.ok).toBe(false);
  });

  it("x + 未来日時指定は予約公開としてそのまま採用する", () => {
    const result = resolveInitialSchedule("x", FUTURE, NOW);
    expect(result).toEqual({ ok: true, initialStatus: "scheduled", scheduledAt: FUTURE });
  });

  it("x + 過去日時指定は即時 (now) に丸める", () => {
    const result = resolveInitialSchedule("x", PAST, NOW);
    expect(result).toEqual({ ok: true, initialStatus: "scheduled", scheduledAt: NOW.toISOString() });
  });

  it("instagram + 不正な日時文字列はエラー", () => {
    const result = resolveInitialSchedule("instagram", "not-a-date", NOW);
    expect(result.ok).toBe(false);
  });
});

describe("zScheduleReq: shape 検証 (draft 単位 / 1〜8件)", () => {
  it("scheduled_at は null または ISO datetime を許容する (shape レベル)", () => {
    const valid = {
      entries: [
        { draft_id: "550e8400-e29b-41d4-a716-446655440000", scheduled_at: null },
        { draft_id: "550e8400-e29b-41d4-a716-446655440001", scheduled_at: "2026-08-01T00:00:00+09:00" },
      ],
    };
    expect(zScheduleReq.safeParse(valid).success).toBe(true);
  });

  it("entries 0 件は拒否される (min 1)", () => {
    expect(zScheduleReq.safeParse({ entries: [] }).success).toBe(false);
  });

  it("entries 9 件は拒否される (max 8)", () => {
    const entries = Array.from({ length: 9 }, (_, i) => ({
      draft_id: `550e8400-e29b-41d4-a716-44665544000${i}`,
      scheduled_at: null,
    }));
    expect(zScheduleReq.safeParse({ entries }).success).toBe(false);
  });

  it("draft_id が uuid でない場合は拒否される", () => {
    const invalid = { entries: [{ draft_id: "not-a-uuid", scheduled_at: null }] };
    expect(zScheduleReq.safeParse(invalid).success).toBe(false);
  });

  it("scheduled_at に offset の無い datetime 文字列は拒否される (zIsoDatetime は offset 必須)", () => {
    const invalid = {
      entries: [{ draft_id: "550e8400-e29b-41d4-a716-446655440000", scheduled_at: "2026-08-01T00:00:00" }],
    };
    expect(zScheduleReq.safeParse(invalid).success).toBe(false);
  });
});
