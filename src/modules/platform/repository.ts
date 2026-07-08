import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export { getSessionAndClient } from "@/lib/supabase/session";

/**
 * platform モジュールの repository (契約書 §3: 所有テーブルへの DB アクセス)。
 * 所有テーブル: profiles。
 *
 * requireAdmin() は「現在のログインセッション (cookie)」を前提とするため、
 * anon key + cookie セッションの SSR client (RLS 適用) を使う。
 * profiles_self_select ポリシー (id = auth.uid()) により、本人の行のみ取得できる。
 */

export type SessionProfile = { id: string; display_name: string; role: string };

/** 自分自身の profiles 行 (admin 判定用)。profiles_self_select RLS により本人分のみ取得可能 */
export async function findSelfProfile(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string,
): Promise<SessionProfile | null> {
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, role")
    .eq("id", userId)
    .maybeSingle();
  return data ?? null;
}

/**
 * 任意の userId の admin 判定 (service role 使用、他者セッションの profiles を横断参照するため)。
 * SUPABASE_SERVICE_ROLE_KEY 未設定環境では判定不能なため呼び出し元は false (安全側) を受け取る。
 */
export async function findProfileByIdViaService(userId: string): Promise<SessionProfile | null> {
  let client: SupabaseClient;
  try {
    client = createSupabaseServiceClient();
  } catch {
    // env 未設定 (KMB-E9xx 相当)。service 依存機能は graceful degradation。
    return null;
  }
  const { data } = await client
    .from("profiles")
    .select("id, display_name, role")
    .eq("id", userId)
    .maybeSingle();
  return data ?? null;
}
