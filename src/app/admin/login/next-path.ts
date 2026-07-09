/**
 * ログイン後の戻り先 (next パラメータ) のホワイトリスト判定。
 * canonical: docs/design/visual-media-editor.md §5.3 (MINOR-v1.4)。
 *
 * 許可 prefix = /admin /edit。相対パスのみ受け付けてオープンリダイレクトを防ぐ
 * (外部 URL・プロトコル相対 URL は startsWith 判定に一致しないため弾かれる)。
 */
const ALLOWED_NEXT_PREFIXES = ["/admin", "/edit"] as const;

export function isAllowedLoginNext(next: string): boolean {
  return ALLOWED_NEXT_PREFIXES.some((prefix) => next.startsWith(prefix));
}
