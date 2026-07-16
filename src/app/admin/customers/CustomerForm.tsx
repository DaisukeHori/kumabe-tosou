"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Surface } from "@/app/admin/_ui";
import { EntityPicker, type EntityPickerItem } from "@/app/admin/_ui/entity-picker";
import { searchCompaniesAction } from "@/app/admin/_ui/entity-search-actions";
import { useSaveShortcut } from "@/app/admin/_ui/use-save-shortcut";
import { zShortText } from "@/modules/platform/contracts";
import { zCustomerLifecycle, zLeadSource } from "@/modules/crm/contracts";

import { createCompanyAction, createCustomerAction, type CustomerFormInput } from "./actions";
import { parseDuplicateCandidates } from "./duplicate-candidates";

const zCustomerFormSchema = z
  .object({
    kind: z.enum(["person", "company_contact"]),
    name: zShortText(80),
    name_kana: z.string().max(120).nullable(),
    email: z.string().email().max(120).nullable(),
    tel_raw: z.string().max(20).nullable(),
    company_id: z.string().uuid().nullable(),
    address: z.string().max(200).nullable(),
    notes: z.string().max(5000).nullable(),
    lifecycle: zCustomerLifecycle,
    source: zLeadSource,
  })
  .strict()
  .refine((c) => c.email !== null || (c.tel_raw !== null && c.tel_raw.trim() !== "") || c.source === "manual", {
    message: "email か電話のどちらかが必要です (手動作成を除く)",
    path: ["email"],
  });

type CustomerFormValues = z.infer<typeof zCustomerFormSchema>;

const EMPTY_VALUES: CustomerFormValues = {
  kind: "person",
  name: "",
  name_kana: null,
  email: null,
  tel_raw: null,
  company_id: null,
  address: null,
  notes: null,
  lifecycle: "lead",
  source: "manual",
};

const LIFECYCLE_OPTIONS: { value: CustomerFormValues["lifecycle"]; label: string }[] = [
  { value: "lead", label: "見込み" },
  { value: "customer", label: "取引中" },
  { value: "archived", label: "アーカイブ" },
];
const SOURCE_OPTIONS: { value: CustomerFormValues["source"]; label: string }[] = [
  { value: "manual", label: "手動" },
  { value: "form", label: "フォーム" },
  { value: "simulator", label: "シミュレーター" },
  { value: "phone", label: "電話" },
  { value: "migration", label: "移行" },
];

