import type { Metadata } from "next";

import { PageHeader } from "@/app/admin/_ui";

import { CustomerForm } from "../CustomerForm";

export const metadata: Metadata = { title: "顧客を新規作成" };
export const dynamic = "force-dynamic";

export default function NewCustomerPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="顧客を新規作成" backHref="/admin/customers" />
      <CustomerForm />
    </div>
  );
}
