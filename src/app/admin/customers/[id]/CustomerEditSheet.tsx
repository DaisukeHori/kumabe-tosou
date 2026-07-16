"use client";

import { useEffect, useRef, useState } from "react";
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
import type {
  CustomerAddressBlock,
  CustomerCustomField,
  CustomerDetail,
  CustomerLifecycle,
} from "@/modules/crm/contracts";

import {
  lookupPostalAddressAction,
  updateCustomerAction,
  type AddressBlockFormInput,
  type CustomerUpdateFormInput,
} from "../actions";

/** zCustomerCustomFields (crm/contracts.ts) の max(50) と同期する上限値。 */
export const CUSTOM_FIELDS_MAX = 50;

const NATIVE_SELECT_CLASS = "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm";

const EMPTY_ADDRESS_BLOCK: AddressBlockFormInput = {
  postal_code: null,
  address: null,
  tel_raw: null,
  name: null,
  suffix: null,
};

/**
 * 追加情報 (custom_fields) のクライアント側検証 (01-crm.md §5.2 zCustomerCustomFields のミラー)。
 * 両方空の行は自動 drop、片方のみ空の行・ラベル重複・51件以上は保存を中断してエラー表示する
 * (サーバー側 KMB-E101 と二重防御 — issue #98)。51件超過時はサーバーの生 Zod エラー
 * (英語 JSON) をユーザーに見せないための一次防御 (敵対的レビュー指摘の是正)。
 */
export function collectCustomFields(
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
  if (collected.length > CUSTOM_FIELDS_MAX) {
    return { ok: false, error: "項目が多すぎます。不要な行を削除してください。" };
  }
  return { ok: true, value: collected };
}

/** 郵便番号の client 側正規化 (platform/text.ts normalizePostalCode7 のミラー — twitter-text 依存を
 *  クライアントバンドルに持ち込まないため同ロジックをローカルに複製)。NFKC → 数字以外除去 → 7 桁なら返す。 */
function normalizePostalClient(input: string): string | null {
  const digits = input.normalize("NFKC").replace(/[^0-9]/g, "");
  return /^\d{7}$/.test(digits) ? digits : null;
}

/**
 * 請求先/配送先ブロックのクライアント側検証 (01-crm.md §8.2 のミラー — サーバー側
 * normalizeAddressBlock と二重防御)。全フィールド空 → null、郵便番号が非空かつ正規化後 7 桁で
 * ない → 保存中断、それ以外の部分入力 (名前だけ等) は許容し trim 済みの値を返す。
 */
export function collectAddressBlock(
  block: AddressBlockFormInput | null,
): { ok: true; value: AddressBlockFormInput | null } | { ok: false; error: string } {
  if (block === null) return { ok: true, value: null };

  const name = block.name?.trim() ? block.name.trim() : null;
  const address = block.address?.trim() ? block.address.trim() : null;
  const tel_raw = block.tel_raw?.trim() ? block.tel_raw.trim() : null;
  const suffix = block.suffix ?? null;

  const postalRaw = block.postal_code?.trim() ?? "";
  let postal_code: string | null;
  if (postalRaw === "") {
    postal_code = null;
  } else {
    const normalized = normalizePostalClient(postalRaw);
    if (normalized === null) return { ok: false, error: "郵便番号は7桁の数字で入力してください。" };
    postal_code = normalized;
  }

  if (name === null && address === null && tel_raw === null && suffix === null && postal_code === null) {
    return { ok: true, value: null };
  }
  return { ok: true, value: { postal_code, address, tel_raw, name, suffix } };
}

function toFormBlock(b: CustomerAddressBlock | null): AddressBlockFormInput | null {
  if (b === null) return null;
  return { postal_code: b.postal_code, address: b.address, tel_raw: b.tel_e164, name: b.name, suffix: b.suffix };
}

const LIFECYCLE_OPTIONS: { value: CustomerLifecycle; label: string }[] = [
  { value: "lead", label: "見込み" },
  { value: "customer", label: "取引中" },
  { value: "archived", label: "アーカイブ" },
];

/**
 * 請求先/配送先セクション (01-crm.md §8.2)。郵便番号自動補完 (debounce 500ms・レース対策・
 * 失敗時は degrade して手入力継続)、基本情報コピー (名前/住所/電話番号のみ・郵便番号/敬称は対象外)。
 */
