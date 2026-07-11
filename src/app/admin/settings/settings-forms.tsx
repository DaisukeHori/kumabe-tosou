"use client";

import { useActionState, useEffect, useRef, useState } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { AiKeyMeta } from "@/modules/ai-providers/contracts";
import type { SettingsKey, SettingsValue } from "@/modules/settings/contracts";

import {
  updateCompanySettingsAction,
  updateHeroSettingsAction,
  updateNotificationsAction,
  updateOpsLimitsAction,
  updateSeoDefaultsAction,
} from "./actions";
import { AiSettingsTab } from "./ai-tab";
import { SETTINGS_FORM_INITIAL_STATE, type SettingsFormState } from "./form-state";

export type SettingsMetaFor<K extends SettingsKey> = {
  value: SettingsValue<K> | null;
  updatedAt: string | null;
  isUnset: boolean;
};

export type SettingsTabsData = {
  company: SettingsMetaFor<"company">;
  hero: SettingsMetaFor<"hero">;
  seo_defaults: SettingsMetaFor<"seo_defaults">;
  ops_limits: SettingsMetaFor<"ops_limits">;
  notifications: SettingsMetaFor<"notifications">;
};

/**
 * "ai" は site_settings の SettingsKey ではなく ai-providers 由来のタブのため、別ユニオンで扱う。
 * #45 (07-contracts-delta §D5) で SettingsKey は 11 キーに拡張されたが、本管理画面がタブとして
 * 描画するのは従来の 5 キーのみ (analytics/branding 等の新規 6 キーのタブ・Server Actions は
 * #46/#47 のスコープ)。SettingsKey をそのまま使うと未実装タブの型要求が漏れ伝播するため、
 * この画面が実際に扱うキーだけの明示ユニオンに固定する。
 */
type TabKey = Extract<SettingsKey, "company" | "hero" | "seo_defaults" | "ops_limits" | "notifications"> | "ai";

const TAB_LABELS: Record<TabKey, string> = {
  company: "会社情報",
  hero: "ヒーロー",
  seo_defaults: "SEO既定値",
  ops_limits: "運用上限",
  notifications: "通知",
  ai: "AI",
};

/** フォーム共通のフィードバック処理 (成功トースト/エラー表示) */
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

export function SettingsTabs({ data, aiKeys }: { data: SettingsTabsData; aiKeys: AiKeyMeta[] }) {
  const [active, setActive] = useState<TabKey>("company");
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
    <Tabs value={active} onValueChange={(v) => setActive(v as TabKey)}>
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
          formRef={(el) => {
            formRefs.current.seo_defaults = el;
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
      <UpdatedAtHint updatedAt={data.updatedAt} isUnset={data.isUnset} />
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
      <UpdatedAtHint updatedAt={data.updatedAt} isUnset={data.isUnset} />
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
  formRef,
}: {
  data: SettingsMetaFor<"seo_defaults">;
  formRef: (el: HTMLFormElement | null) => void;
}) {
  const [state, action, isPending] = useActionState(updateSeoDefaultsAction, SETTINGS_FORM_INITIAL_STATE);
  useFormFeedback(state, "SEO既定値");
  const v = data.value;

  return (
    <form ref={formRef} action={action} className="max-w-xl">
      <input type="hidden" name="expected_updated_at" value={data.updatedAt ?? ""} />
      <UpdatedAtHint updatedAt={data.updatedAt} isUnset={data.isUnset} />
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
          <FieldLabel htmlFor="seo-og-media-id">OGP 画像 media ID</FieldLabel>
          <Input id="seo-og-media-id" name="og_media_id" defaultValue={v?.og_media_id ?? ""} required placeholder="uuid" />
        </Field>
      </FieldGroup>
      <FieldError errors={state.error ? [{ message: state.error }] : undefined} className="mt-3" />
      <Button type="submit" disabled={isPending} className="mt-6">
        {isPending ? "保存中..." : "保存 (Cmd+S)"}
      </Button>
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
      <UpdatedAtHint updatedAt={data.updatedAt} isUnset={data.isUnset} />
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
      <UpdatedAtHint updatedAt={data.updatedAt} isUnset={data.isUnset} />
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
