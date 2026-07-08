import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionAndClient } from "@/lib/supabase/session";
import type { Result } from "@/modules/platform/contracts";

import { SETTINGS_SCHEMAS, type SettingsKey, type SettingsValue } from "./contracts";
import { getSettingRow, upsertSetting } from "./repository";

/**
 * settings モジュールの公開 facade (契約書 §5)。
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

/**
 * §5 の主要シグネチャに加え、admin UI (楽観的排他フォーム) が updated_at を
 * hidden field として保持するために必要な補助メソッド。
 * (契約書 §5 に明記の無い拡張 — module-contracts.md 未更新。オーケストレーターへ報告済み)
 */
export interface SettingsMeta<K extends SettingsKey> {
  value: SettingsValue<K> | null;
  updatedAt: string | null;
  /** true = site_settings に行がまだ存在しない (初回保存前) */
  isUnset: boolean;
}

export interface SettingsFacadeExtended extends SettingsFacade {
  getWithMeta<K extends SettingsKey>(key: K): Promise<Result<SettingsMeta<K>>>;
}

export const settingsFacade: SettingsFacadeExtended = {
  async get(key) {
    try {
      const supabase = await createSupabaseServerClient();
      const row = await getSettingRow(supabase, key);
      if (!row) {
        return {
          ok: false,
          code: "KMB-E901",
          detail: `site_settings.${key} が未設定です。seed / 初回保存が必要です。`,
        };
      }
      const parsed = SETTINGS_SCHEMAS[key].safeParse(row.value);
      if (!parsed.success) {
        return {
          ok: false,
          code: "KMB-E901",
          detail: `site_settings.${key} の値が契約 (SETTINGS_SCHEMAS) と一致しません`,
        };
      }
      return { ok: true, value: parsed.data as SettingsValue<typeof key> };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async getWithMeta(key) {
    try {
      const supabase = await createSupabaseServerClient();
      const row = await getSettingRow(supabase, key);
      if (!row) {
        return { ok: true, value: { value: null, updatedAt: null, isUnset: true } };
      }
      const parsed = SETTINGS_SCHEMAS[key].safeParse(row.value);
      if (!parsed.success) {
        return {
          ok: false,
          code: "KMB-E901",
          detail: `site_settings.${key} の値が契約 (SETTINGS_SCHEMAS) と一致しません`,
        };
      }
      return {
        ok: true,
        value: {
          value: parsed.data as SettingsValue<typeof key>,
          updatedAt: row.updated_at,
          isUnset: false,
        },
      };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async update(key, value, expectedUpdatedAt) {
    try {
      const parsed = SETTINGS_SCHEMAS[key].safeParse(value);
      if (!parsed.success) {
        return { ok: false, code: "KMB-E101", detail: parsed.error.message };
      }

      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const result = await upsertSetting(supabase, key, parsed.data, expectedUpdatedAt, user.id);
      if (result.kind === "conflict") {
        return { ok: false, code: "KMB-E103" };
      }
      return { ok: true, value: undefined };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },
};
