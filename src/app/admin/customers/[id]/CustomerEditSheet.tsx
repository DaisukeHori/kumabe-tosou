"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { XIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { EntityPicker, type EntityPickerItem } from "@/app/admin/_ui/entity-picker";
import { searchCompaniesAction } from "@/app/admin/_ui/entity-search-actions";
import { useSaveShortcut } from "@/app/admin/_ui/use-save-shortcut";
import type { CustomerCustomField, CustomerDetail, CustomerLifecycle } from "@/modules/crm/contracts";

import { updateCustomerAction, type CustomerUpdateFormInput } from "../actions";

/**
 * 追加情報 (custom_fields) のクライアント側検証 (01-crm.md §5.2 zCustomerCustomFields のミラー)。
 * 両方空の行は自動 drop、片方のみ空の行とラベル重複は保存を中断してエラー表示する
 * (サーバー側 KMB-E101 と二重防御 — issue #98)。
 */
function collectCustomFields(
  rows: { label: string; value: string }[],
): { ok: true; value: CustomerCustomField[] } | { ok: false; error: string } {
  const collected: CustomerCustomField[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const label = row.label.trim();
    const value = row.value.trim();
    if (label === "" && value === "") continue;
    if (label === "" || value === "") {
      return { ok: false, error: "追加情報は項目名・値の両方を入力してください (空の行は削除してください)。" };
    }
    if (seen.has(label)) {
      return { ok: false, error: `項目名「${label}」が重複しています。` };
    }
    seen.add(label);
    collected.push({ label, value });
  }
  return { ok: true, value: collected };
}

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
    custom_fields: customer.custom_fields,
  });
  const [companyItem, setCompanyItem] = useState<EntityPickerItem | null>(
    customer.company_id && customer.company_name ? { id: customer.company_id, label: customer.company_name, sublabel: null } : null,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusNewFieldIndex, setFocusNewFieldIndex] = useState<number | null>(null);

  function addCustomField() {
    setFocusNewFieldIndex(form.custom_fields.length);
    setForm((f) => ({ ...f, custom_fields: [...f.custom_fields, { label: "", value: "" }] }));
  }
  function updateCustomField(index: number, patch: Partial<{ label: string; value: string }>) {
    setForm((f) => ({
      ...f,
      custom_fields: f.custom_fields.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  }
  function removeCustomField(index: number) {
    setForm((f) => ({ ...f, custom_fields: f.custom_fields.filter((_, i) => i !== index) }));
  }

  async function handleSave() {
    if (form.name.trim() === "") {
      setError("名前を入力してください。");
      return;
    }
    const customFields = collectCustomFields(form.custom_fields);
    if (!customFields.ok) {
      setError(customFields.error);
      return;
    }
    setIsSaving(true);
    setError(null);
    const result = await updateCustomerAction(
      customer.id,
      { ...form, custom_fields: customFields.value },
      customer.updated_at,
    );
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
            <Field>
              <div className="flex items-center justify-between">
                <FieldLabel>追加情報</FieldLabel>
                <Button type="button" variant="ghost" size="sm" onClick={addCustomField}>
                  + 項目を追加
                </Button>
              </div>
              <div className="flex flex-col gap-2">
                {form.custom_fields.length === 0 && (
                  <p className="text-xs text-muted-foreground">追加情報はまだありません。</p>
                )}
                {form.custom_fields.map((f, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      autoFocus={index === focusNewFieldIndex}
                      className="w-32 shrink-0 sm:w-40"
                      placeholder="項目名 (例: 外壁材質)"
                      value={f.label}
                      onChange={(e) => updateCustomField(index, { label: e.target.value })}
                      maxLength={30}
                    />
                    <Input
                      className="flex-1"
                      placeholder="値"
                      value={f.value}
                      onChange={(e) => updateCustomField(index, { value: e.target.value })}
                      maxLength={300}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="項目を削除"
                      onClick={() => removeCustomField(index)}
                    >
                      <XIcon />
                    </Button>
                  </div>
                ))}
              </div>
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
