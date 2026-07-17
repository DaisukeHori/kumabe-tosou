import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/admin-redesign/移行設計.md §4 (P6 6c)・§6 / GitHub Issue #129。
 * admin/layout.tsx (Server Component) の縮退配線を検証する:
 *  - 集計成功時: NavBadgeCounts を href→件数 の record に写して AdminNav へ渡す
 *  - 集計失敗 (err/タイムアウト) 時: badgeCounts=undefined を渡す (バッジ非表示) が、
 *    シェル (ナビ/子) は通常描画される = レイアウトが壊れない
 *
 * AdminNav / Toaster / logoutAction / supabase server / headers / nav-badges facade を
 * すべてスタブに差し替え、実 DB・重い子コンポーネントには触れない
 * (admin-customers-page-search-bar.test.ts の relative import 差し替え手法を踏襲)。
 */

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (key: string) => (key === "x-pathname" ? "/admin" : null) }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1", email: "admin@example.com" } } }) },
  }),
}));

const getNavBadgeCountsMock = vi.fn();
vi.mock("@/modules/nav-badges/facade", () => ({
  navBadgesFacade: { getNavBadgeCounts: (...args: unknown[]) => getNavBadgeCountsMock(...args) },
}));

const adminNavMock = vi.fn();
vi.mock("@/app/admin/admin-nav", () => ({
  AdminNav: (props: unknown) => {
    adminNavMock(props);
    return createElement("nav", { "data-testid": "admin-nav-stub" });
  },
}));

vi.mock("@/components/ui/sonner", () => ({
  Toaster: () => createElement("div", { "data-testid": "toaster-stub" }),
}));

vi.mock("@/app/admin/actions", () => ({
  logoutAction: async () => {},
}));

import AdminLayout from "@/app/admin/layout";

function receivedBadgeCounts(): unknown {
  const call = adminNavMock.mock.calls.at(-1);
  return (call?.[0] as { badgeCounts?: unknown } | undefined)?.badgeCounts;
}

async function renderLayout(): Promise<string> {
  const element = await AdminLayout({ children: createElement("div", { "data-testid": "child" }) });
  return renderToStaticMarkup(element);
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("AdminLayout — ナビバッジ配線 (#129 R6c)", () => {
  it("集計成功時は href→件数 の record を AdminNav へ渡す", async () => {
    getNavBadgeCountsMock.mockResolvedValue({
      ok: true,
      value: { inquiries: 3, calls: 2, tasks: 1 },
    });

    const html = await renderLayout();

    expect(receivedBadgeCounts()).toEqual({
      "/admin/inquiries": 3,
      "/admin/calls": 2,
      "/admin/tasks": 1,
    });
    // シェルは通常描画される。
    expect(html).toContain('data-testid="admin-nav-stub"');
    expect(html).toContain('data-testid="child"');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("集計 err (KMB-E001) 時は badgeCounts=undefined で縮退し、シェルは壊れず描画される", async () => {
    getNavBadgeCountsMock.mockResolvedValue({ ok: false, code: "KMB-E001", detail: "db down" });

    const html = await renderLayout();

    expect(receivedBadgeCounts()).toBeUndefined();
    expect(html).toContain('data-testid="admin-nav-stub"');
    expect(html).toContain('data-testid="child"');
    // 縮退は握り潰さずログに残す。
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("集計タイムアウト (KMB-E002) 時も badgeCounts=undefined で縮退する", async () => {
    getNavBadgeCountsMock.mockResolvedValue({ ok: false, code: "KMB-E002", detail: "timeout" });

    const html = await renderLayout();

    expect(receivedBadgeCounts()).toBeUndefined();
    expect(html).toContain('data-testid="admin-nav-stub"');
  });

  it("facade が予期せず throw してもレイアウトは落ちず badgeCounts=undefined で縮退する", async () => {
    getNavBadgeCountsMock.mockRejectedValue(new Error("boom"));

    const html = await renderLayout();

    expect(receivedBadgeCounts()).toBeUndefined();
    expect(html).toContain('data-testid="admin-nav-stub"');
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
