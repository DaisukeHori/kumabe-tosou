/**
 * Supabase Vault シークレット命名規約 (canonical: 設計書 §3.6)。
 * 「命名: sns_x_oauth (JSON: access/refresh/expires_at) / sns_instagram_token」
 */
export const VAULT_SECRET_NAMES = {
  x: "sns_x_oauth",
  instagram: "sns_instagram_token",
} as const;

export type XVaultSecret = {
  access_token: string;
  refresh_token: string;
  expires_at: string; // ISO
};

export type InstagramVaultSecret = {
  access_token: string;
  expires_at: string; // ISO (長期トークン 60 日)
};
