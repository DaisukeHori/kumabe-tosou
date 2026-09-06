import { readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { HELP_SLUGS, HELP_SLUG_META, resolveHelpSlug } from "@/help/slugs";

/**
 * docs/design/admin-help/README.md §2: 「slug が解決できないパスではボタンを出さない
 * (テストで全 admin ページが解決できることを保証する)」。
 * src/app/admin を実際に走査し、page.tsx があるパスすべてで slug が決まることを確かめる。
 * 新しい管理画面を追加したら src/help/slugs.ts に 1 行足すまでこのテストが落ちる。
 */
const APP_DIR = path.resolve(import.meta.dirname, "../src/app");

function collectAdminRoutes(dir: string, segments: string[] = []): string[] {
  const routes: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // _lib / _ui などの非ルートディレクトリと、ルートグループ (…) は除外・素通し。
      if (entry.name.startsWith("_")) continue;
      const isRouteGroup = entry.name.startsWith("(") && entry.name.endsWith(")");
      routes.push(
        ...collectAdminRoutes(
          path.join(dir, entry.name),
          isRouteGroup ? segments : [...segments, entry.name],
        ),
      );
    } else if (entry.name === "page.tsx") {
      routes.push(`/${segments.join("/")}`);
    }
  }
  return routes;
}

/** [id] のような動的セグメントは、実際の URL に近い形へ置き換える。 */
function toConcretePath(route: string): string {
  return route.replace(/\[(?:\.\.\.)?([^\]]+)\]/g, "sample-id");
}

const adminRoutes = collectAdminRoutes(path.join(APP_DIR, "admin"), ["admin"]);

describe("resolveHelpSlug", () => {
  it("admin の page.tsx を 1 つ以上見つけられている (走査自体の健全性)", () => {
    expect(adminRoutes.length).toBeGreaterThan(20);
    expect(adminRoutes).toContain("/admin");
  });

  it.each(adminRoutes)("%s から slug を解決できる", (route) => {
    const slug = resolveHelpSlug(toConcretePath(route));
    expect(slug, `${route} に対応する slug が src/help/slugs.ts にありません`).not.toBeNull();
    expect(HELP_SLUGS).toContain(slug);
  });

  it("代表的なパスが期待どおりの slug になる", () => {
    expect(resolveHelpSlug("/admin")).toBe("dashboard");
    expect(resolveHelpSlug("/admin/")).toBe("dashboard");
    expect(resolveHelpSlug("/admin/customers/abc")).toBe("customers");
    expect(resolveHelpSlug("/admin/customers/new")).toBe("customers");
    expect(resolveHelpSlug("/admin/calendar")).toBe("calendar");
    expect(resolveHelpSlug("/admin/calendar/connections")).toBe("calendar-connections");
    expect(resolveHelpSlug("/admin/calendar/templates")).toBe("calendar-templates");
    expect(resolveHelpSlug("/admin/calendar/types")).toBe("calendar-types");
    expect(resolveHelpSlug("/admin/login")).toBe("login");
    expect(resolveHelpSlug("/admin/documents/xyz?tab=1")).toBe("documents");
  });

  it("admin 以外・未知のパスは null (ヘルプボタンを出さない)", () => {
    expect(resolveHelpSlug("/")).toBeNull();
    expect(resolveHelpSlug("/works")).toBeNull();
    expect(resolveHelpSlug("/edit/home")).toBeNull();
    expect(resolveHelpSlug("/admin/unknown-page")).toBeNull();
    expect(resolveHelpSlug("/admin/calendar/unknown")).toBeNull();
    expect(resolveHelpSlug(null)).toBeNull();
  });

  it("全 slug にタイトルと管理画面パスが定義されている", () => {
    for (const slug of HELP_SLUGS) {
      const meta = HELP_SLUG_META[slug];
      expect(meta.title.length).toBeGreaterThan(0);
      expect(meta.adminPath.startsWith("/admin")).toBe(true);
    }
    expect(Object.keys(HELP_SLUG_META).sort()).toEqual([...HELP_SLUGS].sort());
  });
});
