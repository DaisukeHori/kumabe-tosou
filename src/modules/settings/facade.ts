import { unstable_cache } from "next/cache";

import { createSupabasePublicClient } from "@/lib/supabase/public";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionAndClient } from "@/lib/supabase/session";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { ExecutionContext, Result } from "@/modules/platform/contracts";

import { SETTINGS_SCHEMAS, type SettingsKey, type SettingsValue } from "./contracts";
import { getSettingRow, upsertSetting } from "./repository";

/**
 * unstable_cache のタグ (契約外拡張、05-site-settings.md §4.1)。失効は書き込み側 Server
 * Action (submitSettingsForm) の責務 — facade 自身は revalidate しない規約 (page-media/pricing
 * と同じ役割分担)。
 */
export const SITE_SETTINGS_CACHE_TAG = "site_settings";

/**
 * settings モジュールの公開 facade (契約書 §5)。
 */
export interface SettingsFacade {
  /**
   * ctx 省略時は現行挙動と完全一致 (session — cookie 付き server client)。
   * ctx={mode:'service'} は voice webhook / pg_cron worker 等、cookie セッションを
   * 持たない呼び出し元向け (07-contracts-delta v1.2 D8 — site_settings の anon SELECT は
   * 公開キー許可リストに限定されるため、telephony の business_hours read や crm の
   * notifications read はこの経路で service_role 相当の読み取りを行う)。
   */
  get<K extends SettingsKey>(key: K, ctx?: ExecutionContext): Promise<Result<SettingsValue<K>>>;
  /**
   * 楽観排他 (KMB-E103): expectedUpdatedAt が site_settings.updated_at と不一致なら失敗。
   * expectedUpdatedAt は getWithMeta で取得した updated_at の生文字列をそのまま渡すこと
   * (Date へ変換するとマイクロ秒精度が失われ、常に conflict になる実バグを踏むため)。
   */
  update<K extends SettingsKey>(
    key: K,
    value: SettingsValue<K>,
    expectedUpdatedAt: string,
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
  /**
   * 05-site-settings.md §6.5 (v1.1 新設): 行は存在するが値が SETTINGS_SCHEMAS と不一致
   * (手動 SQL 事故・将来のスキーマ厳格化) の破損行を表す。後方互換のため optional —
   * 既存呼び出し側 (facade.get / getPublicValue 経由の呼び出し元) はこのフィールドを
   * 意識しなくてよい。true のとき `updatedAt` には行の生の updated_at が入る
   * (isUnset は false のまま — 「破損」と「未設定」を混同しないため)。
   */
  corrupted?: boolean;
}

export interface SettingsFacadeExtended extends SettingsFacade {
  getWithMeta<K extends SettingsKey>(key: K): Promise<Result<SettingsMeta<K>>>;
  /**
   * 公開文脈 (generateMetadata / (site) layout 本体 / GET /icon) 用の読み取り専用メソッド
   * (契約外拡張、05-site-settings.md §4.1)。§5 昇格は 07-contracts-delta v1.1「裁定記録」#14 で
   * 却下済み — 呼び出し元は app 層のみで getWithMeta と同格の拡張規約に従う。
   *
   * - createSupabasePublicClient (anon・cookie 非依存) のみを使う。**createSupabaseServerClient
   *   (cookies() 依存) は絶対に使わない** — unstable_cache 内で cookies() 依存 client を使うと
   *   Next.js が実行時エラーにし、本番 /shop の fallback 事故 (git log: 「fix: /shopのfallback
   *   の真因を修正 unstable_cache内でcookie依存clientを使っていた」、d3c1b47 以前の一連コミット)
   *   と同型の障害を再現することになる。
   * - 行なし = { ok: true, value: null } (未設定は正常系。§2.4 の「差分のみ DB」意味論 — E901 にしない)
   * - parse 失敗 / DB 接続障害 = { ok: false, code: "KMB-E901" } (呼び出し側 = resolveSiteMeta /
   *   GET /icon が fallback 値で degrade する)
   */
  getPublicValue<K extends SettingsKey>(key: K): Promise<Result<SettingsValue<K> | null>>;
}

/**
 * キャッシュ非経由の生フェッチ (getPublicValue の unstable_cache 内部実装専用)。
 * 行なしは null を返す (JSON-safe な正常値として unstable_cache を素通りさせる)。
 * parse 失敗は throw し、呼び出し側 (getPublicValue) が KMB-E901 に変換する
 * (page-media/facade.ts の fetchResolvedSlotsRaw と同じ「素の fetch 関数は throw、
 * facade メソッドが Result に変換する」役割分担)。
 */
async function fetchPublicSettingRaw<K extends SettingsKey>(key: K): Promise<SettingsValue<K> | null> {
  const supabase = createSupabasePublicClient();
  const row = await getSettingRow(supabase, key);
  if (!row) return null;
  const parsed = SETTINGS_SCHEMAS[key].safeParse(row.value);
  if (!parsed.success) {
    throw new Error(`site_settings.${key} の値が契約 (SETTINGS_SCHEMAS) と一致しません`);
  }
  return parsed.data as SettingsValue<K>;
}

export const settingsFacade: SettingsFacadeExtended = {
  async get(key, ctx) {
    try {
      const supabase =
        ctx?.mode === "service" ? (ctx.client ?? createSupabaseServiceClient()) : await createSupabaseServerClient();
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
        // §6.5 破損行復旧経路: 行はあるが値が契約と不一致 (手動 SQL 事故等)。
        // ここを従来どおり ok:false (KMB-E901) で返すと、呼び出し元 (settings/page.tsx) が
        // { value:null, updatedAt:null, isUnset:true } に丸めてしまい、hidden
        // expected_updated_at が空文字列になる → upsertSetting の `.eq("updated_at", "")` が
        // 既存行に対して恒久的に不一致 (KMB-E103) となり、正しい値を再入力しても保存できず
        // UI から脱出不能になる (§6.5 実測バグ)。
        // ok:true + corrupted:true で返し、行の生 updated_at をそのまま runtime に渡すことで
        // 「正しい値での再保存」を成立させる (楽観排他自体は維持 — 他者が先に直せば通常どおり
        // E103 になる)。isUnset は false のまま (「未設定」と「破損」を混同させない — UI 側の
        // 文言分岐に必要)。
        return {
          ok: true,
          value: { value: null, updatedAt: row.updated_at, isUnset: false, corrupted: true },
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

  async getPublicValue(key) {
    try {
      // page-media/pricing の前例 (§4.1 コメント) にならい、呼び出しごとに新しい unstable_cache
      // ラッパを生成する。Next.js の unstable_cache は keyParts が同一なら同一キャッシュエントリを
      // 引くため、関数オブジェクト自体が呼び出しのたびに新規でも実クエリは 1 エントリに収束する。
      const cached = unstable_cache(() => fetchPublicSettingRaw(key), ["site_settings", key], {
        tags: [SITE_SETTINGS_CACHE_TAG],
      });
      const value = await cached();
      return { ok: true, value };
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
