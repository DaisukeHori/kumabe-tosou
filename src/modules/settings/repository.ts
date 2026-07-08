import "server-only";

import { createSupabaseServerClient } from "@/lib/supabase/server";

import type { SettingsKey } from "./contracts";

/**
 * settings モジュールの repository (契約書 §3)。所有テーブル: site_settings。
 *
 * admin の認証済みセッション (cookie, RLS 適用) をそのまま使う。
 * site_settings は admin に対して SELECT/INSERT/UPDATE 全権 (DELETE 不可) が
 * RLS で許可されているため (cms-ai-pipeline.md §3.2)、service role は不要。
 */

type SiteSettingsRow = { key: string; value: unknown; updated_at: string };

export async function getSettingRow(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
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
 */
export async function upsertSetting(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  key: SettingsKey,
  value: unknown,
  expectedUpdatedAt: Date,
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
    .eq("updated_at", expectedUpdatedAt.toISOString())
    .select("key")
    .maybeSingle();
  if (error) throw new Error(`site_settings 更新に失敗しました (${key}): ${error.message}`);
  if (!updated) return { kind: "conflict" };
  return { kind: "updated" };
}
