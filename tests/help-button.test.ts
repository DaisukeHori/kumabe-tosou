import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * docs/design/admin-help/README.md §2: PageHeader の右端に「?」を常設し、
 * ヘルプ slug が決まらないパスでは出さない。
 * usePathname は Client Component の hook なので、テストではモックで現在地を差し替える。
 */
const state = vi.hoisted(() => ({ pathname: "/admin" as string | null }));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
}));

const { PageHeader } = await import("@/app/admin/_ui/page-header");
const { HelpButton } = await import("@/app/admin/_ui/help-button");

afterEach(() => {
  state.pathname = "/admin";
});

describe("HelpButton", () => {
  it("admin のページでは ? ボタンを出す", () => {
    state.pathname = "/admin/customers/abc";
    const html = renderToStaticMarkup(createElement(HelpButton));
    expect(html).toContain('aria-label="このページの使い方"');
    expect(html).toContain(">?<");
  });

  it("slug が解決できないパスでは何も出さない", () => {
    state.pathname = "/admin/unknown-page";
    expect(renderToStaticMarkup(createElement(HelpButton))).toBe("");
    state.pathname = null;
    expect(renderToStaticMarkup(createElement(HelpButton))).toBe("");
  });

  it("pathname を props で渡すと現在地より優先される", () => {
    state.pathname = "/";
    const html = renderToStaticMarkup(createElement(HelpButton, { pathname: "/admin/deals" }));
    expect(html).toContain('aria-label="このページの使い方"');
  });
});

describe("PageHeader のヘルプボタン", () => {
  it("PageHeader に ? ボタンが出る", () => {
    state.pathname = "/admin/tasks";
    const html = renderToStaticMarkup(createElement(PageHeader, { title: "やること" }));
    expect(html).toContain('aria-label="このページの使い方"');
    expect(html).toContain("やること");
  });

  it("slug が決まらない画面では PageHeader にも ? を出さない", () => {
    state.pathname = "/admin/unknown-page";
    const html = renderToStaticMarkup(createElement(PageHeader, { title: "なにか" }));
    expect(html).not.toContain("このページの使い方");
  });

  it("showHelp={false} で個別に消せる", () => {
    state.pathname = "/admin";
    const html = renderToStaticMarkup(
      createElement(PageHeader, { title: "今日の仕事", showHelp: false }),
    );
    expect(html).not.toContain("このページの使い方");
  });
});
