"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Surface } from "@/app/admin/_ui";
import type { CustomerDetail } from "@/modules/crm/contracts";

import { CustomerDetailActions } from "./CustomerDetailActions";
import { CustomerEditSheet } from "./CustomerEditSheet";

const LIFECYCLE_LABEL: Record<CustomerDetail["lifecycle"], string> = {
  lead: "見込み",
  customer: "取引中",
  archived: "アーカイブ",
};
const KIND_LABEL: Record<CustomerDetail["kind"], string> = {
  person: "個人",
  company_contact: "法人担当者",
};

/**
 * 顧客詳細ページ左カラムの基本情報カード (01-crm.md §8.2)。マージ済み顧客
 * (merged_into_customer_id 非 NULL) の場合は編集操作を全て無効化する (§8.2 明記)。
 */
export function CustomerProfileCard({ customer }: { customer: CustomerDetail }) {
  const [editOpen, setEditOpen] = useState(false);
  const isMerged = customer.merged_into_customer_id !== null;

  return (
    <Surface className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{customer.name}</h2>
          {customer.name_kana && <p className="text-sm text-muted-foreground">{customer.name_kana}</p>}
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Badge variant={customer.lifecycle === "customer" ? "default" : "secondary"}>
            {LIFECYCLE_LABEL[customer.lifecycle]}
          </Badge>
        </div>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">種別</dt>
        <dd>{KIND_LABEL[customer.kind]}</dd>
        <dt className="text-muted-foreground">会社</dt>
        <dd>{customer.company_name ?? "—"}</dd>
        <dt className="text-muted-foreground">メール</dt>
        <dd>{customer.email ?? "—"}</dd>
        <dt className="text-muted-foreground">電話番号</dt>
        <dd>{customer.tel_e164 ?? "—"}</dd>
        <dt className="text-muted-foreground">住所</dt>
        <dd>{customer.address ?? "—"}</dd>
        <dt className="text-muted-foreground">流入元</dt>
        <dd>{customer.source}</dd>
        <dt className="text-muted-foreground">登録日</dt>
        <dd>{new Date(customer.created_at).toLocaleDateString("ja-JP")}</dd>
      </dl>

      {customer.notes && <p className="whitespace-pre-wrap rounded-lg bg-muted/40 p-2.5 text-sm">{customer.notes}</p>}

      {!isMerged && (
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            編集
          </Button>
          <CustomerDetailActions customer={customer} />
        </div>
      )}

      {!isMerged && <CustomerEditSheet customer={customer} open={editOpen} onOpenChange={setEditOpen} />}
    </Surface>
  );
}
