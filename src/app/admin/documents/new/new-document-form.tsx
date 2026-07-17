"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { EntityPicker, type EntityPickerItem } from "@/app/admin/_ui/entity-picker";
import { searchDealsAction } from "@/app/admin/_ui/entity-search-actions";
import { useSaveShortcut } from "@/app/admin/_ui/use-save-shortcut";
import { zDocType, type DocType } from "@/modules/sales/contracts";

import { DOC_TYPE_LABEL, TAX_CATEGORY_LABEL } from "../_shared";
import { createDraftDocumentAction, getDealShippingDefaultsAction, type DealShippingDefaults } from "../actions";

const NATIVE_SELECT_CLASS = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

const TAX_CATEGORY_OPTIONS = ["standard_10", "reduced_8", "zero", "exempt"] as const;

/**
 * 帳票新規作成フォーム (§8.3 の簡易版)。zCreateDocumentInput は lines を 1 行以上要求するため、
 * ここで最初の 1 行を入力させる (本編集は作成後の /admin/documents/[id] の明細エディタで行う)。
 * 案件選択時に配送先 (shipping_info) から現場名/現場住所の初期値を、請求先 (billing_info) から宛名
 * プレビューを流し込む (§5.3)。現場名/現場住所を手編集済みの場合 (touched) は上書きしない。
 */
export function NewDocumentForm({
  initialDeal,
  initialShippingDefaults,
}: {
  initialDeal: EntityPickerItem | null;
  initialShippingDefaults: DealShippingDefaults | null;
}) {
  const router = useRouter();
  const [deal, setDeal] = useState<EntityPickerItem | null>(initialDeal);
  const [docType, setDocType] = useState<DocType>("quote");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("式");
  const [unitPrice, setUnitPrice] = useState("0");
  const [taxCategory, setTaxCategory] = useState<(typeof TAX_CATEGORY_OPTIONS)[number]>("standard_10");
  const [siteName, setSiteName] = useState(initialShippingDefaults?.site_name ?? "");
  const [siteAddress, setSiteAddress] = useState(initialShippingDefaults?.site_address ?? "");
  const [siteNameTouched, setSiteNameTouched] = useState(false);
  const [siteAddressTouched, setSiteAddressTouched] = useState(false);
  const [billingPreview, setBillingPreview] = useState<DealShippingDefaults["billing_preview"] | null>(
    initialShippingDefaults?.billing_preview ?? null,
  );
  const [notes, setNotes] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // レース対策: 案件を高速に切り替えると getDealShippingDefaultsAction の遅延応答が最新選択の
  // billingPreview / site_* を上書きし得る。郵便番号 lookup の firedPostal === current と同型に、
  // 発火ごとにシーケンス番号を採番して capture し、応答適用時に最新発火と一致する場合のみ反映する
  // (案件クリアも番号を進めるため、クリア後に古い応答が復活することもない)。
  const dealChangeSeqRef = useRef(0);

  async function handleDealChange(item: EntityPickerItem | null) {
    const seq = ++dealChangeSeqRef.current;
    setDeal(item);
    if (!item) {
      setBillingPreview(null);
      return;
    }
    const result = await getDealShippingDefaultsAction(item.id);
    // この応答が最新選択のものでなければ (別の案件へ切り替え済み / クリア済み) 反映しない。
    if (seq !== dealChangeSeqRef.current) return;
    if (!result.ok) {
      setBillingPreview(null);
      return;
    }
    setBillingPreview(result.value.billing_preview);
    // 未編集 (touched でない) の現場名/現場住所にのみ初期値を流し込む。
    if (!siteNameTouched) setSiteName(result.value.site_name ?? "");
    if (!siteAddressTouched) setSiteAddress(result.value.site_address ?? "");
  }

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
      site_address: siteAddress.trim() || null,
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
          <EntityPicker value={deal} onChange={(item) => void handleDealChange(item)} search={searchDealsAction} placeholder="案件を検索" />
          {billingPreview && (
            <p className="text-meta text-admin-text-meta">
              宛名: {billingPreview.name} {billingPreview.suffix}
              {billingPreview.address ? ` / ${billingPreview.address}` : ""}
            </p>
          )}
        </Field>

        <Field>
          <FieldLabel id="new-doc-type-label">種別</FieldLabel>
          <div role="group" aria-labelledby="new-doc-type-label" className="inline-flex flex-wrap items-center gap-1.5">
            {zDocType.options.map((t) => {
              const active = docType === t;
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setDocType(t)}
                  className={cn(
                    "inline-flex items-center rounded-full border px-3 py-1 text-table font-medium transition-colors",
                    active
                      ? "border-foreground bg-foreground text-background"
                      : "border-input bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {DOC_TYPE_LABEL[t]}
                </button>
              );
            })}
          </div>
        </Field>

        <Field>
          <FieldLabel htmlFor="new-doc-site-name">現場名 (任意)</FieldLabel>
          <Input
            id="new-doc-site-name"
            value={siteName}
            onChange={(e) => {
              setSiteNameTouched(true);
              setSiteName(e.target.value);
            }}
            maxLength={80}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="new-doc-site-address">現場住所 (任意)</FieldLabel>
          <Input
            id="new-doc-site-address"
            value={siteAddress}
            onChange={(e) => {
              setSiteAddressTouched(true);
              setSiteAddress(e.target.value);
            }}
            maxLength={200}
          />
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
