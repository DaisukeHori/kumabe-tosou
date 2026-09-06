import "server-only";

import { redirect } from "next/navigation";

import { platformFacade } from "@/modules/platform/facade";

/**
 * admin の Server Component (page.tsx / layout.tsx) 用の認可ゲート。
 * 契約書 §3.5 の「全 Action の先頭で requireAdmin()」を page 側にも適用する。
 *
 * - KMB-E201 (未認証) / KMB-E202 (認証済みだが admin ではない) は /admin/login へ redirect する
 *   (middleware は Cookie の有無しか見ないため、profiles に無いユーザーの E202 はここでしか弾けない)。
 * - KMB-E901 (認証基盤の一時障害) は redirect せず Result を返し、呼び出し側がエラー表示する。
 *
 * next/navigation の redirect() は throw で制御を移すため、ok の場合のみ戻り値が返る。
 */
export async function requireAdminPage(
  currentPath: string,
): Promise<{ ok: true; userId: string } | { ok: false; code: "KMB-E901"; detail?: string }> {
  const admin = await platformFacade.requireAdmin();
  if (admin.ok) return { ok: true, userId: admin.value.userId };
  if (admin.code === "KMB-E201" || admin.code === "KMB-E202") {
    redirect(buildLoginRedirect(currentPath, admin.code));
  }
  return { ok: false, code: "KMB-E901", detail: admin.detail };
}

/**
 * /admin/login への redirect 先 URL。E202 (非 admin) は `reason=forbidden` を付け、
 * ログインし直しても解決しないことをログイン画面側で説明できるようにする (純関数、テスト対象)。
 */
export function buildLoginRedirect(currentPath: string, code: "KMB-E201" | "KMB-E202"): string {
  const params = new URLSearchParams();
  if (currentPath && currentPath.startsWith("/admin") && currentPath !== "/admin/login") {
    params.set("next", currentPath);
  }
  if (code === "KMB-E202") params.set("reason", "forbidden");
  const qs = params.toString();
  return qs ? `/admin/login?${qs}` : "/admin/login";
}
