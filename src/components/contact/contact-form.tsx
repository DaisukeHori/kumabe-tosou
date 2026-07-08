"use client";

import { useRef, useState } from "react";
import Link from "next/link";
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

/*
  Phase 1c: contact_inquiries への実保存 + 通知メール (Resend) に接続済み
  (cms-ai-pipeline.md §6.2 / §6.3)。honeypot 隠しフィールド + 送信最小時間 + IP rate limit で
  スパムを抑止する (§3.3)。
*/

const INQUIRY_TYPES = [
  { value: "construction", label: "施工依頼" },
  { value: "estimate", label: "見積もり相談" },
  { value: "material", label: "材料に関する質問" },
  { value: "other", label: "その他" },
] as const;

const INQUIRY_TYPE_VALUES = INQUIRY_TYPES.map((t) => t.value);
const INQUIRY_TYPE_ITEMS = INQUIRY_TYPES.map((t) => ({ label: t.label, value: t.value }));

const PHONE_REGEX = /^0\d{1,4}-?\d{1,4}-?\d{3,4}$/;

const contactFormSchema = z.object({
  name: z.string().trim().min(1, "お名前を入力してください"),
  email: z.email("正しいメールアドレスを入力してください"),
  phone: z
    .string()
    .trim()
    .refine((v) => v === "" || PHONE_REGEX.test(v), "正しい電話番号の形式で入力してください"),
  inquiryType: z
    .string()
    .refine((value) => (INQUIRY_TYPE_VALUES as readonly string[]).includes(value), {
      message: "お問い合わせ種別を選択してください",
    }),
  targetItem: z.string().trim().max(100, "100文字以内でご記入ください"),
  message: z
    .string()
    .trim()
    .min(10, "内容は10文字以上でご記入ください")
    .max(5000, "内容は5000文字以内でご記入ください"),
  agree: z.boolean().refine((value) => value === true, {
    message: "プライバシーポリシーへの同意が必要です",
  }),
  // honeypot: 人間には見えない隠しフィールド。bot がここに値を入れると spam 扱いにする。
  website: z.string().trim(),
});

type ContactFormValues = z.infer<typeof contactFormSchema>;

const DEFAULT_VALUES: ContactFormValues = {
  name: "",
  email: "",
  phone: "",
  inquiryType: "",
  targetItem: "",
  message: "",
  agree: false,
  website: "",
};

export function ContactForm() {
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // フォームが描画された時刻。送信最小時間 (3秒) の判定に使う (spam-guard.ts)。
  const formRenderedAtRef = useRef<number>(Date.now());
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
    const result = await submitContactFormAction({
      name: values.name,
      email: values.email,
      phone: values.phone,
      inquiryType: values.inquiryType,
      targetItem: values.targetItem,
      message: values.message,
      agree: values.agree,
      honeypot: values.website,
      formRenderedAt: formRenderedAtRef.current,
    });

    if (result.status === "success") {
      setSubmitted(true);
      reset(DEFAULT_VALUES);
      return;
    }

    if (result.status === "rate_limited") {
      setSubmitError(
        "送信回数の上限に達しました。しばらく時間をおいてから再度お試しください。",
      );
      return;
    }

    if (result.status === "invalid") {
      setError("root", { message: result.message });
      setSubmitError(result.message);
      return;
    }

    setSubmitError("送信に失敗しました。しばらくしてから再度お試しください。");
  }

  if (submitted) {
    return (
      <div className="border border-hair bg-paper p-8 sm:p-10">
        <span className="font-mono text-[11px] tracking-[0.22em] text-soul">
          STATUS — RECEIVED
        </span>
        <p className="mt-5 text-[15px] leading-[2.1] text-carbon-mid">
          お問い合わせを受け付けました。内容を確認のうえ、ご連絡いたします。
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-6 h-10 rounded-none border-carbon/40 bg-transparent px-5 tracking-[0.08em] text-carbon hover:bg-carbon hover:text-paper"
          onClick={() => setSubmitted(false)}
        >
          もう一度入力する
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
      <span className="font-mono text-[11px] tracking-[0.22em] text-soul">
        STATUS — CONTACT FORM
      </span>
      <p className="mt-5 text-[13px] leading-7 text-carbon-soft">
        必要事項をご入力のうえ送信してください。内容を確認し、担当より折り返しご連絡いたします。
      </p>

      <FieldGroup className="mt-8">
        {/* honeypot: 画面上には表示せず、bot による自動入力のみを拾う */}
        <div
          aria-hidden="true"
          className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden"
        >
          <label htmlFor="contact-website">ウェブサイト</label>
          <input
            id="contact-website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            {...register("website")}
          />
        </div>

        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="contact-name">
            お名前 <span className="text-destructive">*</span>
          </FieldLabel>
          <Input
            id="contact-name"
            placeholder="山田 太郎"
            autoComplete="name"
            aria-invalid={!!errors.name}
            {...register("name")}
          />
          <FieldError errors={errors.name ? [errors.name] : undefined} />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor="contact-email">
              メールアドレス <span className="text-destructive">*</span>
            </FieldLabel>
            <Input
              id="contact-email"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              aria-invalid={!!errors.email}
              {...register("email")}
            />
            <FieldError errors={errors.email ? [errors.email] : undefined} />
          </Field>

          <Field data-invalid={!!errors.phone}>
            <FieldLabel htmlFor="contact-phone">電話番号(任意)</FieldLabel>
            <Input
              id="contact-phone"
              type="tel"
              placeholder="090-1234-5678"
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
                お問い合わせ種別 <span className="text-destructive">*</span>
              </FieldLabel>
              <Select
                items={INQUIRY_TYPE_ITEMS}
                value={field.value || null}
                onValueChange={(value) => field.onChange(value ?? "")}
              >
                <SelectTrigger
                  id="contact-inquiry-type"
                  aria-invalid={fieldState.invalid}
                  onBlur={field.onBlur}
                  className="w-full sm:w-64"
                >
                  <SelectValue placeholder="選択してください" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {INQUIRY_TYPES.map((type) => (
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
            対象品目(任意)
          </FieldLabel>
          <Input
            id="contact-target-item"
            placeholder="例: スマホケース、車両パーツ など"
            aria-invalid={!!errors.targetItem}
            {...register("targetItem")}
          />
          <FieldError
            errors={errors.targetItem ? [errors.targetItem] : undefined}
          />
        </Field>

        <Field data-invalid={!!errors.message}>
          <FieldLabel htmlFor="contact-message">
            内容 <span className="text-destructive">*</span>
          </FieldLabel>
          <Textarea
            id="contact-message"
            placeholder="ご相談内容、サイズ・個数・希望グレード、造形データの有無などをご記入ください。"
            className="min-h-40"
            aria-invalid={!!errors.message}
            {...register("message")}
          />
          <FieldDescription>
            10文字以上5000文字以内でご記入ください。
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
                <FieldLabel htmlFor="contact-agree">
                  <Link
                    href="/privacy"
                    className="underline underline-offset-4 hover:text-carbon"
                  >
                    プライバシーポリシー
                  </Link>
                  に同意する <span className="text-destructive">*</span>
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
        <p className="mt-6 text-sm text-destructive">{submitError}</p>
      ) : null}

      <Button
        type="submit"
        disabled={isSubmitting}
        className="mt-8 h-11 rounded-none bg-carbon px-8 tracking-[0.12em] text-paper hover:bg-carbon/85"
      >
        送信する
      </Button>
    </form>
  );
}
