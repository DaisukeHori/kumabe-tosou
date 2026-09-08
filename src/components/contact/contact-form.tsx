"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { submitContactFormAction } from "@/components/contact/actions";
import { shouldToggleConsentFromLabelClick } from "@/components/contact/consent-label";
import { buildFormRenderedAt } from "@/components/contact/form-timing";
import { resolveSubmitOutcome } from "@/components/contact/submit-outcome";
import { textEditableAttrs } from "@/components/site/editable-attrs";
import { renderRichInline } from "@/components/site/rich-text";
import type { ResolvedTexts } from "@/modules/page-media/contracts";

/*
  Phase 1c: contact_inquiries への実保存 + 通知メール (Resend) に接続済み
  (cms-ai-pipeline.md §6.2 / §6.3)。honeypot 隠しフィールド + 送信最小時間 + IP rate limit で
  スパムを抑止する (§3.3)。

  v2 Wave 1 (docs/design/visual-text-editor-v2.md §5): このコンポーネントは "use client" で
  あり、facade.ts ("server-only") を import する <SlotText>/<SlotRichText> を直接使うと
  クライアントバンドルがビルド時に壊れる。そのため ContactPageBody から
  resolveAllTexts() 済みの `texts: ResolvedTexts` (全スロット分) と editMode を props で
  受け取り、"server-only" を持たない純関数 textEditableAttrs (editable-attrs.ts) だけを
  使って data-editable-text を手動で付与する (shop-simulator.tsx と同じパターン)。
  同意チェックボックスの文言 (contact.form.consent.text) のみ kind="rich" (リンクトークン)
  のため、client-safe な renderRichInline (rich-text.tsx) で描画する。
  お名前・メールアドレス・お問い合わせ種別・内容の必須マーク (`<span className=
  "text-destructive">*</span>`) は presentational な構造として残し、ラベル文字だけを
  スロット化する (視覚テキストエディタ v2 §4.2 の分割方針)。
*/

const INQUIRY_TYPE_VALUES = ["construction", "estimate", "material", "other"] as const;

const PHONE_REGEX = /^0\d{1,4}-?\d{1,4}-?\d{3,4}$/;

type ContactFormValues = {
  name: string;
  email: string;
  phone: string;
  inquiryType: string;
  targetItem: string;
  message: string;
  agree: boolean;
  // honeypot: 人間には見えない隠しフィールド。bot がここに値を入れると spam 扱いにする。
  // ブラウザ / パスワードマネージャの自動入力を誘発しない名前にする ("website" は
  // 自動入力候補になりやすく、実在の利用者の送信が spam 判定される事故につながる)。
  contact_extra_note: string;
};

const DEFAULT_VALUES: ContactFormValues = {
  name: "",
  email: "",
  phone: "",
  inquiryType: "",
  targetItem: "",
  message: "",
  agree: false,
  contact_extra_note: "",
};