function CreateCompanyDialog({
  open,
  onOpenChange,
  initialName,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialName: string;
  onCreated: (item: EntityPickerItem) => void;
}) {
  const [name, setName] = useState(initialName);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    if (name.trim() === "") {
      setError("会社名を入力してください。");
      return;
    }
    setIsSaving(true);
    setError(null);
    const result = await createCompanyAction({
      name: name.trim(),
      name_kana: null,
      tel_raw: null,
      address: null,
      notes: null,
    });
    setIsSaving(false);
    if (!result.ok) {
      setError(result.detail ?? "作成に失敗しました。");
      return;
    }
    toast.success("会社を作成しました。");
    onCreated({ id: result.value.company_id, label: name.trim(), sublabel: null });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新しい会社を作る</DialogTitle>
          <DialogDescription>会社名のみで作成できます。詳細は後から編集できます。</DialogDescription>
        </DialogHeader>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="会社名" autoFocus />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            キャンセル
          </Button>
          <Button type="button" disabled={isSaving} onClick={() => void handleCreate()}>
            {isSaving ? "作成中..." : "作成する"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CustomerForm() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [companyItem, setCompanyItem] = useState<EntityPickerItem | null>(null);
  const [createCompanyOpen, setCreateCompanyOpen] = useState(false);
  const [duplicateCandidates, setDuplicateCandidates] = useState<{ id: string; name: string }[] | null>(null);
  const [pendingValues, setPendingValues] = useState<CustomerFormValues | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CustomerFormValues>({ resolver: zodResolver(zCustomerFormSchema), defaultValues: EMPTY_VALUES });

  const kind = watch("kind");

  async function submitCustomer(values: CustomerFormValues, force: boolean) {
    setIsPending(true);
    setServerError(null);
    const input: CustomerFormInput = {
      kind: values.kind,
      name: values.name,
      name_kana: values.name_kana,
      email: values.email,
      tel_raw: values.tel_raw,
      company_id: values.company_id,
      address: values.address,
      notes: values.notes,
      lifecycle: values.lifecycle,
      source: values.source,
    };
    const result = await createCustomerAction(input, force);
    setIsPending(false);
    if (!result.ok) {
      if (result.code === "KMB-E601") {
        setDuplicateCandidates(parseDuplicateCandidates(result.detail));
        setPendingValues(values);
        return;
      }
      setServerError(result.detail ?? "作成に失敗しました。");
      return;
    }
    toast.success("顧客を作成しました。");
    router.push(`/admin/customers/${result.value.customer_id}`);
  }

  function onSubmit(values: CustomerFormValues) {
    void submitCustomer(values, false);
  }

  useSaveShortcut(() => void handleSubmit(onSubmit)(), true);

  return (
    <div className="max-w-2xl space-y-6">
      {serverError && (
        <div
          role="alert"
          className="rounded-lg border border-status-danger-border bg-status-urgent-bg px-4 py-3 text-label text-status-urgent-fg"
        >
          {serverError}
        </div>
      )}

      <Surface className="p-5">
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
        <FieldGroup>
          <Field>
            <FieldLabel>種別</FieldLabel>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={kind === "person" ? "default" : "outline"}
                size="sm"
                onClick={() => setValue("kind", "person")}
              >
                個人
              </Button>
              <Button
                type="button"
                variant={kind === "company_contact" ? "default" : "outline"}
                size="sm"
                onClick={() => setValue("kind", "company_contact")}
              >
                法人担当者
              </Button>
            </div>
          </Field>

          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="customer-name">名前</FieldLabel>
            <Input id="customer-name" aria-invalid={!!errors.name} {...register("name")} />
            <FieldError errors={errors.name ? [errors.name] : undefined} />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="customer-kana">かな</FieldLabel>
              <Input
                id="customer-kana"
                {...register("name_kana", { setValueAs: (v: string) => (v === "" ? null : v) })}
              />
            </Field>
            <Field data-invalid={!!errors.email}>
              <FieldLabel htmlFor="customer-email">メールアドレス</FieldLabel>
              <Input
                id="customer-email"
                type="email"
                aria-invalid={!!errors.email}
                {...register("email", { setValueAs: (v: string) => (v === "" ? null : v) })}
              />
              <FieldError errors={errors.email ? [errors.email] : undefined} />
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="customer-tel">電話番号</FieldLabel>
              <Input
                id="customer-tel"
                placeholder="090-1234-5678"
                {...register("tel_raw", { setValueAs: (v: string) => (v === "" ? null : v) })}
              />
              <FieldDescription>ハイフンありなし・国内表記どちらでも構いません</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="customer-source">流入元</FieldLabel>
              <select
                id="customer-source"
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-control"
                {...register("source")}
              >
                {SOURCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {kind === "company_contact" && (
            <Field>
              <FieldLabel>会社</FieldLabel>
              <EntityPicker
                value={companyItem}
                onChange={(item) => {
                  setCompanyItem(item);
                  setValue("company_id", item?.id ?? null);
                }}
                search={searchCompaniesAction}
                placeholder="会社を検索"
                onCreate={() => setCreateCompanyOpen(true)}
                createLabel="新しい会社を作る"
              />
            </Field>
          )}

          <Field>
            <FieldLabel htmlFor="customer-address">住所</FieldLabel>
            <Input
              id="customer-address"
              {...register("address", { setValueAs: (v: string) => (v === "" ? null : v) })}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="customer-lifecycle">状態</FieldLabel>
            <select
              id="customer-lifecycle"
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-control"
              {...register("lifecycle")}
            >
              {LIFECYCLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          <Field>
            <FieldLabel htmlFor="customer-notes">メモ</FieldLabel>
            <Textarea id="customer-notes" {...register("notes", { setValueAs: (v: string) => (v === "" ? null : v) })} />
          </Field>
        </FieldGroup>

        <Button type="submit" disabled={isPending}>
          {isPending ? "作成中..." : "作成する (Cmd/Ctrl+S)"}
        </Button>
        </form>
      </Surface>

      <CreateCompanyDialog
        open={createCompanyOpen}
        onOpenChange={setCreateCompanyOpen}
        initialName=""
        onCreated={(item) => {
          setCompanyItem(item);
          setValue("company_id", item.id);
        }}
      />

      <Dialog open={!!duplicateCandidates} onOpenChange={(open) => !open && setDuplicateCandidates(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>似ている顧客がいます</DialogTitle>
            <DialogDescription>
              email/電話が一致する既存の顧客が見つかりました。既存を開くか、それでも新規作成してください。
            </DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col divide-y divide-admin-divider rounded-lg border border-border">
            {duplicateCandidates?.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-label">
                <span className="truncate">{c.name}</span>
                <span className="flex shrink-0 gap-1.5">
                  <Button type="button" size="sm" variant="outline" onClick={() => router.push(`/admin/customers/${c.id}`)}>
                    開く
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      toast.info("新規作成を中止しました。この顧客のページから重複統合を行えます。");
                      router.push(`/admin/customers/${c.id}`);
                    }}
                  >
                    この顧客に統合
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDuplicateCandidates(null)}>
              編集に戻る (Esc)
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isPending}
              onClick={() => {
                if (pendingValues) void submitCustomer(pendingValues, true);
                setDuplicateCandidates(null);
              }}
            >
              それでも新規作成する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
