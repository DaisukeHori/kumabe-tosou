import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * admin の Server Component 用認可ゲート (src/app/admin/_lib/require-admin-page.ts)。
 * /admin/{works,posts,voices} の各 page.tsx と admin layout.tsx が使う。
 * next/navigation の redirect() は throw で制御を移すため、フェイクで throw させて検証する。
 */

class RedirectSignal extends Error {
  constructor(public readonly url: string) {
    super(`NEXT_REDIRECT ${url}`);
  }
}
const redirectMock = vi.fn((url: string) => {
  throw new RedirectSignal(url);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

const requireAdminMock = vi.fn();
vi.mock("@/modules/platform/facade", () => ({
  platformFacade: { requireAdmin: (...args: unknown[]) => requireAdminMock(...args) },
}));

import { buildLoginRedirect, requireAdminPage } from "@/app/admin/_lib/require-admin-page";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildLoginRedirect", () => {
  it("E201 は next 付きで /admin/login へ", () => {
    expect(buildLoginRedirect("/admin/works", "KMB-E201")).toBe("/admin/login?next=%2Fadmin%2Fworks");
  });

  it("E202 (非 admin) は reason=forbidden を付ける", () => {
    expect(buildLoginRedirect("/admin/posts/new", "KMB-E202")).toBe(
      "/admin/login?next=%2Fadmin%2Fposts%2Fnew&reason=forbidden",
    );
  });

  it("/admin/login 自身や admin 外のパスは next に載せない (ループ / オープンリダイレクト防止)", () => {
    expect(buildLoginRedirect("/admin/login", "KMB-E201")).toBe("/admin/login");
    expect(buildLoginRedirect("https://evil.example/", "KMB-E201")).toBe("/admin/login");
    expect(buildLoginRedirect("", "KMB-E202")).toBe("/admin/login?reason=forbidden");
  });
});

describe("requireAdminPage", () => {
  it("admin なら ok と userId を返し redirect しない", async () => {
    requireAdminMock.mockResolvedValue({ ok: true, value: { userId: "admin-1" } });

    await expect(requireAdminPage("/admin/works")).resolves.toEqual({ ok: true, userId: "admin-1" });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("KMB-E202 (認証済みだが非 admin) は /admin/login?...reason=forbidden へ redirect する", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, code: "KMB-E202" });

    await expect(requireAdminPage("/admin/voices")).rejects.toBeInstanceOf(RedirectSignal);
    expect(redirectMock).toHaveBeenCalledWith("/admin/login?next=%2Fadmin%2Fvoices&reason=forbidden");
  });

  it("KMB-E201 (未認証) は next 付きで /admin/login へ redirect する", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, code: "KMB-E201" });

    await expect(requireAdminPage("/admin/posts")).rejects.toBeInstanceOf(RedirectSignal);
    expect(redirectMock).toHaveBeenCalledWith("/admin/login?next=%2Fadmin%2Fposts");
  });

  it("KMB-E901 (認証基盤の一時障害) は redirect せず ok:false を返す (page 側でエラー表示)", async () => {
    requireAdminMock.mockResolvedValue({ ok: false, code: "KMB-E901", detail: "auth down" });

    await expect(requireAdminPage("/admin/works")).resolves.toEqual({
      ok: false,
      code: "KMB-E901",
      detail: "auth down",
    });
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
