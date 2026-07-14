"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { MediaPicker, type PickerMediaItem } from "@/app/admin/_ui";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { AiKeyMeta } from "@/modules/ai-providers/contracts";
import type { SettingsKey, SettingsValue } from "@/modules/settings/contracts";

import {
  updateAnalyticsSettingsAction,
  updateBrandingSettingsAction,
  updateCompanySettingsAction,
  updateHeroSettingsAction,
  updateNotificationsAction,
  updateOpsLimitsAction,
  updateSeoDefaultsAction,
  updateWorkCapacityAction,
} from "./actions";
import { AiSettingsTab } from "./ai-tab";
import { SETTINGS_FORM_INITIAL_STATE, type SettingsFormState } from "./form-state";
import { InvoiceIssuerForm } from "./invoice-issuer-forms";
import { BusinessHoursForm, TelephonyForm, type TelephonySetupStatus } from "./telephony-forms";

export type SettingsMetaFor<K extends SettingsKey> = {
  value: SettingsValue<K> | null;
  updatedAt: string | null;
  isUnset: boolean;
  /** §6.5: 契約不一致行 (手動 SQL 事故等)。true のとき警告バナー表示 + 生 updated_at で再保存可能。
   *  facade.SettingsMeta.corrupted と同型 (後方互換 optional)。 */
  corrupted?: boolean;
};

export type SettingsTabsData = {
  company: SettingsMetaFor<"company">;
  hero: SettingsMetaFor<"hero">;
  seo_defaults: SettingsMetaFor<"seo_defaults">;
  analytics: SettingsMetaFor<"analytics">;
  branding: SettingsMetaFor<"branding">;
  ops_limits: SettingsMetaFor<"ops_limits">;
  notifications: SettingsMetaFor<"notifications">;
  work_capacity: SettingsMetaFor<"work_capacity">;
  telephony: SettingsMetaFor<"telephony">;
  business_hours: SettingsMetaFor<"business_hours">;
  invoice_issuer: SettingsMetaFor<"invoice_issuer">;
};

/**
 * "ai" は site_settings の SettingsKey ではなく ai-providers 由来のタブのため、別ユニオンで扱う。
 * #45 (07-contracts-delta §D5) で SettingsKey は 11 キーに拡張され、本管理画面はそのうち
 * 従来の 5 キー + work_capacity (#53) + telephony/business_hours (#59) + invoice_issuer (#51) +
 * analytics/branding (#47) の計 11 キー全てをタブとして描画する。SettingsKey をそのまま使うと
 * 未実装タブの型要求が漏れ伝播するため、この画面が実際に扱うキーだけの明示ユニオンに固定する。
 */
type TabKey =
  | Extract<
      SettingsKey,
      | "company"
      | "hero"
      | "seo_defaults"
      | "analytics"
      | "branding"
      | "ops_limits"
      | "notifications"
      | "work_capacity"
      | "telephony"
      | "business_hours"
      | "invoice_issuer"
    >
  | "ai";

const TAB_LABELS: Record<TabKey, string> = {
  company: "会社情報",
  hero: "ヒーロー",
  seo_defaults: "SEO既定値",
  analytics: "計測",
  branding: "ブランディング",
  ops_limits: "運用上限",
  notifications: "通知",
  work_capacity: "週間稼働",
  telephony: "電話",
  business_hours: "営業時間",
  invoice_issuer: "請求書発行者",
  ai: "AI",
};

/** フォーム共通のフィードバック処理 (成功トースト/エラー表示) */
function useFormFeedback(state: SettingsFormState, label: string) {
  useEffect(() => {
    if (state.success) toast.success(`${label}を保存しました。`);
  }, [state.success, label]);
}

