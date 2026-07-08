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

  async isAdmin(userId) {
    try {
      const profile = await findProfileByIdViaService(userId);
      return profile !== null;
    } catch {
      return false;
    }
  },
};
