import type { Result } from "./contracts";

/**
 * platform モジュールの公開 facade (契約書 §1: 認証・管理者判定・共通 Result 型・エラー定義)。
 * インターフェース型定義のみ。実装 (Supabase Auth 連携等) は Wave 1 以降。
 */
export interface PlatformFacade {
  /** 認証済み管理者を要求する。未認証/非管理者は KMB-E201 / E202 を返す */
  requireAdmin(): Promise<Result<{ userId: string }>>;
  /** 指定ユーザーが admin (profiles 存在) かどうかを判定する */
  isAdmin(userId: string): Promise<boolean>;
}