function UpdatedAtHint({
  updatedAt,
  isUnset,
  corrupted,
}: {
  updatedAt: string | null;
  isUnset: boolean;
  corrupted?: boolean;
}) {
  return (
    <>
      {corrupted && (
        <p role="alert" className="text-sm text-destructive">
          保存されている値が現在の形式と一致しません。保存すると入力した値で上書きされます。
        </p>
      )}
      {isUnset ? (
        <p className="text-xs text-muted-foreground">まだ設定されていません。入力して保存してください。</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          最終更新: {updatedAt ? new Date(updatedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "-"}
        </p>
      )}
    </>
  );
}

export function SettingsTabs({
  data,
  initialTab,
  aiKeys,
  telephonySetupStatus,
  siteUrl,
  sealPreviewUrl,
  mediaCatalog,
  mediaNextCursor,
}: {
  data: SettingsTabsData;
  /** /admin/settings?tab= の生の値 (未検証)。TAB_LABELS のキーであれば初期タブとして採用し、
   *  それ以外 (未指定・未知値) は従来どおり "company" にフォールバックする (#92)。 */
  initialTab?: string;
  aiKeys: AiKeyMeta[];
  telephonySetupStatus: TelephonySetupStatus | null;
  siteUrl: string;
  /** 角印画像の署名 URL (TTL 5 分)。page.tsx が Server Component 内で解決済み。null = 未設定/解決失敗。 */
  sealPreviewUrl: string | null;
  /** favicon (branding) / OG 画像 (seo_defaults) の MediaPicker 用初期カタログ (§6.1) */
  mediaCatalog: PickerMediaItem[];
  mediaNextCursor: string | null;
}) {
  const [active, setActive] = useState<TabKey>(() =>
    // `in` 演算子は Object.prototype 継承プロパティ (constructor/toString/hasOwnProperty 等) にも
    // マッチしてしまい、?tab=constructor 等でどの TabsTrigger/TabsContent にも一致しない active を
    // 生成しうる (タブ空白化 + Cmd+S 時 formRefs.current[active] がプロトタイプ継承値を掴み
    // requestSubmit is not a function で例外化)。hasOwnProperty で自身のキーのみ許可する。
    initialTab && Object.prototype.hasOwnProperty.call(TAB_LABELS, initialTab)
      ? (initialTab as TabKey)
      : "company",
  );
  // "ai" タブは複数の独立したフォーム (キー追加/予算) を持つため単一の Cmd+S 対象を持たない
  // (キーを設定しない = そのタブでは Cmd+S が何もしない、という割り切り)。
  const formRefs = useRef<Partial<Record<SettingsKey, HTMLFormElement | null>>>({});

  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      const isSave = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s";
      if (!isSave) return;
      if (active === "ai") return;
      e.preventDefault();
      formRefs.current[active]?.requestSubmit();
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [active]);

  return (
    <Tabs
      value={active}
      onValueChange={(v) => {
        const next = v as TabKey;
        setActive(next);
        // router.replace は force-dynamic な本ページの Server Component を再実行させ、
        // settings 14 件の再フェッチと入力中フォーム値の消失を招くため使わない。
        // native History API で URL の ?tab= のみを浅く同期する (Next.js 15.5 でサポート済み)。
        const url = next === "company" ? "/admin/settings" : `/admin/settings?tab=${next}`;
        window.history.replaceState(null, "", url);
      }}
    >
      <TabsList variant="line">
        {(Object.keys(TAB_LABELS) as TabKey[]).map((key) => (
          <TabsTrigger key={key} value={key}>
            {TAB_LABELS[key]}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="company" className="mt-6">
        <CompanyForm
          data={data.company}
          formRef={(el) => {
            formRefs.current.company = el;
          }}
        />
      </TabsContent>
      <TabsContent value="hero" className="mt-6">
        <HeroForm
          data={data.hero}
          formRef={(el) => {
            formRefs.current.hero = el;
          }}
        />
      </TabsContent>
      <TabsContent value="seo_defaults" className="mt-6">
        <SeoDefaultsForm
          data={data.seo_defaults}
          mediaCatalog={mediaCatalog}
          mediaNextCursor={mediaNextCursor}
          formRef={(el) => {
            formRefs.current.seo_defaults = el;
          }}
        />
      </TabsContent>
      <TabsContent value="analytics" className="mt-6">
        <AnalyticsForm
          data={data.analytics}
          formRef={(el) => {
            formRefs.current.analytics = el;
          }}
        />
      </TabsContent>
      <TabsContent value="branding" className="mt-6">
        <BrandingForm
          data={data.branding}
          mediaCatalog={mediaCatalog}
          mediaNextCursor={mediaNextCursor}
          formRef={(el) => {
            formRefs.current.branding = el;
          }}
        />
      </TabsContent>
      <TabsContent value="ops_limits" className="mt-6">
        <OpsLimitsForm
          data={data.ops_limits}
          formRef={(el) => {
            formRefs.current.ops_limits = el;
          }}
        />
      </TabsContent>
      <TabsContent value="notifications" className="mt-6">
        <NotificationsForm
          data={data.notifications}
          formRef={(el) => {
            formRefs.current.notifications = el;
          }}
        />
      </TabsContent>
      <TabsContent value="work_capacity" className="mt-6">
        <WorkCapacityForm
          data={data.work_capacity}
          formRef={(el) => {
            formRefs.current.work_capacity = el;
          }}
        />
      </TabsContent>
      <TabsContent value="telephony" className="mt-6">
        <TelephonyForm
          data={data.telephony}
          setupStatus={telephonySetupStatus}
          siteUrl={siteUrl}
          formRef={(el) => {
            formRefs.current.telephony = el;
          }}
        />
      </TabsContent>
      <TabsContent value="business_hours" className="mt-6">
        <BusinessHoursForm
          data={data.business_hours}
          formRef={(el) => {
            formRefs.current.business_hours = el;
          }}
        />
      </TabsContent>
      <TabsContent value="invoice_issuer" className="mt-6">
        <InvoiceIssuerForm
          data={data.invoice_issuer}
          sealPreviewUrl={sealPreviewUrl}
          formRef={(el) => {
            formRefs.current.invoice_issuer = el;
          }}
        />
      </TabsContent>
      <TabsContent value="ai" className="mt-6">
        <AiSettingsTab keys={aiKeys} opsLimits={data.ops_limits} />
      </TabsContent>
    </Tabs>
  );
}

function CompanyForm({
  data,
  formRef,
}: {
  data: SettingsMetaFor<"company">;
  formRef: (el: HTMLFormElement | null) => void;
}) {
  const [state, action, isPending] = useActionState(updateCompanySettingsAction, SETTINGS_FORM_INITIAL_STATE);
  useFormFeedback(state, "会社情報");
  const v = data.value;

  return (
    <form ref={formRef} action={action} className="max-w-xl">
      <input type="hidden" name="expected_updated_at" value={data.updatedAt ?? ""} />
      <UpdatedAtHint updatedAt={data.updatedAt} isUnset={data.isUnset} corrupted={data.corrupted} />
      <FieldGroup className="mt-4">
        <Field>
          <FieldLabel htmlFor="company-name">会社名</FieldLabel>
          <Input id="company-name" name="name" defaultValue={v?.name ?? ""} required maxLength={50} />
        </Field>
        <Field>
          <FieldLabel htmlFor="company-representative">代表者名</FieldLabel>
          <Input
            id="company-representative"
            name="representative"
            defaultValue={v?.representative ?? ""}
            required
            maxLength={30}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="company-address">所在地</FieldLabel>
          <Input id="company-address" name="address" defaultValue={v?.address ?? ""} required maxLength={120} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="company-tel">電話番号 (任意)</FieldLabel>
            <Input id="company-tel" name="tel" placeholder="0000-00-0000" defaultValue={v?.tel ?? ""} />
          </Field>
          <Field>
            <FieldLabel htmlFor="company-email">メールアドレス (任意)</FieldLabel>
            <Input id="company-email" name="email" type="email" defaultValue={v?.email ?? ""} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="company-founded">創業年月 (任意)</FieldLabel>
            <Input id="company-founded" name="founded" placeholder="YYYY または YYYY-MM" defaultValue={v?.founded ?? ""} />
          </Field>
          <Field>
            <FieldLabel htmlFor="company-hours">営業時間 (任意)</FieldLabel>
            <Input id="company-hours" name="business_hours" defaultValue={v?.business_hours ?? ""} />
          </Field>
        </div>
      </FieldGroup>
      <FieldError errors={state.error ? [{ message: state.error }] : undefined} className="mt-3" />
      <Button type="submit" disabled={isPending} className="mt-6">
        {isPending ? "保存中..." : "保存 (Cmd+S)"}
      </Button>
    </form>
  );
}

function HeroForm({
  data,
  formRef,
}: {
  data: SettingsMetaFor<"hero">;
  formRef: (el: HTMLFormElement | null) => void;
}) {
  const [state, action, isPending] = useActionState(updateHeroSettingsAction, SETTINGS_FORM_INITIAL_STATE);
  useFormFeedback(state, "ヒーロー設定");
  const v = data.value;

  return (
    <form ref={formRef} action={action} className="max-w-xl">
      <input type="hidden" name="expected_updated_at" value={data.updatedAt ?? ""} />
      <UpdatedAtHint updatedAt={data.updatedAt} isUnset={data.isUnset} corrupted={data.corrupted} />
      <FieldDescription className="mt-4">
        ヒーロー画像は /admin/visual のビジュアルエディタ (トップページのヒーロー写真) から差し替えてください。ここでは見出し・CTA テキストのみを編集します。
      </FieldDescription>
      <FieldGroup className="mt-4">
        <Field>
          <FieldLabel htmlFor="hero-heading">見出し</FieldLabel>
          <Input id="hero-heading" name="heading" defaultValue={v?.heading ?? ""} required maxLength={40} />
        </Field>
        <Field>
          <FieldLabel htmlFor="hero-subheading">サブ見出し</FieldLabel>
          <Textarea id="hero-subheading" name="subheading" defaultValue={v?.subheading ?? ""} maxLength={80} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="hero-cta-label">CTA ラベル</FieldLabel>
            <Input id="hero-cta-label" name="cta_label" defaultValue={v?.cta_label ?? ""} required maxLength={20} />
          </Field>
          <Field>
            <FieldLabel htmlFor="hero-cta-href">CTA リンク先 (サイト内パス)</FieldLabel>
            <Input id="hero-cta-href" name="cta_href" defaultValue={v?.cta_href ?? ""} required placeholder="/shop" />
          </Field>
        </div>
      </FieldGroup>
      <FieldError errors={state.error ? [{ message: state.error }] : undefined} className="mt-3" />
      <Button type="submit" disabled={isPending} className="mt-6">
        {isPending ? "保存中..." : "保存 (Cmd+S)"}
      </Button>
    </form>
  );
}

function SeoDefaultsForm({
  data,
  mediaCatalog,
  mediaNextCursor,
  formRef,
}: {
  data: SettingsMetaFor<"seo_defaults">;
  mediaCatalog: PickerMediaItem[];
  mediaNextCursor: string | null;
  formRef: (el: HTMLFormElement | null) => void;
}) {
  const [state, action, isPending] = useActionState(updateSeoDefaultsAction, SETTINGS_FORM_INITIAL_STATE);
  useFormFeedback(state, "SEO既定値");
  const v = data.value;
  // og_media_id は zSeoDefaults 上 nullable ではない (選択必須) — issue-47.md 成果物4-5 の指示どおり
  // 「既定に戻す」ボタンは付けない。未選択のまま保存すると submitSettingsForm が E101 相当の
  // フィールドエラーを返す (FieldError で表示)。
  const [ogMediaId, setOgMediaId] = useState<string | null>(v?.og_media_id ?? null);
  const [catalog, setCatalog] = useState<PickerMediaItem[]>(mediaCatalog);
  const [pickerOpen, setPickerOpen] = useState(false);
  const current = catalog.find((m) => m.id === ogMediaId) ?? null;

  return (
    <form ref={formRef} action={action} className="max-w-xl">
      <input type="hidden" name="expected_updated_at" value={data.updatedAt ?? ""} />
      <input type="hidden" name="og_media_id" value={ogMediaId ?? ""} />
      <UpdatedAtHint updatedAt={data.updatedAt} isUnset={data.isUnset} corrupted={data.corrupted} />
      <FieldGroup className="mt-4">
        <Field>
          <FieldLabel htmlFor="seo-title-template">タイトルテンプレート</FieldLabel>
          <Input
            id="seo-title-template"
            name="title_template"
            defaultValue={v?.title_template ?? "%s | 隈部塗装"}
            required
            maxLength={60}
          />
          <FieldDescription>%s がページ固有タイトルに置換されます (必須)。</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="seo-description">既定 description</FieldLabel>
          <Textarea
            id="seo-description"
            name="description"
            defaultValue={v?.description ?? ""}
            required
            minLength={50}
            maxLength={160}
            className="min-h-24"
          />
        </Field>
        <Field>
          <FieldLabel>OGP 画像</FieldLabel>
          <div className="flex items-center gap-3">
            {current ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={current.url}
                alt={current.alt}
                className="h-20 w-20 shrink-0 rounded-lg border border-border object-cover"
              />
            ) : (
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-[11px] text-muted-foreground">
                未選択
              </div>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
              画像を選択
            </Button>
          </div>
          <FieldDescription>
            推奨サイズ 1200×630 (1.91:1)。SNS シェア時のカード画像に使われます。
          </FieldDescription>
        </Field>
      </FieldGroup>
      {state.warning && (
        <p role="status" className="mt-3 text-sm text-amber-600">
          {state.warning}
        </p>
      )}
      <FieldError errors={state.error ? [{ message: state.error }] : undefined} className="mt-3" />
      <Button type="submit" disabled={isPending} className="mt-6">
        {isPending ? "保存中..." : "保存 (Cmd+S)"}
      </Button>
      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        mode="single"
        title="OGP 画像を選ぶ"
        initialItems={catalog}
        initialNextCursor={mediaNextCursor}
        selectedIds={ogMediaId ? [ogMediaId] : []}
        onConfirm={(ids) => setOgMediaId(ids[0] ?? null)}
        onItemsLoaded={(items) => setCatalog((prev) => [...prev, ...items])}
      />
    </form>
  );
}

/** 「計測」タブ (05-site-settings.md §6.2 AnalyticsForm)。GA4 測定 ID 1 項目のみ、空欄で計測無効。 */
function AnalyticsForm({
  data,
  formRef,
}: {
  data: SettingsMetaFor<"analytics">;
  formRef: (el: HTMLFormElement | null) => void;
}) {
  const [state, action, isPending] = useActionState(updateAnalyticsSettingsAction, SETTINGS_FORM_INITIAL_STATE);
  useFormFeedback(state, "計測設定");
  const v = data.value;

  return (
    <form ref={formRef} action={action} className="max-w-xl">
      <input type="hidden" name="expected_updated_at" value={data.updatedAt ?? ""} />
      <UpdatedAtHint updatedAt={data.updatedAt} isUnset={data.isUnset} corrupted={data.corrupted} />
      <FieldDescription className="mt-4">
        Google アナリティクス (GA4) の測定 ID。設定すると公開サイトのみ計測されます
        (管理画面・編集画面は対象外)。空欄で保存すると計測を停止します。
        プレビュー環境では設定に関わらず計測されません。
      </FieldDescription>
      <FieldGroup className="mt-4">
        <Field>
          <FieldLabel htmlFor="analytics-ga4-id">GA4 測定 ID</FieldLabel>
          <Input
            id="analytics-ga4-id"
            name="ga4_measurement_id"
            placeholder="G-XXXXXXXXXX"
            defaultValue={v?.ga4_measurement_id ?? ""}
          />
        </Field>
      </FieldGroup>
      <FieldError errors={state.error ? [{ message: state.error }] : undefined} className="mt-3" />
      <Button type="submit" disabled={isPending} className="mt-6">
        {isPending ? "保存中..." : "保存 (Cmd+S)"}
      </Button>
    </form>
  );
}

/**
 * 「ブランディング」タブ (05-site-settings.md §6.2 BrandingForm)。favicon の media 参照 1 項目。
 * plain useState + hidden input で MediaPicker と連携する (issue-47.md 成果物4-4 の指示どおり —
 * 既存 settings フォームは全て plain useActionState 方式のため、WorkForm.tsx の RHF
 * (setValue/watch) 方式はそのまま流用せず、この画面独自に組む)。
 */
function BrandingForm({
  data,
  mediaCatalog,
  mediaNextCursor,
  formRef,
}: {
  data: SettingsMetaFor<"branding">;
  mediaCatalog: PickerMediaItem[];
  mediaNextCursor: string | null;
  formRef: (el: HTMLFormElement | null) => void;
}) {
  const [state, action, isPending] = useActionState(updateBrandingSettingsAction, SETTINGS_FORM_INITIAL_STATE);
  useFormFeedback(state, "ブランディング");
  useEffect(() => {
    if (state.warning) toast.warning(state.warning);
  }, [state.warning]);
  const v = data.value;
  const [faviconId, setFaviconId] = useState<string | null>(v?.favicon_media_id ?? null);
  const [catalog, setCatalog] = useState<PickerMediaItem[]>(mediaCatalog);
  const [pickerOpen, setPickerOpen] = useState(false);
  const current = catalog.find((m) => m.id === faviconId) ?? null;

  return (
    <form ref={formRef} action={action} className="max-w-xl">
      <input type="hidden" name="expected_updated_at" value={data.updatedAt ?? ""} />
      <input type="hidden" name="favicon_media_id" value={faviconId ?? ""} />
      <UpdatedAtHint updatedAt={data.updatedAt} isUnset={data.isUnset} corrupted={data.corrupted} />
      <FieldDescription className="mt-4">
        サイトのタブに表示されるアイコン。正方形 PNG (512×512 推奨) をアップロードしてください。
        未設定のときは従来のアイコンが表示されます。
      </FieldDescription>
      <FieldGroup className="mt-4">
        <Field>
          <FieldLabel>favicon 画像</FieldLabel>
          <div className="flex items-center gap-4">
            {current ? (
              <div className="flex items-end gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={current.url}
                  alt={current.alt}
                  className="h-8 w-8 rounded border border-border object-cover"
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={current.url}
                  alt={current.alt}
                  className="h-16 w-16 rounded border border-border object-cover"
                />
              </div>
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded border border-dashed border-border text-[11px] text-muted-foreground">
                未選択
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                画像を選択
              </Button>
              {faviconId && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setFaviconId(null)}>
                  既定に戻す
                </Button>
              )}
            </div>
          </div>
        </Field>
      </FieldGroup>
      {state.warning && (
        <p role="status" className="mt-3 text-sm text-amber-600">
          {state.warning}
        </p>
      )}
      <FieldError errors={state.error ? [{ message: state.error }] : undefined} className="mt-3" />
      <Button type="submit" disabled={isPending} className="mt-6">
        {isPending ? "保存中..." : "保存 (Cmd+S)"}
      </Button>
      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        mode="single"
        title="favicon 画像を選ぶ"
        initialItems={catalog}
        initialNextCursor={mediaNextCursor}
        selectedIds={faviconId ? [faviconId] : []}
        onConfirm={(ids) => setFaviconId(ids[0] ?? null)}
        onItemsLoaded={(items) => setCatalog((prev) => [...prev, ...items])}
      />
    </form>
  );
}

function OpsLimitsForm({
  data,
  formRef,
}: {
  data: SettingsMetaFor<"ops_limits">;
  formRef: (el: HTMLFormElement | null) => void;
}) {
  const [state, action, isPending] = useActionState(updateOpsLimitsAction, SETTINGS_FORM_INITIAL_STATE);
  useFormFeedback(state, "運用上限");
  const v = data.value;

  return (
    <form ref={formRef} action={action} className="max-w-xl">
      <input type="hidden" name="expected_updated_at" value={data.updatedAt ?? ""} />
      {/* AI タブが編集する分は現在値のまま hidden で持ち回す (本フォームは x_monthly_post_limit のみ編集) */}
      <input
        type="hidden"
        name="ai_monthly_budget_micro_usd"
        value={v?.ai_monthly_budget_micro_usd ?? 50_000_000}
      />
      <input type="hidden" name="ai_monthly_image_limit" value={v?.ai_monthly_image_limit ?? 200} />
      <input type="hidden" name="ai_default_image_model" value={v?.ai_default_image_model ?? ""} />
      <UpdatedAtHint updatedAt={data.updatedAt} isUnset={data.isUnset} corrupted={data.corrupted} />
      <FieldGroup className="mt-4">
        <Field>
          <FieldLabel htmlFor="ops-x-limit">X 月間投稿上限 (課金ガード)</FieldLabel>
          <Input
            id="ops-x-limit"
            name="x_monthly_post_limit"
            type="number"
            min={0}
            max={1000}
            defaultValue={v?.x_monthly_post_limit ?? 100}
            required
          />
          <FieldDescription>当月の推定コスト合算がこの件数相当を超えたら配信をブロックします (KMB-E505)。</FieldDescription>
        </Field>
      </FieldGroup>
      <FieldError errors={state.error ? [{ message: state.error }] : undefined} className="mt-3" />
      <Button type="submit" disabled={isPending} className="mt-6">
        {isPending ? "保存中..." : "保存 (Cmd+S)"}
      </Button>
    </form>
  );
}

/** 「週間稼働」タブ (03-scheduling.md §3.4)。getWeeklyCapacity の分母 (weekly_hours) を編集する。 */
function WorkCapacityForm({
  data,
  formRef,
}: {
  data: SettingsMetaFor<"work_capacity">;
  formRef: (el: HTMLFormElement | null) => void;
}) {
  const [state, action, isPending] = useActionState(updateWorkCapacityAction, SETTINGS_FORM_INITIAL_STATE);
  useFormFeedback(state, "週間稼働");
  const v = data.value;

  return (
    <form ref={formRef} action={action} className="max-w-xl">
      <input type="hidden" name="expected_updated_at" value={data.updatedAt ?? ""} />
      <UpdatedAtHint updatedAt={data.updatedAt} isUnset={data.isUnset} corrupted={data.corrupted} />
      <FieldGroup className="mt-4">
        <Field>
          <FieldLabel htmlFor="work-capacity-weekly-hours">週の稼働時間 (h)</FieldLabel>
          <Input
            id="work-capacity-weekly-hours"
            name="weekly_hours"
            type="number"
            min={0}
            max={168}
            step={0.5}
            defaultValue={v?.weekly_hours ?? 40}
            required
          />
          <FieldDescription>カレンダーの「今週あと N 時間」の分母になります。</FieldDescription>
        </Field>
      </FieldGroup>
      <FieldError errors={state.error ? [{ message: state.error }] : undefined} className="mt-3" />
      <Button type="submit" disabled={isPending} className="mt-6">
        {isPending ? "保存中..." : "保存 (Cmd+S)"}
      </Button>
    </form>
  );
}

function NotificationsForm({
  data,
  formRef,
}: {
  data: SettingsMetaFor<"notifications">;
  formRef: (el: HTMLFormElement | null) => void;
}) {
  const [state, action, isPending] = useActionState(updateNotificationsAction, SETTINGS_FORM_INITIAL_STATE);
  useFormFeedback(state, "通知設定");
  const v = data.value;

  return (
    <form ref={formRef} action={action} className="max-w-xl">
      <input type="hidden" name="expected_updated_at" value={data.updatedAt ?? ""} />
      <UpdatedAtHint updatedAt={data.updatedAt} isUnset={data.isUnset} corrupted={data.corrupted} />
      <FieldGroup className="mt-4">
        <Field>
          <FieldLabel htmlFor="notif-inquiry-to">問い合わせ通知の宛先メール</FieldLabel>
          <Input id="notif-inquiry-to" name="inquiry_to" type="email" defaultValue={v?.inquiry_to ?? ""} required />
        </Field>
        <Field orientation="horizontal">
          <Checkbox
            id="notif-on-publish-failure"
            name="on_publish_failure"
            value="on"
            defaultChecked={v?.on_publish_failure ?? false}
          />
          <FieldContent>
            <FieldLabel htmlFor="notif-on-publish-failure">配信失敗・トークン失効もメール通知する</FieldLabel>
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
