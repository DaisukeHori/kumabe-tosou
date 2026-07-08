import type { Result } from "@/modules/platform/contracts";

import type { MediaItem } from "./contracts";

/**
 * media モジュールの公開 facade (契約書 §5)。
 * インターフェース型定義のみ。実装は Wave 1 以降。
 */
export interface MediaFacade {
  getPublicUrl(mediaId: string): Result<string>;
  /** IG 用。未生成なら生成 */
  getJpegRenditionUrl(mediaId: string): Promise<Result<string>>;
  /** ai-studio の画像候補提案用 */
  listByTags(tags: string[]): Promise<Result<MediaItem[]>>;
  /** 参照ゼロ検証 (E301) */
  assertDeletable(mediaId: string): Promise<Result<void>>;
}
