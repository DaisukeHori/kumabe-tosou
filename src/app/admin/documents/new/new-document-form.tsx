"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EntityPicker, type EntityPickerItem } from "@/app/admin/_ui/entity-picker";
import { searchDealsAction } from "@/app/admin/_ui/entity-search-actions";
import { useSaveShortcut } from "@/app/admin/_ui/use-save-shortcut";
import { zDocType, type DocType } from "@/modules/sales/contracts";

import { TAX_CATEGORY_LABEL } from "../_shared";
import { createDraftDocumentAction } from "../actions";

const NATIVE_SELECT_CLASS = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

const TAX_CATEGORY_OPTIONS = ["standard_10", "reduced_8", "zero", "exempt"] as const;

/**
 * 帳票新規作成フォーム (§8.3 の簡易版)。zCreateDocumentInput は lines を 1 行以上要求するため、
 * ここで最初の 1 行を入力させる (本編集は作成後の /admin/documents/[id] の明細エディタで行う)。
 */
export function NewDocumentForm({ initialDeal }: { initialDeal: EntityPickerItem | null }) {
  const router = useRouter();
  const [deal, setDeal] = useState<EntityPickerItem | null>(initialDeal);
  const [docType, setDocType] = useState<DocType>("quote");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("式");
  const [unitPrice, setUnitPrice] = useState("0");
  const [taxCategory, setTaxCategory] = useState<(typeof TAX_CATEGORY_OPTIONS)[number]>("standard_10");
  const [siteName, setSiteName] = useState("");
  const [notes, setNotes] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!deal) {
      setError("案件を選択してください。");
      return;
    }
    if (description.trim().length === 0) {
      setError("品名を入力してください。");
      return;
    }
    const qty = Number(quantity);
    const price = Number(unitPrice);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("数量は正の数で入力してください。");
      return;
    }
    if (!Number.isFinite(price)) {
      setError("単価を数値で入力してください。");
      return;
    }

    setIsPending(true);
    setError(null);
    const result = await createDraftDocumentAction({
      doc_type: docType,
      deal_id: deal.id,
      issue_date: null,
      valid_until: null,
      site_name: siteName.trim() || null,
      site_address: null,
      notes: notes.trim() || null,
      lines: [
        {
          description: description.trim(),
          quantity: qty,
          unit: unit.trim() || "式",
          unit_price_jpy: Math.round(price),
          amount_jpy: Math.round(qty * price),
          tax_category: taxCategory,
          work_type_key: null,
          source: null,
        },
      ],
    });
    setIsPending(false);
    if (!result.ok) {
      setError(result.detail ?? "作成に失敗しました。");
      return;
    }
    toast.success("下書きを作成しました。");
    router.push(`/admin/documents/${result.value.document_id}`);
  }

  useSaveShortcut(() => void handleSubmit());

  return (
    <div className="space-y-6">
      <FieldGroup>
        <Field>
          <FieldLabel>案件</FieldLabel>
          <EntityPicker value={deal} onChange={setDeal} search={searchDealsAction} placeholder="案件を検索" />
        </Field>

        <Field>
          <FieldLabel htmlFor="doc-type">種別</FieldLabel>
          <select
            id="doc-type"
            className={NATIVE_SELECT_CLASS}
            value={docType}
            onChange={(e) => setDocType(e.target.value as DocType)}
          >
            {zDocType.options.map((t) => (
              <option key={t} value={t}>
                {{ quote: "見積", order: "受注", delivery: "納品", invoice: "請求" }[t]}
              </option>
            ))}
          </select>
        </Field>

        <Field>
          <FieldLabel htmlFor="new-doc-site-name">現場名 (任意)</FieldLabel>
          <Input id="new-doc-site-name" value={siteName} onChange={(e) => setSiteName(e.target.value)} maxLength={80} />
        </Field>

        <div className="rounded-lg border border-border p-3">
          <p className="mb-3 text-sm font-medium">最初の明細行</p>
          <div className="grid gap-3 sm:grid-cols-6">
            <Field className="sm:col-span-3">
              <FieldLabel htmlFor="new-doc-description">品名</FieldLabel>
              <Input id="new-doc-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-doc-quantity">数量</FieldLabel>
              <Input id="new-doc-quantity" type="number" step="0.01" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-doc-unit">単位</FieldLabel>
              <Input id="new-doc-unit" value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={10} />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-doc-unit-price">単価</FieldLabel>
              <Input id="new-doc-unit-price" type="number" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
            </Field>
            <Field className="sm:col-span-6">
              <FieldLabel htmlFor="new-doc-tax-category">税区分</FieldLabel>
              <select
                id="new-doc-tax-category"
                className={NATIVE_SELECT_CLASS}
                value={taxCategory}
                onChange={(e) => setTaxCategory(e.target.value as (typeof TAX_CATEGORY_OPTIONS)[number])}
              >
                {TAX_CATEGORY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {TAX_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        <Field>
          <FieldLabel htmlFor="new-doc-notes">備考 (任意)</FieldLabel>
          <Textarea id="new-doc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
        </Field>
      </FieldGroup>

      <FieldError errors={error ? [{ message: error }] : undefined} />
      <Button type="button" disabled={isPending} onClick={() => void handleSubmit()}>
        {isPending ? "作成中..." : "下書きを作成する (Cmd+S)"}
      </Button>
    </div>
  );
}