export function ContactForm({
  texts,
  editMode,
  serverRenderedAt,
}: {
  texts: ResolvedTexts;
  editMode: boolean;
  /** サーバー (page.tsx) がこのページを描画した時刻 (epoch ms)。送信最小時間の基準 */
  serverRenderedAt: number;
}) {
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // 結果 (成功 / エラー) の表示位置。送信後にここへスクロールして「無反応」に見せない。
  const errorRef = useRef<HTMLParagraphElement | null>(null);
  const successRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (submitted) {
      successRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [submitted]);

  useEffect(() => {
    if (submitError) {
      errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [submitError]);

  const inquiryTypeItems = useMemo(
    () =>
      INQUIRY_TYPE_VALUES.map((value) => ({
        value,
        label: texts[`contact.form.option.${value}`].text,
      })),
    [texts],
  );

  const contactFormSchema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, texts["contact.form.error.name"].text),
        email: z.email(texts["contact.form.error.email"].text),
        phone: z
          .string()
          .trim()
          .refine(
            (v) => v === "" || PHONE_REGEX.test(v),
            texts["contact.form.error.phone"].text,
          ),
        inquiryType: z
          .string()
          .refine((value) => (INQUIRY_TYPE_VALUES as readonly string[]).includes(value), {
            message: texts["contact.form.error.inquiryType"].text,
          }),
        targetItem: z.string().trim().max(100, texts["contact.form.error.targetItem"].text),
        message: z
          .string()
          .trim()
          .min(10, texts["contact.form.error.message.min"].text)
          .max(5000, texts["contact.form.error.message.max"].text),
        agree: z.boolean().refine((value) => value === true, {
          message: texts["contact.form.error.agree"].text,
        }),
        // honeypot: 人間には見えない隠しフィールド。bot がここに値を入れると spam 扱いにする。
        contact_extra_note: z.string().trim(),
      }),
    [texts],
  );

  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: DEFAULT_VALUES,
  });

  async function onSubmit(values: ContactFormValues) {
    setSubmitError(null);

    // Server Action の呼び出しは必ず try/catch で包む。500 / デプロイ跨ぎの Action ID
    // 不一致 / 通信断のとき、この await は reject する。catch が無いと react-hook-form 側で
    // 例外が飲み込まれ、画面には何のフィードバックも出ない (=「押しても無反応」) ため、
    // 例外も戻り値も同じ resolveSubmitOutcome (純関数) に集約して必ず表示へつなげる。
    const attempt = await submitContactFormAction({
      name: values.name,
      email: values.email,
      phone: values.phone,
      inquiryType: values.inquiryType,
      targetItem: values.targetItem,
      message: values.message,
      agree: values.agree,
      honeypot: values.contact_extra_note,
      // クライアントの Date.now() ではなくサーバー描画時刻を渡す (時計ずれ対策)。
      formRenderedAt: buildFormRenderedAt({ serverRenderedAt }),
    }).then(
      (result) => ({ ok: true as const, result }),
      (thrown: unknown) => {
        console.error("[contact] 送信に失敗しました (Server Action 呼び出しが例外):", thrown);
        return { ok: false as const, thrown };
      },
    );

    const outcome = resolveSubmitOutcome(attempt);

    if (outcome.kind === "success") {
      setSubmitted(true);
      reset(DEFAULT_VALUES);
      return;
    }

    if (outcome.rootMessage !== undefined) {
      // 表示文言はサーバの生文字列ではなく registry (contact.form.error.invalid) から
      // 取得する (site-public は inquiryFacade 以外の他モジュール facade を import できない
      // 制約があるため、actions.ts 側は元の文字列のまま維持し、表示側だけ registry を参照する)。
      setError("root", { message: outcome.rootMessage });
    }
    setSubmitError(texts[outcome.textKey].text);
  }

  if (submitted) {
    return (
      <div ref={successRef} className="border border-hair bg-paper p-8 sm:p-10">
        <span
          className="font-mono text-[11px] tracking-[0.22em] text-soul"
          {...textEditableAttrs("contact.form.badge.received", editMode)}
        >
          {texts["contact.form.badge.received"].text}
        </span>
        <p
          className="mt-5 text-[15px] leading-[2.1] text-carbon-mid"
          {...textEditableAttrs("contact.form.success.message", editMode)}
        >
          {texts["contact.form.success.message"].text}
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-6 h-10 rounded-none border-carbon/40 bg-transparent px-5 tracking-[0.08em] text-carbon hover:bg-carbon hover:text-paper"
          onClick={() => setSubmitted(false)}
        >
          <span {...textEditableAttrs("contact.form.button.reset", editMode)}>
            {texts["contact.form.button.reset"].text}
          </span>
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="border border-hair bg-paper p-8 sm:p-10"
    >
      <span
        className="font-mono text-[11px] tracking-[0.22em] text-soul"
        {...textEditableAttrs("contact.form.badge.form", editMode)}
      >
        {texts["contact.form.badge.form"].text}
      </span>
      <p
        className="mt-5 text-[13px] leading-7 text-carbon-soft"
        {...textEditableAttrs("contact.form.intro", editMode)}
      >
        {texts["contact.form.intro"].text}
      </p>

      <FieldGroup className="mt-8">
        {/* honeypot: 画面上には表示せず、bot による自動入力のみを拾う */}
        <div
          aria-hidden="true"
          className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden"
        >
          <label htmlFor="contact-extra-note">ウェブサイト</label>
          <input
            id="contact-extra-note"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
            {...register("contact_extra_note")}
          />
        </div>

        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="contact-name">
            <span {...textEditableAttrs("contact.form.label.name", editMode)}>
              {texts["contact.form.label.name"].text}
            </span>{" "}
            <span className="text-destructive">*</span>
          </FieldLabel>
          <Input
            id="contact-name"
            placeholder={texts["contact.form.placeholder.name"].text}
            autoComplete="name"
            aria-invalid={!!errors.name}
            {...register("name")}
          />
          <FieldError errors={errors.name ? [errors.name] : undefined} />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor="contact-email">
              <span {...textEditableAttrs("contact.form.label.email", editMode)}>
                {texts["contact.form.label.email"].text}
              </span>{" "}
              <span className="text-destructive">*</span>
            </FieldLabel>
            <Input
              id="contact-email"
              type="email"
              placeholder={texts["contact.form.placeholder.email"].text}
              autoComplete="email"
              aria-invalid={!!errors.email}
              {...register("email")}
            />
            <FieldError errors={errors.email ? [errors.email] : undefined} />
          </Field>

          <Field data-invalid={!!errors.phone}>
            <FieldLabel htmlFor="contact-phone">
              <span {...textEditableAttrs("contact.form.label.phone", editMode)}>
                {texts["contact.form.label.phone"].text}
              </span>
            </FieldLabel>
            <Input
              id="contact-phone"
              type="tel"
              placeholder={texts["contact.form.placeholder.phone"].text}
              autoComplete="tel"
              aria-invalid={!!errors.phone}
              {...register("phone")}
            />
            <FieldError errors={errors.phone ? [errors.phone] : undefined} />
          </Field>
        </div>

        <Controller
          control={control}
          name="inquiryType"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="contact-inquiry-type">
                <span {...textEditableAttrs("contact.form.label.inquiryType", editMode)}>
                  {texts["contact.form.label.inquiryType"].text}
                </span>{" "}
                <span className="text-destructive">*</span>
              </FieldLabel>
              <Select
                items={inquiryTypeItems}
                value={field.value || null}
                onValueChange={(value) => field.onChange(value ?? "")}
              >
                <SelectTrigger
                  id="contact-inquiry-type"
                  aria-invalid={fieldState.invalid}
                  onBlur={field.onBlur}
                  className="w-full sm:w-64"
                >
                  <SelectValue placeholder={texts["contact.form.placeholder.inquiryType"].text} />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {inquiryTypeItems.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldError
                errors={fieldState.error ? [fieldState.error] : undefined}
              />
            </Field>
          )}
        />

        <Field data-invalid={!!errors.targetItem}>
          <FieldLabel htmlFor="contact-target-item">
            <span {...textEditableAttrs("contact.form.label.targetItem", editMode)}>
              {texts["contact.form.label.targetItem"].text}
            </span>
          </FieldLabel>
          <Input
            id="contact-target-item"
            placeholder={texts["contact.form.placeholder.targetItem"].text}
            aria-invalid={!!errors.targetItem}
            {...register("targetItem")}
          />
          <FieldError
            errors={errors.targetItem ? [errors.targetItem] : undefined}
          />
        </Field>

        <Field data-invalid={!!errors.message}>
          <FieldLabel htmlFor="contact-message">
            <span {...textEditableAttrs("contact.form.label.message", editMode)}>
              {texts["contact.form.label.message"].text}
            </span>{" "}
            <span className="text-destructive">*</span>
          </FieldLabel>
          <Textarea
            id="contact-message"
            placeholder={texts["contact.form.placeholder.message"].text}
            className="min-h-40"
            aria-invalid={!!errors.message}
            {...register("message")}
          />
          <FieldDescription>
            <span {...textEditableAttrs("contact.form.description.message", editMode)}>
              {texts["contact.form.description.message"].text}
            </span>
          </FieldDescription>
          <FieldError errors={errors.message ? [errors.message] : undefined} />
        </Field>

        <Controller
          control={control}
          name="agree"
          render={({ field, fieldState }) => (
            <Field orientation="horizontal" data-invalid={fieldState.invalid}>
              <Checkbox
                id="contact-agree"
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked)}
                aria-invalid={fieldState.invalid}
              />
              <FieldContent>
                <FieldLabel
                  htmlFor="contact-agree"
                  // ラベル文字クリックでチェックを切り替える。base-ui の Checkbox の実体は
                  // aria-hidden の <input> で、label の既定動作 (htmlFor 先の活性化) では
                  // トグルされないため明示的に処理する。文中のリンク上のクリックだけは
                  // 除外し、別タブでプライバシーポリシーを開く動作を優先する
                  // (リンク側でも stopPropagation 済み。二重防御)。判定は純関数に切り出し、
                  // tests/contact-consent-label.test.ts で両方向を固定している。
                  onClick={(event) => {
                    if (!shouldToggleConsentFromLabelClick(event.target)) return;
                    event.preventDefault();
                    field.onChange(!field.value);
                  }}
                >
                  <span {...textEditableAttrs("contact.form.consent.text", editMode)}>
                    {/* label 内のリンクは別タブで開き、クリックを checkbox へ伝播させない
                        (同一タブ遷移で入力内容が消えるのを防ぐ) */}
                    {renderRichInline(texts["contact.form.consent.text"].text, {
                      openLinksInNewTab: true,
                    })}
                  </span>{" "}
                  <span className="text-destructive">*</span>
                </FieldLabel>
                <FieldError
                  errors={fieldState.error ? [fieldState.error] : undefined}
                />
              </FieldContent>
            </Field>
          )}
        />
      </FieldGroup>

      {submitError ? (
        <p
          ref={errorRef}
          role="alert"
          aria-live="assertive"
          className="mt-6 text-sm text-destructive"
        >
          {submitError}
        </p>
      ) : null}

      <Button
        type="submit"
        disabled={isSubmitting}
        aria-busy={isSubmitting}
        className="mt-8 h-11 rounded-none bg-carbon px-8 tracking-[0.12em] text-paper hover:bg-carbon/85"
      >
        {isSubmitting ? (
          <span {...textEditableAttrs("contact.form.button.submitting", editMode)}>
            {texts["contact.form.button.submitting"].text}
          </span>
        ) : (
          <span {...textEditableAttrs("contact.form.button.submit", editMode)}>
            {texts["contact.form.button.submit"].text}
          </span>
        )}
      </Button>
    </form>
  );
}
