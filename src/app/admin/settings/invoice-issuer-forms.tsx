"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { SettingsValue } from "@/modules/settings/contracts";

import { updateInvoiceIssuerSettingsAction } from "./actions";
import { SETTINGS_FORM_INITIAL_STATE, type SettingsFormState } from "./form-state";
import type { SettingsMetaFor } from "./settings-forms";

/**
 * /admin/settings「請求書発行者」タブ (02-sales.md §8.6 / #51)。
 * telephony-forms.tsx と同じく別ファイルに分割 (settings-forms.tsx への追記を最小差分にするため —
 * 実装計画書 issue-51.md 「settings-forms.tsx/actions.ts/page.tsx」節)。
 * 角印アップロードは別 Server Action に分離せず本フォームに統合してある
 * (actions.ts の updateInvoiceIssuerSettingsAction コメント参照 — 楽観排他競合を構造的に避けるため)。
 */

// ai-tab.tsx の <select> と同じスタイル (settings 配下の既存 native select 前例)
const NATIVE_SELECT_CLASS = "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm";

function useFormFeedback(state: SettingsFormState, label: string) {
  useEffect(() => {
    if (state.success) toast.success(`${label}を保存しました。`);
  }, [state.success, label]);
}

function UpdatedAtHint({ updatedAt, isUnset }: { updatedAt: string | null; isUnset: boolean }) {
  if (isUnset) {
    return <p className="text-xs text-muted-foreground">まだ設定されていません。入力して保存してください。</p>;
  }
  return (
    <p className="text-xs text-muted-foreground">
      最終更新: {updatedAt ? new Date(updatedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "-"}
    </p>
  );
}

export function InvoiceIssuerForm({
  data,
  sealPreviewUrl,
  formRef,
}: {
  data: SettingsMetaFor<"invoice_issuer">;
  /** 保存済み seal_storage_path の署名 URL (TTL 5 分。page.tsx が Server Component 内で解決済み — 下記参照)。
   *  null = 未設定または署名 URL 解決失敗 (角印は法的要件ではないため degrade してプレビュー非表示にするだけでよい)。 */
  sealPreviewUrl: string | null;
  formRef: (el: HTMLFormElement | null) => void;
}) {
  const [state, action, isPending] = useActionState(updateInvoiceIssuerSettingsAction, SETTINGS_FORM_INITIAL_STATE);
  useFormFeedback(state, "請求書発行者設定");
  const v: SettingsValue<"invoice_issuer"> | null = data.value;

  return (
    <form ref={formRef} action={action} className="max-w-xl">
      <input type="hidden" name="expected_updated_at" value={data.updatedAt ?? ""} />
      <UpdatedAtHint updatedAt={data.updatedAt} isUnset={data.isUnset} />
      <FieldGroup className="mt-4">
        <Field>
          <FieldLabel htmlFor="ii-issuer-name">発行者名</FieldLabel>
          <Input id="ii-issuer-name" name="issuer_name" defaultValue={v?.issuer_name ?? ""} required maxLength={80} />
          <FieldDescription>帳票 (見積書・受注書・納品書・請求書) の発行者欄に印字されます。</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="ii-registration-number">適格請求書発行事業者登録番号 (任意)</FieldLabel>
          <Input
            id="ii-registration-number"
            name="registration_number"
            placeholder="T1234567890123"
            defaultValue={v?.registration_number ?? ""}
          />
          <FieldDescription>
            T + 数字13桁。空欄の場合は区分記載請求書等保存方式 (登録番号非印字) になります。
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="ii-tax-rounding">端数処理</FieldLabel>
          <select
            id="ii-tax-rounding"
            name="tax_rounding"
            defaultValue={v?.tax_rounding ?? "floor"}
            className={NATIVE_SELECT_CLASS}
          >
            <option value="floor">切り捨て</option>
            <option value="round">四捨五入</option>
            <option value="ceil">切り上げ</option>
          </select>
          <FieldDescription>税率区分ごとの消費税額計算 (書類単位で 1 回のみ丸め) に使用します。</FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="ii-quote-valid-days">見積有効期限の既定日数</FieldLabel>
          <Input
            id="ii-quote-valid-days"
            name="quote_valid_days"
            type="number"
            min={1}
            max={180}
            defaultValue={v?.quote_valid_days ?? 30}
            required
          />
          <FieldDescription>見積発行時に有効期限が未入力なら「発行日 + この日数」を自動設定します。</FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="ii-transfer-fee-note">振込手数料負担文言 (任意・請求書のみ印字)</FieldLabel>
          <Textarea
            id="ii-transfer-fee-note"
            name="transfer_fee_note"
            defaultValue={v?.transfer_fee_note ?? ""}
            maxLength={100}
            placeholder="恐れ入りますが振込手数料はご負担くださいますようお願い申し上げます。"
          />
        </Field>

        <Field orientation="horizontal">
          <Checkbox
            id="ii-bank-account-enabled"
            name="bank_account_enabled"
            value="on"
            defaultChecked={v?.bank_account !== null && v?.bank_account !== undefined}
          />
          <FieldContent>
            <FieldLabel htmlFor="ii-bank-account-enabled">振込先を請求書に印字する</FieldLabel>
          </FieldContent>
        </Field>
        <div className="grid gap-4 rounded-lg border border-border p-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="ii-bank-name">銀行名</FieldLabel>
            <Input id="ii-bank-name" name="bank_name" defaultValue={v?.bank_account?.bank_name ?? ""} maxLength={40} />
          </Field>
          <Field>
            <FieldLabel htmlFor="ii-branch-name">支店名</FieldLabel>
            <Input
              id="ii-branch-name"
              name="branch_name"
              defaultValue={v?.bank_account?.branch_name ?? ""}
              maxLength={40}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="ii-account-type">種別</FieldLabel>
            <select
              id="ii-account-type"
              name="account_type"
              defaultValue={v?.bank_account?.account_type ?? "ordinary"}
              className={NATIVE_SELECT_CLASS}
            >
              <option value="ordinary">普通</option>
              <option value="checking">当座</option>
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor="ii-account-number">口座番号</FieldLabel>
            <Input
              id="ii-account-number"
              name="account_number"
              placeholder="1234567"
              defaultValue={v?.bank_account?.account_number ?? ""}
            />
          </Field>
          <Field className="sm:col-span-2">
            <FieldLabel htmlFor="ii-account-holder-kana">口座名義 (カナ)</FieldLabel>
            <Input
              id="ii-account-holder-kana"
              name="account_holder_kana"
              defaultValue={v?.bank_account?.account_holder_kana ?? ""}
              maxLength={60}
            />
          </Field>
        </div>
        <FieldDescription className="-mt-2">
          「振込先を請求書に印字する」がオフの場合、上記を入力していても振込先欄は印字されません。
        </FieldDescription>

        <Field>
          <FieldLabel htmlFor="ii-seal-image">角印画像 (任意・PNG または JPEG、2MB 以内)</FieldLabel>
          {sealPreviewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage の署名 URL (TTL 5分) を直接表示するため next/image のリモートパターン許可リスト対象外
            <img src={sealPreviewUrl} alt="登録済みの角印" className="h-16 w-16 rounded border border-border object-contain bg-white p-1" />
          ) : (
            <p className="text-xs text-muted-foreground">未登録です。</p>
          )}
          <input type="hidden" name="seal_storage_path" value={v?.seal_storage_path ?? ""} />
          <Input id="ii-seal-image" name="seal_image" type="file" accept="image/png,image/jpeg" />
          <FieldDescription>
            新しい画像を選択すると保存時に差し替わります (未選択なら現在の登録内容を維持)。社名の右横に重ねて帳票に印字されます。
          </FieldDescription>
        </Field>
      </FieldGroup>
      <FieldError errors={state.error ? [{ message: state.error }] : undefined} className="mt-3" />
      <Button type="submit" disabled={isPending} className="mt-6">
        {isPending ? "保存中..." : "保存 (Cmd+S)"}
      </Button>
    </form>
  );
}
