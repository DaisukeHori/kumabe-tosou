"use client";

import { useState } from "react";
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

/*
  Phase 0.3 モック用フォーム。
  実送信は行わず、console.log への出力のみ(外部送信は絶対に行わない)。
  Phase 1 で Supabase 接続に置き換える予定。
*/

const INQUIRY_TYPES = [
  "施工依頼",
  "見積もり相談",
  "材料に関する質問",
  "その他",
] as const;

const INQUIRY_TYPE_ITEMS = INQUIRY_TYPES.map((label) => ({
  label,
  value: label as string,
}));

const contactFormSchema = z.object({
  name: z.string().trim().min(1, "お名前を入力してください"),
  email: z.email("正しいメールアドレスを入力してください"),
  phone: z.string().trim(),
  inquiryType: z
    .string()
    .refine((value) => (INQUIRY_TYPES as readonly string[]).includes(value), {
      message: "お問い合わせ種別を選択してください",
    }),
  targetItem: z.string().trim(),
  message: z
    .string()
    .trim()
    .min(10, "内容は10文字以上でご記入ください")
    .max(2000, "内容は2000文字以内でご記入ください"),
  agree: z.boolean().refine((value) => value === true, {
    message: "プライバシーポリシーへの同意が必要です",
  }),
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
};

export function ContactForm() {
  const [submitted, setSubmitted] = useState(false);
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: DEFAULT_VALUES,
  });

  function onSubmit(values: ContactFormValues) {
    // モック送信: 外部への送信は一切行わない (Phase 1 で Supabase 接続に置き換え予定)
    console.log("[MOCK] contact form submit", values);
    setSubmitted(true);
    reset(DEFAULT_VALUES);
  }

  if (submitted) {
    return (
      <div className="border border-hair bg-paper p-8 sm:p-10">
        <span className="font-mono text-[11px] tracking-[0.22em] text-soul">
          STATUS — RECEIVED (MOCK)
        </span>
        <p className="mt-5 text-[15px] leading-[2.1] text-carbon-mid">
          お問い合わせを受け付けました(モック)
        </p>
        <p className="mt-3 text-xs leading-6 text-carbon-soft">
          ※
          このフォームはモック段階のため、実際の送信・保存は行われていません。正式受付開始までしばらくお待ちください。
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
        STATUS — MOCK FORM (PHASE 0.3)
      </span>
      <p className="mt-5 text-[13px] leading-7 text-carbon-soft">
        現在はモック段階のため、送信ボタンを押しても外部への送信は行われません(送信内容はブラウザのコンソールにのみ出力されます)。
      </p>

      <FieldGroup className="mt-8">
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
                      <SelectItem key={type} value={type}>
                        {type}
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
            10文字以上2000文字以内でご記入ください。
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

      <Button
        type="submit"
        disabled={isSubmitting}
        className="mt-8 h-11 rounded-none bg-carbon px-8 tracking-[0.12em] text-paper hover:bg-carbon/85"
      >
        送信する(モック)
      </Button>
    </form>
  );
}
