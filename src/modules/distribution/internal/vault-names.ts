/**
 * Supabase Vault シークレット命名規約 (canonical: 設計書 §3.6)。
 * 「命名: sns_x_oauth (JSON: access/refresh/expires_at) / sns_instagram_token」
 * note (ai-studio-v2.md §8): セッション Cookie は JSON 化せず、DevTools からコピーした
 * 生の Cookie ヘッダ文字列 (`_note_session_v5=...; note_gql_auth_token=...; XSRF-TOKEN=...`)
 * をそのまま 1 つの Vault secret として保存する (note-draft-client.ts が読み取り時にパースする)。
 */
export const VAULT_SECRET_NAMES = {
  x: "sns_x_oauth",
  instagram: "sns_instagram_token",
  note: "sns_note_session_cookie",
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

/** note の Vault secret は JSON ではなく生の Cookie ヘッダ文字列そのもの (型注釈のみ、実体は string) */
export type NoteVaultSecret = string;
