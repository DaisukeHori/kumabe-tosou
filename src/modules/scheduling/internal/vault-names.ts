// scheduling/internal/vault-names.ts
// canonical: docs/design/crm-suite/03-scheduling.md §3.3 (internal スキーマ)
// Vault secret 名の固定値と、Vault に保存する JSON の値契約。
import { z } from "zod";

/** 固定名 (裁定 J4 / 00-overview §5.4)。変更禁止 — OAuth callback (#54 の担当外だが将来この
 *  定数を参照する) と token.ts の双方が同じ名前で Vault を読み書きする前提。
 *  microsoft は #55 (Microsoft 同期) が使うためのキーのみ先行定義する (実装は #55 の担当)。 */
export const CALENDAR_VAULT_SECRET_NAMES = {
  google: "calendar_google_oauth",
  microsoft: "calendar_microsoft_oauth",
} as const;

/** Vault に保存する JSON (00-overview §5.4 の {access_token, refresh_token, expires_at})。
 *  MSA はローテーション式のため token 応答のたびに全体を上書き保存する (§8.3) */
export const zCalendarVaultSecret = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_at: z.string().datetime({ offset: true }), // access_token の失効時刻 (ISO)
});
export type CalendarVaultSecret = z.infer<typeof zCalendarVaultSecret>;
