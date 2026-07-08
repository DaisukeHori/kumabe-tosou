import type { Channel } from "@/modules/platform/contracts";

/**
 * チャネル別 scheduling policy (canonical: 設計書 §8.3 note 半自動フロー / 契約書 §4.7 zScheduleReq 注記)。
 * - note: scheduled_at は null 必須。channel_posts は scheduled を経由せず即 manual_required。
 * - site_blog / x / instagram: scheduled_at は null 禁止。過去日時は「即時」に丸める。
 */

export type ScheduleResolution =
  | { ok: true; initialStatus: "scheduled"; scheduledAt: string }
  | { ok: true; initialStatus: "manual_required"; scheduledAt: null }
  | { ok: false; detail: string };

export function resolveInitialSchedule(
  channel: Channel,
  scheduledAtIso: string | null,
  now: Date = new Date(),
): ScheduleResolution {
  if (channel === "note") {
    if (scheduledAtIso !== null) {
      return {
        ok: false,
        detail: "note チャネルの draft は scheduled_at=null 必須です (即時 manual_required になります)",
      };
    }
    return { ok: true, initialStatus: "manual_required", scheduledAt: null };
  }

  if (scheduledAtIso === null) {
    return { ok: false, detail: `${channel} チャネルの scheduled_at は null にできません` };
  }

  const requested = new Date(scheduledAtIso);
  if (Number.isNaN(requested.getTime())) {
    return { ok: false, detail: "scheduled_at の日時形式が不正です" };
  }
  const effective = requested.getTime() > now.getTime() ? requested : now;
  return { ok: true, initialStatus: "scheduled", scheduledAt: effective.toISOString() };
}
