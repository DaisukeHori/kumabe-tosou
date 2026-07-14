"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";

import { saveBusinessHoursAction, saveTelephonySettingsAction } from "@/app/admin/calls/actions";
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

import { SETTINGS_FORM_INITIAL_STATE, type SettingsFormState } from "./form-state";
import type { SettingsMetaFor } from "./settings-forms";

/**
 * /admin/settings「電話」「営業時間」タブ (04-telephony.md §8.3)。
 * saveTelephonySettingsAction / saveBusinessHoursAction は canonical §7.4 の指定どおり
 * src/app/admin/calls/actions.ts に実装されている (計画書 issue-59.md 未解決点#1)。
 */

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

export type TelephonySetupStatus = {
  envConfigured: boolean;
  numberConfigured: boolean;
  forwardConfigured: boolean;
  staleJobs: number;
};

function SetupChecklist({ status, siteUrl }: { status: TelephonySetupStatus | null; siteUrl: string }) {
  if (!status) {
    return (
      <p className="text-xs text-muted-foreground">セットアップ状況を取得できませんでした。</p>
    );
  }
  return (
    <div className="mb-4 flex flex-col gap-1 rounded-lg border border-border bg-muted/40 p-3 text-xs">
      <p className="font-medium text-foreground">セットアップチェックリスト</p>
      <p>{status.envConfigured ? "✅" : "⬜"} env (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN) 設定済み</p>
      <p>{status.numberConfigured ? "✅" : "⬜"} 電話番号 設定済み</p>
      <p>{status.forwardConfigured ? "✅" : "⬜"} 転送先 設定済み (未設定でも全通話が留守電として成立します)</p>
      <p>{status.staleJobs > 0 ? "⚠️" : "✅"} 処理の滞留: {status.staleJobs} 件 (30分超)</p>
      <div className="mt-1 flex flex-col gap-0.5">
        <p className="font-medium text-foreground">Twilio コンソールに設定する Webhook URL</p>
        <code className="break-all">{siteUrl}/api/telephony/voice (Voice webhook, POST)</code>
        <code className="break-all">{siteUrl}/api/telephony/status (statusCallback)</code>
        <code className="break-all">{siteUrl}/api/telephony/recording-status (Recording status callback)</code>
      </div>
      <p className="mt-1">
        Fallback URL には静的 TwiML Bin を設定してください。また Twilio コンソールの Voice 設定で
        「録音メディア URL の HTTP Basic 認証」を必ず有効化してください (本番前必須)。
      </p>
    </div>
  );
}

export function TelephonyForm({
  data,
  setupStatus,
  siteUrl,
  formRef,
}: {
  data: SettingsMetaFor<"telephony">;
  setupStatus: TelephonySetupStatus | null;
  siteUrl: string;
  formRef: (el: HTMLFormElement | null) => void;
}) {
  const [state, action, isPending] = useActionState(saveTelephonySettingsAction, SETTINGS_FORM_INITIAL_STATE);
  useFormFeedback(state, "電話設定");
  const v: SettingsValue<"telephony"> | null = data.value;

  return (
    <form ref={formRef} action={action} className="max-w-xl">
      <input type="hidden" name="expected_updated_at" value={data.updatedAt ?? ""} />
      <SetupChecklist status={setupStatus} siteUrl={siteUrl} />
      <UpdatedAtHint updatedAt={data.updatedAt} isUnset={data.isUnset} />
      <FieldGroup className="mt-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="tel-phone-number">電話番号</FieldLabel>
            <Input
              id="tel-phone-number"
              name="phone_number_e164"
              placeholder="090-1234-5678 (自動で国際形式に変換されます)"
              defaultValue={v?.phone_number_e164 ?? ""}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="tel-number-sid">番号リソース SID (任意)</FieldLabel>
            <Input id="tel-number-sid" name="twilio_number_sid" defaultValue={v?.twilio_number_sid ?? ""} />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor="tel-forward-to">転送先電話番号 (熊部さんの携帯など)</FieldLabel>
          <Input
            id="tel-forward-to"
            name="forward_to_e164"
            placeholder="090-1234-5678 (自動で国際形式に変換されます)"
            defaultValue={v?.forward_to_e164 ?? ""}
          />
          <FieldDescription>未設定の場合、すべての着信が留守電になります。</FieldDescription>
        </Field>
        <Field orientation="horizontal">
          <Checkbox
            id="tel-consent-enabled"
            name="consent_announcement_enabled"
            value="on"
            defaultChecked={v?.consent_announcement_enabled ?? true}
          />
          <FieldContent>
            <FieldLabel htmlFor="tel-consent-enabled">録音同意アナウンスを流す</FieldLabel>
          </FieldContent>
        </Field>
        <Field>
          <FieldLabel htmlFor="tel-consent-text">同意アナウンス文言 (空欄で既定文言)</FieldLabel>
          <Textarea id="tel-consent-text" name="consent_announcement_text" defaultValue={v?.consent_announcement_text ?? ""} maxLength={300} />
        </Field>
        <Field>
          <FieldLabel htmlFor="tel-in-hours-text">営業時間内・留守電の案内文言 (空欄で既定文言)</FieldLabel>
          <Textarea id="tel-in-hours-text" name="in_hours_greeting_text" defaultValue={v?.in_hours_greeting_text ?? ""} maxLength={300} />
        </Field>
        <Field>
          <FieldLabel htmlFor="tel-after-hours-text">営業時間外の案内文言 (空欄で既定文言)</FieldLabel>
          <Textarea id="tel-after-hours-text" name="after_hours_greeting_text" defaultValue={v?.after_hours_greeting_text ?? ""} maxLength={300} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="tel-voicemail-max">留守電の最大秒数</FieldLabel>
            <Input
              id="tel-voicemail-max"
              name="voicemail_max_seconds"
              type="number"
              min={30}
              max={600}
              defaultValue={v?.voicemail_max_seconds ?? 120}
              required
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="tel-max-processing">AI 処理する録音長の上限 (分)</FieldLabel>
            <Input
              id="tel-max-processing"
              name="max_processing_minutes"
              type="number"
              min={1}
              max={60}
              defaultValue={v?.max_processing_minutes ?? 30}
              required
            />
          </Field>
        </div>
        <Field orientation="horizontal">
          <Checkbox
            id="tel-delete-recording"
            name="delete_twilio_recording_after_download"
            value="on"
            defaultChecked={v?.delete_twilio_recording_after_download ?? true}
          />
          <FieldContent>
            <FieldLabel htmlFor="tel-delete-recording">
              ダウンロード後に Twilio 側の録音を削除する (ストレージ課金停止)
            </FieldLabel>
          </FieldContent>
        </Field>
      </FieldGroup>
      <FieldError errors={state.error ? [{ message: state.error }] : undefined} className="mt-3" />
      <Button type="submit" disabled={isPending} className="mt-6">
        {isPending ? "保存中..." : "保存 (Cmd+S)"}
      </Button>
    </form>
  );
}

