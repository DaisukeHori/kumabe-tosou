/**
 * ナビ現在地判定 — legacy/js/main.js:10-16 の data-page 比較の App Router 版。
 * href 配下のサブページ (/works/[slug] 等) も現在地として扱う。
 */
export function isCurrentPath(pathname: string, href: string): boolean {
  const path =
    pathname !== "/" && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  if (href === "/") return path === "/";
  return path === href || path.startsWith(`${href}/`);
}
