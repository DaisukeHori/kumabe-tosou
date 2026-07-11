import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import type { SettingsKey } from "./contracts";

/**
 * settings モジュールの repository (契約書 §3)。所有テーブル: site_settings。
 *
 * 通常は admin の認証済みセッション (cookie, RLS 適用) をそのまま使う
 * (site_settings は admin に対して SELECT/INSERT/UPDATE 全権 (DELETE 不可) が
 * RLS で許可されているため — cms-ai-pipeline.md §3.2)。
 * getSettingRow は voice webhook / pg_cron worker 等の service 文脈 (07-contracts-delta v1.2
 * D8 の `SettingsFacade.get(key, ctx?)`) からも呼ばれるため、引数型は具体的な server client 型
 * ではなく汎用 SupabaseClient を受け取る (facade.ts が session/service いずれの client を渡すかを
 * 選ぶ — 本ファイルは渡された client をそのまま使う。update/upsertSetting は admin 専用のまま
 * session client 型を維持する)。
 */

type SiteSettingsRow = { key: string; value: unknown; updated_at: string };

export async function getSettingRow(
  supabase: SupabaseClient,
  key: SettingsKey,
): Promise<SiteSettingsRow | null> {
  const { data, error } = await supabase
    .from("site_settings")
    .select("key, value, updated_at")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(`site_settings 取得に失敗しました (${key}): ${error.message}`);
  return data ?? null;
}

export type UpdateSettingResult =
  | { kind: "inserted" }
  | { kind: "updated" }
  | { kind: "conflict" };

/**
 * 楽観的排他付きの upsert。
 * - 行が存在しない場合は新規 INSERT (expectedUpdatedAt は無視 — 初回保存)。
 * - 行が存在する場合は updated_at が一致する場合のみ UPDATE。不一致 (他者更新) は conflict。
 *
 * 注意: expectedUpdatedAt は DB から読み取った updated_at の**生文字列**をそのまま渡すこと。
 * Postgres の timestamptz はマイクロ秒精度で保存されるが `Date.toISOString()` はミリ秒精度
 * までしか表現できず、経由すると下 3 桁が失われ `.eq` が恒久的に不一致になる
 * (content/repository.ts の updateWithOptimisticLock, pricing/repository.ts の upsertGrade と
 * 同じ「生文字列比較」方式に統一する — KMB-E103 誤爆の実バグ修正)。
 */
export async function upsertSetting(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  key: SettingsKey,
  value: unknown,
  expectedUpdatedAt: string,
  updatedBy: string | null,
): Promise<UpdateSettingResult> {
  const existing = await getSettingRow(supabase, key);

  if (!existing) {
    const { error } = await supabase
      .from("site_settings")
      .insert({ key, value, updated_by: updatedBy });
    if (error) throw new Error(`site_settings 作成に失敗しました (${key}): ${error.message}`);
    return { kind: "inserted" };
  }

  const { data: updated, error } = await supabase
    .from("site_settings")
    .update({ value, updated_by: updatedBy })
    .eq("key", key)
    .eq("updated_at", expectedUpdatedAt)
    .select("key")
    .maybeSingle();
  if (error) throw new Error(`site_settings 更新に失敗しました (${key}): ${error.message}`);
  if (!updated) return { kind: "conflict" };
  return { kind: "updated" };
}
