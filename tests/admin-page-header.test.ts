import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PageHeader } from "@/app/admin/_ui/page-header";

/**
 * Issue #96 §A: PageHeader に backHref/backLabel を追加 (calls/[id]/page.tsx の手書き
 * `<Link href="/admin/calls">← 一覧へ</Link>` をこの共通 prop へ移行するための拡張)。
 * 純粋な Server Component (hook 不使用) のため createElement + renderToStaticMarkup で
 * 直接テストできる (tests/motion-home-split-chars.test.ts と同じ手法)。
 */
describe("PageHeader backHref", () => {
  it("backHref 未指定なら戻るリンクを出力しない (既存挙動の非退行)", () => {
    const html = renderToStaticMarkup(createElement(PageHeader, { title: "帳票" }));
    expect(html).toContain("帳票");
    expect(html).not.toContain("href=");
  });

  it("backHref 指定時は既定ラベル「← 一覧へ」でリンクを出力する", () => {
    const html = renderToStaticMarkup(createElement(PageHeader, { title: "案件詳細", backHref: "/admin/deals" }));
    expect(html).toContain('href="/admin/deals"');
    expect(html).toContain("← 一覧へ");
  });

  it("backLabel でラベルを上書きできる", () => {
    const html = renderToStaticMarkup(
      createElement(PageHeader, { title: "通話詳細", backHref: "/admin/calls", backLabel: "一覧へ戻る" }),
    );
    expect(html).toContain('href="/admin/calls"');
    expect(html).toContain("一覧へ戻る");
    expect(html).not.toContain("← 一覧へ");
  });

  it("backHref と actions を両方指定すると、戻るリンクが actions より先に (DOM 順で) 描画される", () => {
    const html = renderToStaticMarkup(
      createElement(PageHeader, {
        title: "案件詳細",
        backHref: "/admin/deals",
        actions: createElement("button", { key: "op" }, "操作"),
      }),
    );
    const backIndex = html.indexOf("← 一覧へ");
    const actionsIndex = html.indexOf("操作");
    expect(backIndex).toBeGreaterThan(-1);
    expect(actionsIndex).toBeGreaterThan(-1);
    expect(backIndex).toBeLessThan(actionsIndex);
  });
});
