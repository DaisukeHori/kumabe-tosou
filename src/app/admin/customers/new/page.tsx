import type { Metadata } from "next";

import { CustomerForm } from "../CustomerForm";

export const metadata: Metadata = { title: "顧客を新規作成" };
export const dynamic = "force-dynamic";

export default function NewCustomerPage() {
  return (
    <div className="p-6">
      <h1 className="mb-6 text-xl font-semibold">顧客を新規作成</h1>
      <CustomerForm />
    </div>
  );
}
