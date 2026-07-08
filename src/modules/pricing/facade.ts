import type { Result } from "@/modules/platform/contracts";

import type { EstimateInput, EstimateResult, PriceTable } from "./contracts";

/**
 * pricing モジュールの公開 facade (契約書 §5)。
 * インターフェース型定義のみ。実装は Wave 1 以降。
 */
export interface PricingFacade {
  getActivePriceTable(): Promise<Result<PriceTable>>;
  /** 純関数。shop シミュレータと admin プレビューで共用 */
  estimate(input: EstimateInput): Result<EstimateResult>;
}
