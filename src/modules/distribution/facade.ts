import type { Result } from "@/modules/platform/contracts";

import type { ScheduleEntry } from "./contracts";

/**
 * distribution モジュールの公開 facade (契約書 §5)。
 * インターフェース型定義のみ。実装は Wave 2 以降。
 */
export interface DistributionFacade {
  /** entry = {draft_id, scheduled_at|null} */
  schedulePosts(entries: ScheduleEntry[]): Promise<Result<{ post_ids: string[] }>>;
  cancel(postId: string): Promise<Result<void>>;
  markNotePublished(postId: string, externalUrl: string): Promise<Result<void>>;
  /** 課金ガード用 */
  getMonthlyXPostCount(): Promise<Result<number>>;
}
