import type { Metadata } from "next";

import { PageHeader } from "@/app/admin/_ui";
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
    <div className="flex flex-col gap-6">
      <PageHeader
        title="新しい案件"
        backHref="/admin/deals"
        backLabel="← 案件一覧へ"
        description="わかるところだけ入れれば OK。金額や納期はあとから変えられます。"
      />
      <DealForm initialCustomer={initialCustomer} />
    </div>
  );
}
