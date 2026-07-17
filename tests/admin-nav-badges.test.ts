import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * canonical: docs/design/admin-redesign/移行設計.md §4 (P6 6c)・§6 / GitHub Issue #129。
 * AdminNav のバッジスロット表示を検証する:
 *  - badgeCounts の href に一致する項目へ実件数チップが出る
 *  - 0 件は非表示 (モック準拠)
 *  - badgeCounts=undefined (= 集計失敗の縮退) では 1 つもバッジが出ず、ナビ本体は通常描画
 *
 * .test.ts の都合上 JSX は使わず React.createElement を直接呼ぶ (admin-customers-page-*.test.ts
 * と同型)。usePathname を固定しクライアント遷移・localStorage 依存部 (useEffect) には触れない
 * (renderToStaticMarkup は初期展開状態 = 全グループ展開でレンダーする)。
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
}));

import { AdminNav } from "@/app/admin/admin-nav";

// NavLink の件数チップだけが持つ一意なクラス断片 (グループ見出しのアクティブドット
// `rounded-full bg-primary` とは異なり、`px-2 py-px` はバッジ span のみ)。
const BADGE_CLASS_FRAGMENT = "bg-primary px-2 py-px";

function countBadges(html: string): number {
  return html.split(BADGE_CLASS_FRAGMENT).length - 1;
}

describe("AdminNav — 未対応件数バッジ (#129 R6c)", () => {
  it("badgeCounts の件数が該当項目に表示され、0 件は非表示になる", () => {
    const html = renderToStaticMarkup(
      createElement(AdminNav, {
        badgeCounts: {
          "/admin/inquiries": 3,
          "/admin/calls": 2,
          "/admin/tasks": 0,
        },
      }),
    );

    // ナビ本体 (ラベル) は通常描画される。
    expect(html).toContain("問い合わせ");
    expect(html).toContain("通話");
    expect(html).toContain("やること");

    // 3 と 2 のチップは出て、0 件 (やること) は出ない → チップは 2 個。
    expect(countBadges(html)).toBe(2);
    expect(html).toContain(`${BADGE_CLASS_FRAGMENT} text-[11px] leading-none font-bold text-primary-foreground">3</span>`);
    expect(html).toContain(`${BADGE_CLASS_FRAGMENT} text-[11px] leading-none font-bold text-primary-foreground">2</span>`);
    expect(html).not.toContain(">0</span>");
  });

  it("単一の href だけ件数がある場合はその 1 個だけチップが出る", () => {
    const html = renderToStaticMarkup(
      createElement(AdminNav, { badgeCounts: { "/admin/inquiries": 5 } }),
    );
    expect(countBadges(html)).toBe(1);
    expect(html).toContain(">5</span>");
  });

  it("badgeCounts=undefined (集計失敗の縮退) ではバッジが 1 つも出ず、ナビは通常描画される", () => {
    const html = renderToStaticMarkup(createElement(AdminNav, {}));

    expect(countBadges(html)).toBe(0);
    // ナビ自体は壊れず全項目が描画される (縮退してもナビ機能は維持)。
    expect(html).toContain("問い合わせ");
    expect(html).toContain("通話");
    expect(html).toContain("やること");
    expect(html).toContain("今日の仕事");
  });
});
