"use server";

import { platformFacade } from "@/modules/platform/facade";
import type { Result } from "@/modules/platform/contracts";
import { crmFacade } from "@/modules/crm/facade";
import type { CustomerListItem, TimelineItem } from "@/modules/crm/contracts";

/**
 * 会社 Sheet (01-crm.md §8.2 末尾「会社 Sheet」) は独立ルートを持たず `/admin/customers`
 * (会社タブ) の行クリックで開く client Sheet のため、専用の取得 Server Action で
 * 会社プロフィール + 所属顧客一覧 (#44 で追加した listCustomersByCompany) + 簡易タイムラインを
 * まとめて返す。
 *
 * `getCompany` の戻り値型 (CompanyRow) は crm/repository.ts 所有で ESLint MODULES 境界により
 * admin UI から直接 import できない — facade の呼び出しシグネチャから `Awaited<ReturnType<...>>`
 * で導出することで repository への直 import を避ける (facade 経由の型解決のみで完結)。
 */
type CompanyGetResult = Awaited<ReturnType<typeof crmFacade.getCompany>>;
type CompanyData = Extract<CompanyGetResult, { ok: true }>["value"];

export type CompanySheetData = {
  company: CompanyData;
  customers: CustomerListItem[];
  customersNextCursor: string | null;
  timeline: TimelineItem[];
  timelineNextCursor: string | null;
};

export async function getCompanySheetDataAction(companyId: string): Promise<Result<CompanySheetData>> {
  const admin = await platformFacade.requireAdmin();
  if (!admin.ok) return { ok: false, code: admin.code, detail: admin.detail };

  const company = await crmFacade.getCompany(companyId);
  if (!company.ok) return company;

  const customers = await crmFacade.listCustomersByCompany(companyId, { cursor: null, limit: 50 });
  if (!customers.ok) return customers;

  const timeline = await crmFacade.listTimeline({ company_id: companyId }, { cursor: null, limit: 20 });
  if (!timeline.ok) return timeline;

  return {
    ok: true,
    value: {
      company: company.value,
      customers: customers.value.items,
      customersNextCursor: customers.value.next_cursor,
      timeline: timeline.value.items,
      timelineNextCursor: timeline.value.next_cursor,
    },
  };
}
