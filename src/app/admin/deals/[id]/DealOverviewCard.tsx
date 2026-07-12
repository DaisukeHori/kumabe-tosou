"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Surface } from "@/app/admin/_ui";
import { EntityPicker, type EntityPickerItem } from "@/app/admin/_ui/entity-picker";
import { searchCompaniesAction } from "@/app/admin/_ui/entity-search-actions";
import { useSaveShortcut } from "@/app/admin/_ui/use-save-shortcut";
import { DEAL_STAGE_REGISTRY, type DealDetail, type DealUpdateInput } from "@/modules/crm/contracts";

import { updateDealAction } from "../actions";

const jpy = new Intl.NumberFormat("ja-JP");

/** 案件詳細ページの概要カード (01-crm.md §8.3): 金額・見込み%・期日・顧客・会社・流入元・失注理由 + 編集。 */
export function DealOverviewCard({ deal }: { deal: DealDetail }) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<DealUpdateInput>({
    title: deal.title,
    company_id: null,
    amount_jpy: deal.amount_jpy,
    expected_close_on: deal.expected_close_on,
    notes: deal.notes,
  });
  const [companyItem, setCompanyItem] = useState<EntityPickerItem | null>(
    deal.company_id && deal.company_name ? { id: deal.company_id, label: deal.company_name, sublabel: null } : null,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setIsSaving(true);
    setError(null);
    const result = await updateDealAction(deal.id, { ...form, company_id: companyItem?.id ?? null }, deal.updated_at);
    setIsSaving(false);
    if (!result.ok) {
      if (result.code === "KMB-E103") {
        setError("他の操作でこの案件が更新されています。再読み込みしてください。");
      } else {
        setError(result.detail ?? "保存に失敗しました。");
      }
      return;
    }
    toast.success("案件情報を保存しました。");
    setIsEditing(false);
    router.refresh();
  }

  useSaveShortcut(() => void handleSave(), isEditing);

  if (isEditing) {
    return (
      <Surface className="flex flex-col gap-3 p-4">
        {error && <p className="text-sm text-destructive">{error}</p>}
        <FieldGroup>
          <Field>
            <FieldLabel>案件名</FieldLabel>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel>会社 (任意)</FieldLabel>
            <EntityPicker value={companyItem} onChange={setCompanyItem} search={searchCompaniesAction} placeholder="会社を検索" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel>金額 (円)</FieldLabel>
              <Input
                type="number"
                min={0}
                value={form.amount_jpy ?? ""}
                onChange={(e) => setForm({ ...form, amount_jpy: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </Field>
            <Field>
              <FieldLabel>見込み完了日</FieldLabel>
              <DatePicker value={form.expected_close_on} onChange={(v) => setForm({ ...form, expected_close_on: v })} />
            </Field>
          </div>
          <Field>
            <FieldLabel>メモ</FieldLabel>
            <Textarea value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value || null })} />
          </Field>
        </FieldGroup>
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={isSaving} onClick={() => void handleSave()}>
            {isSaving ? "保存中..." : "保存 (Cmd+S)"}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
            キャンセル (Esc)
          </Button>
        </div>
      </Surface>
    );
  }

  return (
    <Surface className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{deal.title}</h2>
          <p className="text-sm text-muted-foreground">
            <Link href={`/admin/customers/${deal.customer_id}`} className="underline underline-offset-4">
              {deal.customer_name}
            </Link>
            {deal.company_name && <span> / {deal.company_name}</span>}
          </p>
        </div>
        <Badge variant="outline">見込み {DEAL_STAGE_REGISTRY[deal.stage].probability}%</Badge>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">金額</dt>
        <dd>{deal.amount_jpy !== null ? `¥${jpy.format(deal.amount_jpy)}` : "—"}</dd>
        <dt className="text-muted-foreground">見込み完了日</dt>
        <dd>{deal.expected_close_on ?? "—"}</dd>
        <dt className="text-muted-foreground">流入元</dt>
        <dd>{deal.source}</dd>
        {deal.stage === "lost" && deal.lost_reason && (
          <>
            <dt className="text-muted-foreground">失注理由</dt>
            <dd className="text-destructive">{deal.lost_reason}</dd>
          </>
        )}
      </dl>

      {deal.notes && <p className="whitespace-pre-wrap rounded-lg bg-muted/40 p-2.5 text-sm">{deal.notes}</p>}

      <div>
        <Button type="button" variant="outline" size="sm" onClick={() => setIsEditing(true)}>
          編集
        </Button>
      </div>
    </Surface>
  );
}
