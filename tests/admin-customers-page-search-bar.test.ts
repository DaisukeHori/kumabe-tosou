import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * canonical: GitHub Issue #99 敵対的レビュー(最終確認ラウンド)で発見された MAJOR バグの再発防止。
 *
 * src/app/admin/customers/page.tsx の検索バー表示条件が
 * `tab === "customers" && !isKanbanView` になっていたため、会社タブ (tab=companies) で
 * CustomersSearchBar が一切レンダリングされなくなっていた。companies-table.tsx 自体には
 * 検索欄が無く、会社検索 (`crmFacade.listCompanies({ q })`) の唯一のUI入力経路は
 * CustomersSearchBar の Input だったため、この変更で会社検索機能がUI上から消えていた。
 *
 * isKanbanView は `view === "kanban" && tab === "customers"` で既に tab === "customers" を
 * 含意するため、正しい条件は `!isKanbanView` のみ (tab の再チェックは不要かつ有害)。
 *
 * 実 DB や Sheet/Portal など重い子コンポーネントには触れず、CompaniesTable/CustomersTable/
 * CustomersKanban はスタブに差し替え、page.tsx の条件分岐 + 実 CustomersSearchBar の
 * レンダリング結果のみを検証する (tests/page-body-text-editmode.test.ts の手法を踏襲。
 * .test.ts の都合上 JSX は使わず React.createElement を直接呼ぶ)。
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

describe("AdminCustomersPage — 検索バー表示条件 (会社タブ退行防止)", () => {
  it("tab=companies で CustomersSearchBar (aria-label=顧客検索) が描画され、会社検索が実行される", async () => {
    const html = await renderPage({ tab: "companies" });

    expect(html).toContain('aria-label="顧客検索"');
    expect(html).toContain('data-testid="companies-table-stub"');
    expect(listCompaniesMock).toHaveBeenCalledTimes(1);
  });

  it("tab=companies かつ view=kanban でも CustomersSearchBar が描画される (companies タブにカンバンは無い)", async () => {
    const html = await renderPage({ tab: "companies", view: "kanban" });

    expect(html).toContain('aria-label="顧客検索"');
    expect(html).toContain('data-testid="companies-table-stub"');
    expect(listCustomersKanbanMock).not.toHaveBeenCalled();
  });

  it("tab=customers (テーブル表示・既定) でも CustomersSearchBar が描画される (非退行)", async () => {
    const html = await renderPage({});

    expect(html).toContain('aria-label="顧客検索"');
    expect(html).toContain('data-testid="customers-table-stub"');
  });

  it("tab=customers かつ view=kanban のときは CustomersSearchBar を描画しない (isKanbanView)", async () => {
    const html = await renderPage({ view: "kanban" });

    expect(html).not.toContain('aria-label="顧客検索"');
    expect(html).toContain('data-testid="customers-kanban-stub"');
  });
});