function AddressBlockSection({
  title,
  block,
  onChange,
  showSuffix,
  basic,
}: {
  title: string;
  block: AddressBlockFormInput | null;
  onChange: (next: AddressBlockFormInput | null) => void;
  showSuffix: boolean;
  basic: { name: string; address: string | null; tel_raw: string | null };
}) {
  const b = block ?? EMPTY_ADDRESS_BLOCK;
  const [lookupPending, setLookupPending] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addressInputRef = useRef<HTMLInputElement | null>(null);

  // 非同期応答適用時のレース対策・stale closure 回避のため、常に最新値を ref に保持する。
  const blockRef = useRef<AddressBlockFormInput>(b);
  blockRef.current = b;

  // アンマウント時に未発火の debounce をクリアし、アンマウント後の setState 警告を防ぐ。
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function patch(p: Partial<AddressBlockFormInput>) {
    onChange({ ...blockRef.current, ...p });
  }

  async function runLookup(firedPostal: string, force: boolean) {
    const normalized = normalizePostalClient(firedPostal);
    if (normalized === null) return;
    setLookupPending(true);
    setLookupError(null);
    const result = await lookupPostalAddressAction(normalized);
    setLookupPending(false);
    // レース対策: 発火時の郵便番号が現在値と一致する場合のみ反映する (7桁入力→即修正の取り違え防止)。
    if ((blockRef.current.postal_code ?? "") !== firedPostal) return;
    if (!result.ok) {
      setLookupError("住所を自動入力できませんでした。手入力してください");
      return;
    }
    // 自動発火 (force=false) は住所欄が空のときのみ上書きする。「住所検索」ボタン (force=true) は常に上書き。
    if (!force && (blockRef.current.address ?? "").trim() !== "") return;
    onChange({ ...blockRef.current, address: result.value.address });
    addressInputRef.current?.focus();
  }

  function onPostalChange(v: string) {
    patch({ postal_code: v || null });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const normalized = normalizePostalClient(v);
    const addressEmpty = (blockRef.current.address ?? "").trim() === "";
    // 正規化後 7 桁到達の瞬間、かつ住所欄が空のときのみ debounce 発火。
    if (normalized !== null && addressEmpty) {
      debounceRef.current = setTimeout(() => {
        void runLookup(v, false);
      }, 500);
    }
  }

  function copyFromBasic() {
    const over = basic.address !== null && basic.address.length > 190;
    const address = over ? basic.address!.slice(0, 190) : basic.address;
    // postal_code / suffix は対象外 (前者は基本情報に該当項目なし・後者は敬称概念なし)。
    onChange({ ...blockRef.current, name: basic.name.trim() || null, address, tel_raw: basic.tel_raw ?? null });
    setCopyNote(over ? "住所が190文字を超えるため190文字で切り詰めてコピーしました。" : null);
  }

  return (
    <Field>
      <div className="flex items-center justify-between">
        <FieldLabel>{title}</FieldLabel>
        <Button type="button" variant="ghost" size="sm" onClick={copyFromBasic}>
          基本情報と同じ内容をコピー
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        コピーは名前・住所・電話番号のみ (郵便番号・敬称は対象外)。
      </p>
      {copyNote && <p className="text-xs text-muted-foreground">{copyNote}</p>}

      <div className="flex flex-col gap-2">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <FieldLabel className="text-xs text-muted-foreground">名前</FieldLabel>
            <Input
              value={b.name ?? ""}
              onChange={(e) => patch({ name: e.target.value || null })}
              maxLength={80}
            />
          </div>
          {showSuffix && (
            <div className="w-24 shrink-0">
              <FieldLabel className="text-xs text-muted-foreground">敬称</FieldLabel>
              <select
                className={NATIVE_SELECT_CLASS}
                value={b.suffix ?? ""}
                onChange={(e) => patch({ suffix: (e.target.value || null) as "様" | "御中" | null })}
              >
                <option value="">自動</option>
                <option value="様">様</option>
                <option value="御中">御中</option>
              </select>
            </div>
          )}
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <FieldLabel className="text-xs text-muted-foreground">郵便番号</FieldLabel>
            <Input
              value={b.postal_code ?? ""}
              onChange={(e) => onPostalChange(e.target.value)}
              placeholder="例: 8600801"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={lookupPending || normalizePostalClient(b.postal_code ?? "") === null}
            onClick={() => void runLookup(b.postal_code ?? "", true)}
          >
            {lookupPending ? "検索中..." : "住所検索"}
          </Button>
        </div>

        <div>
          <FieldLabel className="text-xs text-muted-foreground">住所</FieldLabel>
          <Input
            ref={addressInputRef}
            value={b.address ?? ""}
            onChange={(e) => patch({ address: e.target.value || null })}
            maxLength={190}
          />
          {lookupError && <p className="mt-1 text-xs text-muted-foreground">{lookupError}</p>}
        </div>

        <div>
          <FieldLabel className="text-xs text-muted-foreground">電話番号</FieldLabel>
          <Input value={b.tel_raw ?? ""} onChange={(e) => patch({ tel_raw: e.target.value || null })} />
        </div>
      </div>
    </Field>
  );
}

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
    billing_info: toFormBlock(customer.billing_info),
    shipping_info: toFormBlock(customer.shipping_info),
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
    const billing = collectAddressBlock(form.billing_info);
    if (!billing.ok) {
      setError(`請求先: ${billing.error}`);
      return;
    }
    const shipping = collectAddressBlock(form.shipping_info);
    if (!shipping.ok) {
      setError(`配送先: ${shipping.error}`);
      return;
    }
    setIsSaving(true);
    setError(null);
    const result = await updateCustomerAction(
      customer.id,
      { ...form, custom_fields: customFields.value, billing_info: billing.value, shipping_info: shipping.value },
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

            <AddressBlockSection
              title="請求先"
              block={form.billing_info}
              onChange={(next) => setForm((f) => ({ ...f, billing_info: next }))}
              showSuffix
              basic={{ name: form.name, address: form.address, tel_raw: form.tel_raw }}
            />
            <AddressBlockSection
              title="配送先 (施工先)"
              block={form.shipping_info}
              onChange={(next) => setForm((f) => ({ ...f, shipping_info: next }))}
              showSuffix={false}
              basic={{ name: form.name, address: form.address, tel_raw: form.tel_raw }}
            />

            <Field>
              <FieldLabel>状態</FieldLabel>
              <select
                className={NATIVE_SELECT_CLASS}
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
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={addCustomField}
                  disabled={form.custom_fields.length >= CUSTOM_FIELDS_MAX}
                >
                  + 項目を追加
                </Button>
              </div>
              <div className="flex flex-col gap-2">
                {form.custom_fields.length === 0 && (
                  <p className="text-xs text-muted-foreground">追加情報はまだありません。</p>
                )}
                {form.custom_fields.length >= CUSTOM_FIELDS_MAX && (
                  <p className="text-xs text-muted-foreground">
                    項目数が上限 ({CUSTOM_FIELDS_MAX} 件) に達しています。追加するには不要な行を削除してください。
                  </p>
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
