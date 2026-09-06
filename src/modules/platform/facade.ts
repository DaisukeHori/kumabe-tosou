import type { SupabaseClient } from "@supabase/supabase-js";

import type { Result } from "./contracts";
import { findProfileByIdViaService, findSelfProfile, getSessionAndClient } from "./repository";

/**
 * platform モジュールの公開 facade (契約書 §1: 認証・管理者判定・共通 Result 型・エラー定義)。
 */
export interface PlatformFacade {
  /** 認証済み管理者を要求する。未認証/非管理者は KMB-E201 / E202 を返す */
  requireAdmin(): Promise<Result<{ userId: string }>>;
  /** 指定ユーザーが admin (profiles 存在) かどうかを判定する */
  isAdmin(userId: string): Promise<boolean>;
  /**
   * 「今ログインしているユーザー本人」が admin かどうかを、そのセッション client で判定する。
   * requireAdmin() と同じ profiles_self_select (RLS) 経路のため service role key を必要としない。
   * 呼び出し元が既にセッション client を持っている場合 (telephony / nav-badges の
   * requireAdminClient) に、isAdmin() の service client 依存を避けるために使う。
   * 【重要】userId は必ず「そのセッションの user.id」であること (他人の判定には使えない —
   * RLS により本人以外は 0 行になり false になる)。
   */
  isSelfAdmin(supabase: SupabaseClient, userId: string): Promise<boolean>;
}

/**
 * Wave 1-A 実装 (Server Action / Route Handler / Server Component から使う唯一の入口)。
 * 全 Action の先頭で requireAdmin() を呼ぶ規約 (設計書 §3.5)。
 */
export const platformFacade: PlatformFacade = {
  async requireAdmin() {
    try {
      const { supabase, user } = await getSessionAndClient();
      if (!user) return { ok: false, code: "KMB-E201" };

      const profile = await findSelfProfile(supabase, user.id);
      if (!profile) return { ok: false, code: "KMB-E202" };

      return { ok: true, value: { userId: user.id } };
    } catch (err) {
      return { ok: false, code: "KMB-E901", detail: err instanceof Error ? err.message : String(err) };
    }
  },

  async isSelfAdmin(supabase, userId) {
    try {
      const profile = await findSelfProfile(supabase, userId);
      return profile !== null;
    } catch {
      return false;
    }
  },

  async isAdmin(userId) {
    try {
      const profile = await findProfileByIdViaService(userId);
      return profile !== null;
    } catch {
      return false;
    }
  },
};
