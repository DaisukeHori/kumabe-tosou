import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * canonical: GitHub Issue #99 敵対的レビュー (2回目) で発見された MAJOR バグの再発防止。
 *
 * customers-kanban.tsx のアーカイブ折りたたみ列バッジ件数が
 * `archivedColumn?.customers.length ?? 0` (repository 側で limit=20 に切り捨て済みの配列長) を
 * 使っており、主要列 (見込み/取引中) が使っている `total_count` (DB の exact count) と
 * 乖離していた。アーカイブが20件を超えると、バッジには実件数ではなく最大20が表示されてしまう。
 *
 * 修正: `count={archivedColumn?.total_count ?? 0}` に変更。本テストは customers 配列 (20件) と
 * total_count (37件、DB上の実件数を模す) をわざと乖離させ、バッジに 37 が表示されることを確認する。
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));
vi.mock("sonner", () => ({ toast: { error: () => {} } }));
vi.mock("@/app/admin/customers/actions", () => ({
  updateCustomerLifecycleAction: vi.fn(),
}));

import { CustomersKanban } from "@/app/admin/customers/customers-kanban";
import type { CustomerKanbanColumn, CustomerListItem } from "@/modules/crm/contracts";

function customer(id: string): CustomerListItem {
  return {
    id,
    kind: "person",
    name: `顧客${id}`,
    name_kana: null,
    email: null,
    tel_e164: null,
    company_name: null,
    lifecycle: "archived",
    source: "manual",
    open_deal_count: 0,
    created_at: "2026-07-11T00:00:00.000Z",
    updated_at: "2026-07-11T00:00:00.000Z",
  };
}

describe("CustomersKanban — アーカイブ列バッジ件数 (total_count 乖離防止)", () => {
  it("アーカイブ列の customers 配列 (limit 20 切り捨て後) より total_count (DB exact count) が多い場合、バッジは total_count を表示する", () => {
    const archivedCustomers = Array.from({ length: 20 }, (_, i) => customer(`archived-${i}`));
    const columns: CustomerKanbanColumn[] = [
      { lifecycle: "lead", total_count: 0, customers: [] },
      { lifecycle: "customer", total_count: 0, customers: [] },
      { lifecycle: "archived", total_count: 37, customers: archivedCustomers },
    ];

    const html = renderToStaticMarkup(createElement(CustomersKanban, { initialColumns: columns }));

    // customers.length (20) ではなく total_count (37) がバッジに表示されていること
    expect(html).toContain(">37<");
    expect(html).not.toContain(">20<");
  });
});
