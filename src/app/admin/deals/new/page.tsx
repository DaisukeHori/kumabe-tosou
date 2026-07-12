import type { Metadata } from "next";

import { crmFacade } from "@/modules/crm/facade";
import type { EntityPickerItem } from "@/app/admin/_ui/entity-picker";

import { DealForm } from "../DealForm";

export const metadata: Metadata = { title: "案件を新規作成" };
export const dynamic = "force-dynamic";

export default async function NewDealPage({
  searchParams,
}: {
  searchParams: Promise<{ customer_id?: string }>;
}) {
  const { customer_id } = await searchParams;

  let initialCustomer: EntityPickerItem | null = null;
  if (customer_id) {
    const ref = await crmFacade.getCustomerRef(customer_id);
    if (ref.ok) {
      initialCustomer = { id: ref.value.customer_id, label: ref.value.name, sublabel: null };
    }
  }

  return (
    <div className="p-6">
      <h1 className="mb-6 text-xl font-semibold">案件を新規作成</h1>
      <DealForm initialCustomer={initialCustomer} />
    </div>
  );
}
