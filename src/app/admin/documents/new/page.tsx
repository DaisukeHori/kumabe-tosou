import type { Metadata } from "next";

import { PageHeader, Surface } from "@/app/admin/_ui";
import { crmFacade } from "@/modules/crm/facade";
import { previewBillingFields, previewShippingDefaults } from "@/modules/sales/facade";

import { type DealShippingDefaults } from "../actions";
import { NewDocumentForm } from "./new-document-form";

export const metadata: Metadata = { title: "帳票の新規作成" };
export const dynamic = "force-dynamic";

/**
 * 帳票新規作成 (§8.3 の簡易版 — 実装計画書「成果物4」)。deal 選択 + doc_type 選択 + 明細 1 行の
 * 最小入力で draft を作成し、`/admin/documents/[id]` (明細エディタ本体) へ redirect する。
 * `?deal_id=` があれば案件詳細からの事前選択として使う (Issue #96 で配線完了: 案件詳細ページの
 * 帳票カード「新規帳票→」/ 受注成功トーストの「受注書を作成」action がこの受け皿へ遷移する)。
 */
export default async function NewDocumentPage({
  searchParams,
}: {
  searchParams: Promise<{ deal_id?: string }>;
}) {
  const { deal_id } = await searchParams;

  let initialDeal: { id: string; label: string; sublabel: string | null } | null = null;
  let initialShippingDefaults: DealShippingDefaults | null = null;
  if (deal_id) {
    const dealRef = await crmFacade.getDealRef(deal_id);
    if (dealRef.ok) {
      initialDeal = { id: dealRef.value.deal_id, label: dealRef.value.title, sublabel: dealRef.value.customer.name };
      // getDealShippingDefaultsAction は内部で getDealRef を再取得するため、ここで既に取得済みの
      // dealRef.value から純粋関数 (sales facade の named export) で直接合成し DB read を 1 回に抑える
      // (合成内容は getDealShippingDefaultsAction と同一 — app→facade 境界のみを使用)。
      const billing = previewBillingFields(dealRef.value);
      const shipping = previewShippingDefaults(dealRef.value);
      initialShippingDefaults = {
        site_name: shipping.site_name,
        site_address: shipping.site_address,
        billing_preview: { name: billing.billing_name, suffix: billing.billing_suffix, address: billing.billing_address },
      };
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="帳票の新規作成" description="案件・種別・最初の明細行を入力して下書きを作成します。" />
      <Surface className="max-w-2xl p-6">
        <NewDocumentForm initialDeal={initialDeal} initialShippingDefaults={initialShippingDefaults} />
      </Surface>
    </div>
  );
}
