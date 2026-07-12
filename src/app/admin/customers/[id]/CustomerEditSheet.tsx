"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { EntityPicker, type EntityPickerItem } from "@/app/admin/_ui/entity-picker";
import { searchCompaniesAction } from "@/app/admin/_ui/entity-search-actions";
import { useSaveShortcut } from "@/app/admin/_ui/use-save-shortcut";
import type { CustomerDetail, CustomerLifecycle } from "@/modules/crm/contracts";

import { updateCustomerAction, type CustomerUpdateFormInput } from "../actions";

const LIFECYCLE_OPTIONS: { value: CustomerLifecycle; label: string }[] = [
  { value: "lead", label: "見込み" },
  { value: "customer", label: "取引中" },
  { value: "archived", label: "アーカイブ" },
];

/** 顧客詳細ページの編集 Sheet (01-crm.md §8.2)。zCustomerUpdateInput ベース。 */
export function CustomerEditSheet({
  customer,
  open,
  onOpenChange,
}: {
  customer: CustomerDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState<CustomerUpdateFormInput>({
    kind: customer.kind,
    name: customer.name,
    name_kana: customer.name_kana,
    email: customer.email,
    tel_raw: customer.tel_e164,
    company_id: customer.company_id,
    address: customer.address,
    notes: customer.notes,
    lifecycle: customer.lifecycle,
  });
  const [companyItem, setCompanyItem] = useState<EntityPickerItem | null>(
    customer.company_id && customer.company_name ? { id: customer.company_id, label: customer.company_name, sublabel: null } : null,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (form.name.trim() === "") {
      setError("名前を入力してください。");
      return;
    }
    setIsSaving(true);
    setError(null);
    const result = await updateCustomerAction(customer.id, form, customer.updated_at);
    setIsSaving(false);
    if (!result.ok) {
      if (result.code === "KMB-E103") {
        setError("他の操作でこの顧客が更新されています。ページを再読み込みしてください。");
      } else {
        setError(result.detail ?? "保存に失敗しました。");
      }
      return;
    }
    toast.success("顧客情報を保存しました。");
    onOpenChange(false);
    router.refresh();
  }

  useSaveShortcut(() => void handleSave(), open);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>顧客を編集</SheetTitle>
          <SheetDescription>Cmd+S で保存、Esc で閉じます。</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-4">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <FieldGroup>
            <Field>
              <FieldLabel>種別</FieldLabel>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={form.kind === "person" ? "default" : "outline"}
                  onClick={() => setForm({ ...form, kind: "person" })}
                >
                  個人
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={form.kind === "company_contact" ? "default" : "outline"}
                  onClick={() => setForm({ ...form, kind: "company_contact" })}
                >
                  法人担当者
                </Button>
              </div>
            </Field>
            <Field>
              <FieldLabel>名前</FieldLabel>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel>かな</FieldLabel>
              <Input value={form.name_kana ?? ""} onChange={(e) => setForm({ ...form, name_kana: e.target.value || null })} />
            </Field>
            <Field>
              <FieldLabel>メールアドレス</FieldLabel>
              <Input
                type="email"
                value={form.email ?? ""}
                onChange={(e) => setForm({ ...form, email: e.target.value || null })}
              />
            </Field>
            <Field>
              <FieldLabel>電話番号</FieldLabel>
              <Input value={form.tel_raw ?? ""} onChange={(e) => setForm({ ...form, tel_raw: e.target.value || null })} />
            </Field>
            {form.kind === "company_contact" && (
              <Field>
                <FieldLabel>会社</FieldLabel>
                <EntityPicker
                  value={companyItem}
                  onChange={(item) => {
                    setCompanyItem(item);
                    setForm({ ...form, company_id: item?.id ?? null });
                  }}
                  search={searchCompaniesAction}
                  placeholder="会社を検索"
                />
              </Field>
            )}
            <Field>
              <FieldLabel>住所</FieldLabel>
              <Input value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value || null })} />
            </Field>
            <Field>
              <FieldLabel>状態</FieldLabel>
              <select
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                value={form.lifecycle}
                onChange={(e) => setForm({ ...form, lifecycle: e.target.value as CustomerLifecycle })}
              >
                {LIFECYCLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field>
              <FieldLabel>メモ</FieldLabel>
              <Textarea value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value || null })} />
            </Field>
          </FieldGroup>
          <div className="flex gap-2">
            <Button type="button" disabled={isSaving} onClick={() => void handleSave()}>
              {isSaving ? "保存中..." : "保存 (Cmd+S)"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              キャンセル (Esc)
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
