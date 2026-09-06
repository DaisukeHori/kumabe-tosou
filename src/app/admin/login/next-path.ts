/**
 * ログイン後の戻り先 (next パラメータ) のホワイトリスト判定。
 * canonical: docs/design/visual-media-editor.md §5.3 (MINOR-v1.4)。
 *
 * 許可 prefix = /admin /edit /help。相対パスのみ受け付けてオープンリダイレクトを防ぐ
 * (外部 URL・プロトコル相対 URL は startsWith 判定に一致しないため弾かれる)。
 *
 * /help は管理画面ヘルプ (docs/design/admin-help/README.md §3)。ヘルプも middleware で
 * 保護しているため、未ログインでヘルプ URL を開いた人をログイン後にヘルプへ戻せるようにする。
 */
const ALLOWED_NEXT_PREFIXES = ["/admin", "/edit", "/help"] as const;

export function isAllowedLoginNext(next: string): boolean {
  return ALLOWED_NEXT_PREFIXES.some((prefix) => next.startsWith(prefix));
}

/**
 * /admin/login?reason=... の説明文言 (純関数)。
 * requireAdminPage / admin layout (src/app/admin/_lib/require-admin-page.ts) は KMB-E202
 * (認証済みだが profiles に無い = 管理者ではない) を `reason=forbidden` 付きで送ってくる。
 * この場合はログインし直しても解決しないため、その旨を明示する。未知の reason は null (何も出さない)。
 */
export function loginReasonMessage(reason: string | undefined | null): string | null {
  if (reason === "forbidden") {
    return "このアカウントは管理者として登録されていません。管理担当者に登録を依頼するか、別のアカウントでログインしてください。";
  }
  return null;
}