const DAY_LABELS: { key: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun"; label: string }[] = [
  { key: "mon", label: "月" },
  { key: "tue", label: "火" },
  { key: "wed", label: "水" },
  { key: "thu", label: "木" },
  { key: "fri", label: "金" },
  { key: "sat", label: "土" },
  { key: "sun", label: "日" },
];

export function BusinessHoursForm({
  data,
  formRef,
}: {
  data: SettingsMetaFor<"business_hours">;
  formRef: (el: HTMLFormElement | null) => void;
}) {
  const [state, action, isPending] = useActionState(saveBusinessHoursAction, SETTINGS_FORM_INITIAL_STATE);
  useFormFeedback(state, "営業時間");
  const v: SettingsValue<"business_hours"> | null = data.value;

  const [holidays, setHolidays] = useState<string[]>(v?.holidays ?? []);
  const [newHoliday, setNewHoliday] = useState("");

  useEffect(() => {
    setHolidays(v?.holidays ?? []);
  }, [v]);

  function addHoliday() {
    if (!newHoliday) return;
    if (holidays.includes(newHoliday)) {
      setNewHoliday("");
      return;
    }
    if (holidays.length >= 200) {
      toast.error("臨時休業日は最大200件までです。");
      return;
    }
    setHolidays([...holidays, newHoliday].sort());
    setNewHoliday("");
  }

  function removeHoliday(date: string) {
    setHolidays(holidays.filter((d) => d !== date));
  }

  return (
    <form ref={formRef} action={action} className="max-w-xl">
      <input type="hidden" name="expected_updated_at" value={data.updatedAt ?? ""} />
      <UpdatedAtHint updatedAt={data.updatedAt} isUnset={data.isUnset} />
      <FieldDescription className="mt-2">
        JST 前提です。1 日 1 窓のみ設定できます (昼休みなどの分割は非対応)。open は close より前である必要があります。
      </FieldDescription>
      <FieldGroup className="mt-4">
        {DAY_LABELS.map(({ key, label }) => {
          const day = v?.[key] ?? null;
          return (
            <Field key={key} orientation="horizontal" className="items-center">
              <Checkbox id={`bh-${key}-enabled`} name={`${key}_enabled`} value="on" defaultChecked={day !== null} />
              <FieldContent className="flex-row items-center gap-3">
                <FieldLabel htmlFor={`bh-${key}-enabled`} className="w-6">
                  {label}
                </FieldLabel>
                <Input
                  type="time"
                  step={900}
                  name={`${key}_open`}
                  defaultValue={day?.open ?? "09:00"}
                  className="w-28"
                  aria-label={`${label}曜 開始`}
                />
                <span className="text-muted-foreground">〜</span>
                <Input
                  type="time"
                  step={900}
                  name={`${key}_close`}
                  defaultValue={day?.close ?? "18:00"}
                  className="w-28"
                  aria-label={`${label}曜 終了`}
                />
              </FieldContent>
            </Field>
          );
        })}

        <Field>
          <FieldLabel>臨時休業日</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {holidays.map((d) => (
              <span key={d} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                {d}
                <input type="hidden" name="holidays" value={d} />
                <button
                  type="button"
                  onClick={() => removeHoliday(d)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`${d} を削除`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Input
              type="date"
              value={newHoliday}
              onChange={(e) => setNewHoliday(e.target.value)}
              className="w-40"
            />
            <Button type="button" variant="outline" size="sm" onClick={addHoliday}>
              追加
            </Button>
          </div>
        </Field>
      </FieldGroup>
      <FieldError errors={state.error ? [{ message: state.error }] : undefined} className="mt-3" />
      <Button type="submit" disabled={isPending} className="mt-6">
        {isPending ? "保存中..." : "保存 (Cmd+S)"}
      </Button>
    </form>
  );
}
