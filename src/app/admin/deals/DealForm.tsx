"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EntityPicker, type EntityPickerItem } from "@/app/admin/_ui/entity-picker";
import { searchCustomersAction } from "@/app/admin/_ui/entity-search-actions";
import { useSaveShortcut } from "@/app/admin/_ui/use-save-shortcut";
import { QuickCreateCustomerDialog } from "@/app/admin/customers/QuickCreateCustomerDialog";
import { zDealInput, type DealInput } from "@/modules/crm/contracts";

import { createDealAction } from "./actions";

const SOURCE_OPTIONS: { value: DealInput["source"]; label: string }[] = [
  { value: "manual", label: "手動" },
  { value: "form", label: "フォーム" },
  { value: "simulator", label: "シミュレーター" },
  { value: "phone", label: "電話" },
  { value: "migration", label: "移行" },
];

export function DealForm({ initialCustomer }: { initialCustomer: EntityPickerItem | null }) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [customerItem, setCustomerItem] = useState<EntityPickerItem | null>(initialCustomer);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<DealInput>({
    resolver: zodResolver(zDealInput),
    defaultValues: {
      title: "",
      customer_id: initialCustomer?.id ?? "",
      company_id: null,
      pipeline: "default",
      stage: "inquiry",
      amount_jpy: null,
      expected_close_on: null,
      source: "manual",
      notes: null,
    },
  });

  async function onSubmit(values: DealInput) {
    if (!customerItem) {
      setServerError("顧客を選択してください。");
      return;
    }
    setIsPending(true);
    setServerError(null);
    const result = await createDealAction({ ...values, customer_id: customerItem.id });
    setIsPending(false);
    if (!result.ok) {
      setServerError(result.detail ?? "作成に失敗しました。");
      return;
    }
    toast.success("案件を作成しました。");
    router.push(`/admin/deals/${result.value.deal_id}`);
  }

  useSaveShortcut(() => void handleSubmit(onSubmit)(), !quickCreateOpen);

  return (
    <div className="max-w-2xl space-y-6">
      {serverError && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {serverError}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
        <FieldGroup>
          <Field data-invalid={!!errors.title}>
            <FieldLabel htmlFor="deal-title">案件名</FieldLabel>
            <Input id="deal-title" aria-invalid={!!errors.title} {...register("title")} />
            <FieldError errors={errors.title ? [errors.title] : undefined} />
          </Field>

          <Field>
            <FieldLabel>顧客</FieldLabel>
            <EntityPicker
              value={customerItem}
              onChange={(item) => {
                setCustomerItem(item);
                setValue("customer_id", item?.id ?? "");
              }}
              search={searchCustomersAction}
              placeholder="顧客を検索"
              onCreate={() => setQuickCreateOpen(true)}
              createLabel="新しい顧客を作る"
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field data-invalid={!!errors.amount_jpy}>
              <FieldLabel htmlFor="deal-amount">金額 (円、任意)</FieldLabel>
              <Input
                id="deal-amount"
                type="number"
                min={0}
                {...register("amount_jpy", {
                  setValueAs: (v: string) => (v === "" ? null : Number(v)),
                })}
              />
              <FieldError errors={errors.amount_jpy ? [errors.amount_jpy] : undefined} />
            </Field>

            <Field>
              <FieldLabel>見込み完了日 (任意)</FieldLabel>
              <DatePicker
                value={watch("expected_close_on")}
                onChange={(v) => setValue("expected_close_on", v)}
                placeholder="日付を選択"
              />
            </Field>
          </div>

          <Field>
            <FieldLabel htmlFor="deal-source">流入元</FieldLabel>
            <select
              id="deal-source"
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
              {...register("source")}
            >
              {SOURCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          <Field>
            <FieldLabel htmlFor="deal-notes">メモ</FieldLabel>
            <Textarea id="deal-notes" {...register("notes", { setValueAs: (v: string) => (v === "" ? null : v) })} />
          </Field>
        </FieldGroup>

        <Button type="submit" disabled={isPending}>
          {isPending ? "作成中..." : "作成する (Cmd/Ctrl+S)"}
        </Button>
      </form>

      <QuickCreateCustomerDialog
        open={quickCreateOpen}
        onOpenChange={setQuickCreateOpen}
        initialName=""
        onCreated={(item) => {
          setCustomerItem(item);
          setValue("customer_id", item.id);
        }}
      />
    </div>
  );
}
