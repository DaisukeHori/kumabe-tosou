import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: GitHub Issue #99 敵対的レビュー (2回目) で発見された MAJOR バグの再発防止。
 *
 * src/app/admin/customers/page.tsx の tabHref() が view パラメータを考慮していなかったため、
 * /admin/customers?view=kanban (顧客タブ + カンバン表示中) で既にアクティブな「顧客」タブピルを
 * クリックすると href が /admin/customers (view 落ち) になり、意図せずカンバンが閉じて
 * テーブル表示に戻ってしまっていた。
 *
 * 修正: tabHref("customers") は isKanbanView (= view === "kanban" && tab === "customers") のとき
 * view=kanban を維持する。会社タブへの遷移では view を保持しない (= Kanban を離脱するのが意図通り)。
 *
 * tests/admin-customers-page-search-bar.test.ts と同じレンダリングテストパターンを踏襲し、
 * CompaniesTable/CustomersTable/CustomersKanban はスタブに差し替えて page.tsx の href 生成のみを検証する。
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/customers",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

const listCustomersMock = vi.fn();
const listCompaniesMock = vi.fn();
const listCustomersKanbanMock = vi.fn();
vi.mock("@/modules/crm/facade", () => ({
  crmFacade: {
    listCustomers: (...args: unknown[]) => listCustomersMock(...args),
    listCompanies: (...args: unknown[]) => listCompaniesMock(...args),
    listCustomersKanban: (...args: unknown[]) => listCustomersKanbanMock(...args),
  },
}));

vi.mock("@/app/admin/customers/companies-table", () => ({
  CompaniesTable: () => createElement("div", { "data-testid": "companies-table-stub" }),
}));
vi.mock("@/app/admin/customers/customers-table", () => ({
  CustomersTable: () => createElement("div", { "data-testid": "customers-table-stub" }),
}));
vi.mock("@/app/admin/customers/customers-kanban", () => ({
  CustomersKanban: () => createElement("div", { "data-testid": "customers-kanban-stub" }),
}));

import AdminCustomersPage from "@/app/admin/customers/page";

const EMPTY_CUSTOMERS = { ok: true as const, value: { items: [], next_cursor: null } };
const EMPTY_COMPANIES = { ok: true as const, value: { items: [], next_cursor: null } };
const EMPTY_KANBAN = { ok: true as const, value: [] };

beforeEach(() => {
  vi.clearAllMocks();
  listCustomersMock.mockResolvedValue(EMPTY_CUSTOMERS);
  listCompaniesMock.mockResolvedValue(EMPTY_COMPANIES);
  listCustomersKanbanMock.mockResolvedValue(EMPTY_KANBAN);
});

async function renderPage(searchParams: {
  q?: string;
  lifecycle?: string;
  tab?: string;
  view?: string;
  cursor?: string;
}) {
  const element = await AdminCustomersPage({ searchParams: Promise.resolve(searchParams) });
  return renderToStaticMarkup(element);
}

/** html 中の「顧客」/「会社」タブピル (<a href="...">...</a>) の href を抜き出す。 */
function extractTabHref(html: string, label: "顧客" | "会社"): string | null {
  const match = html.match(new RegExp(`<a href="([^"]*)"[^>]*><span[^>]*>${label}</span></a>`));
  return match ? match[1] : null;
}

describe("AdminCustomersPage — tabHref の view=kanban 維持 (カンバン離脱防止)", () => {
  it("顧客タブ + カンバン表示中は「顧客」タブピルの href に view=kanban を維持する", async () => {
    const html = await renderPage({ view: "kanban" });

    const href = extractTabHref(html, "顧客");
    expect(href).not.toBeNull();
    const params = new URLSearchParams(href!.split("?")[1] ?? "");
    expect(params.get("view")).toBe("kanban");
  });

  it("顧客タブ + カンバン表示中に「会社」タブピルへ遷移する href は view を保持しない (Kanban 離脱が意図通り)", async () => {
    const html = await renderPage({ view: "kanban" });

    const href = extractTabHref(html, "会社");
    expect(href).not.toBeNull();
    const params = new URLSearchParams(href!.split("?")[1] ?? "");
    expect(params.get("view")).toBeNull();
    expect(params.get("tab")).toBe("companies");
  });

  it("顧客タブ + テーブル表示中 (view なし) は「顧客」タブピルの href に view を付与しない (非退行)", async () => {
    const html = await renderPage({});

    const href = extractTabHref(html, "顧客");
    expect(href).toBe("/admin/customers");
  });

  it("会社タブ表示中は「顧客」タブピルの href に view=kanban を付与しない (isKanbanView は tab=customers 限定)", async () => {
    const html = await renderPage({ tab: "companies" });

    const href = extractTabHref(html, "顧客");
    expect(href).not.toBeNull();
    const params = new URLSearchParams(href!.split("?")[1] ?? "");
    expect(params.get("view")).toBeNull();
  });
});
