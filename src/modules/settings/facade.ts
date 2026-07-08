import type { Result } from "@/modules/platform/contracts";

import type { SettingsKey, SettingsValue } from "./contracts";

/**
 * settings モジュールの公開 facade (契約書 §5)。
 * インターフェース型定義のみ。実装は Wave 1 以降。
 */
export interface SettingsFacade {
  get<K extends SettingsKey>(key: K): Promise<Result<SettingsValue<K>>>;
  /** 楽観排他 (KMB-E103): expectedUpdatedAt が site_settings.updated_at と不一致なら失敗 */
  update<K extends SettingsKey>(
    key: K,
    value: SettingsValue<K>,
    expectedUpdatedAt: Date,
  ): Promise<Result<void>>;
}
