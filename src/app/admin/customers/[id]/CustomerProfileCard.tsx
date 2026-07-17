"use client";

import { Fragment, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Surface, formatJstDate } from "@/app/admin/_ui";
import type { CustomerAddressBlock, CustomerDetail } from "@/modules/crm/contracts";

import { CustomerDetailActions } from "./CustomerDetailActions";
import { CustomerEditSheet } from "./CustomerEditSheet";

/** 請求先/配送先ブロックの表示行 (null ブロックは呼び出し側で行ごと非表示)。郵便番号は "xxx-xxxx" 整形。 */
function addressBlockLines(block: CustomerAddressBlock): string {
  const lines: string[] = [];
  if (block.name) lines.push(block.suffix ? `${block.name} ${block.suffix}` : block.name);
  const postal = block.postal_code ? `〒${block.postal_code.slice(0, 3)}-${block.postal_code.slice(3)}` : "";
  if (block.address) lines.push(postal ? `${postal} ${block.address}` : block.address);
  else if (postal) lines.push(postal);
  if (block.tel_e164) lines.push(block.tel_e164);
  return lines.join("\n");
}

const LIFECYCLE_LABEL: Record<CustomerDetail["lifecycle"], string> = {
  lead: "見込み",
  customer: "取引中",
  archived: "アーカイブ",
};
// [#121 R3b] customers-table.tsx と同じ R0 ステータス 5 系統への対応で色を統一する。
function lifecycleBadgeVariant(lifecycle: CustomerDetail["lifecycle"]): "success" | "info" | "neutral" {
  if (lifecycle === "customer") return "success";
  if (lifecycle === "archived") return "neutral";
  return "info";
}
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
          <h2 className="text-section text-foreground">{customer.name}</h2>
          {customer.name_kana && <p className="text-meta text-admin-text-meta">{customer.name_kana}</p>}
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Badge variant={lifecycleBadgeVariant(customer.lifecycle)}>
            {LIFECYCLE_LABEL[customer.lifecycle]}
          </Badge>
        </div>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-label">
        <dt className="text-admin-text-label">種別</dt>
        <dd className="text-foreground">{KIND_LABEL[customer.kind]}</dd>
        <dt className="text-admin-text-label">会社</dt>
        <dd className="text-foreground">{customer.company_name ?? "—"}</dd>
        <dt className="text-admin-text-label">メール</dt>
        <dd className="text-foreground">{customer.email ?? "—"}</dd>
        <dt className="text-admin-text-label">電話番号</dt>
        <dd className="text-foreground">{customer.tel_e164 ?? "—"}</dd>
        <dt className="text-admin-text-label">住所</dt>
        <dd className="text-foreground">{customer.address ?? "—"}</dd>
        {customer.billing_info && (
          <>
            <dt className="text-admin-text-label">請求先</dt>
            <dd className="whitespace-pre-wrap break-words text-foreground">{addressBlockLines(customer.billing_info)}</dd>
          </>
        )}
        {customer.shipping_info && (
          <>
            <dt className="text-admin-text-label">配送先</dt>
            <dd className="whitespace-pre-wrap break-words text-foreground">{addressBlockLines(customer.shipping_info)}</dd>
          </>
        )}
        {customer.custom_fields.map((f) => (
          <Fragment key={f.label}>
            <dt className="text-admin-text-label">{f.label}</dt>
            <dd className="break-words text-foreground">{f.value}</dd>
          </Fragment>
        ))}
        <dt className="text-admin-text-label">流入元</dt>
        <dd className="text-foreground">{customer.source}</dd>
        <dt className="text-admin-text-label">登録日</dt>
        <dd className="text-foreground">{formatJstDate(customer.created_at)}</dd>
      </dl>

      {customer.notes && (
        <p className="whitespace-pre-wrap rounded-lg bg-muted p-3 text-label text-foreground">{customer.notes}</p>
      )}

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
