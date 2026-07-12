"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import Link from "next/link";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { buildSimEstimateSnapshot } from "@/app/api/shop/lead/schema";
import type { SimulatorLeadReq, SimulatorLeadResponse } from "@/app/api/shop/lead/schema";
import { textEditableAttrs } from "@/components/site/editable-attrs";
import type { ResolvedTexts } from "@/modules/page-media/contracts";
import type { EstimateResult, PriceGrade, PriceSizeClass } from "@/modules/pricing/contracts";

/*
  canonical: docs/design/crm-suite/06-simulator.md §7.1 (状態機械・フィールド表・失敗時挙動・
  デザイントーン制約) / §7.3 (キーボード) / §7.4 (アクセシビリティ)。裁定 J6-(a)。

  インライン展開型のリードフォーム (結果パネル CTA 直下、モーダルなし)。旧クリップボード
  コピー UX (shop-simulator.tsx handleOrder) を置換する。

  状態機械: idle (非表示) → open (フォーム表示) → submitting (送信中disable)
    → 2xx: done (成功文言に置換、フォーム消去) / 4xx・5xx・network: open (エラー表示、入力保持)
  done → CTA 再クリックで open (再問い合わせ。入力値は保持したまま form_rendered_at のみ再設定)。
  Esc は open 時のみ idle へ戻す (入力値保持、フォーカスを CTA へ返す)。

  親 (shop-simulator.tsx) は imperative handle 経由で open() を呼ぶだけでよい設計にしている
  (CTA click は idle→open・done→open のどちらの遷移も同じ open() 呼び出し1本で表現できるため、
  親側で現在の phase を意識する必要がない)。

  "use client" のため facade.ts ("server-only") を import する <SlotText> は使えない。
  shop-simulator.tsx と同じ手動パターン (texts props + textEditableAttrs) で
  data-editable-text を付与し、視覚テキストエディタの編集対象を維持する。

  フォーム自体のクライアント側 zod スキーマ (zLeadFormSchema) は、既存 contact-form.tsx が
  zInquiryInput を直接 resolver に使わず PHONE_REGEX 等を独自に再宣言しているのと同じ、
  このコードベースで確立された慣行を踏襲したローカル宣言 (実装判断)。
  実際の契約検証は常にサーバ側の zSimulatorLeadReq.safeParse (route.ts 0-d) が正本であり、
  ここでの重複はクライアント側 UX 用バリデーションに過ぎない。
  tel/message はフォーム上は空文字列 "" を許容し、送信 payload 組み立て時に
  null へ変換する (zSimulatorLeadReq 側は nullable であり、native <input> が扱えない
  null を直接バインドしないための実装上の変換)。
*/

export type ShopLeadFormHandle = {
  open: () => void;
};

type LeadFormValues = {
  name: string;
  email: string;
  tel: string;
  message: string;
  privacyAgreed: boolean;
  // honeypot: 人間には見えない隠しフィールド。bot がここに値を入れると spam 扱いにする。
  website: string;
};

const DEFAULT_LEAD_FORM_VALUES: LeadFormValues = {
  name: "",
  email: "",
  tel: "",
  message: "",
  privacyAgreed: false,
  website: "",
};

// zSimulatorLeadReq.contact.tel (src/app/api/shop/lead/schema.ts) と同一の正規表現。
const PHONE_REGEX = /^0\d{1,4}-?\d{1,4}-?\d{3,4}$/;

const zLeadFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "お名前を入力してください")
    .max(50, "お名前は50字以内で入力してください"),
  email: z
    .string()
    .trim()
    .min(1, "メールアドレスを入力してください")
    .email("メールアドレスの形式が正しくありません")
    .max(120, "メールアドレスは120字以内で入力してください"),
  tel: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || PHONE_REGEX.test(v),
      "電話番号の形式が正しくありません（例: 090-1234-5678）",
    ),
  message: z.string().trim().max(2000, "補足メッセージは2000字以内で入力してください"),
  privacyAgreed: z.boolean().refine((v) => v === true, {
    message: "プライバシーポリシーへの同意が必要です",
  }),
  website: z.string(),
});

// rate_limits の集計単位は UTC 時単位 floor の固定 1 時間ウィンドウ (spam-guard.ts
// computeWindowStart)。429 時は「30秒 disable」ではなく「次の UTC 時境界まで disable」
// (06-simulator §7.1 v1.1 — 同一ウィンドウ内の再送は高確率で再 429 になるため撤回済み)。
const HOUR_MS = 60 * 60 * 1000;

function ShopLeadFormInner(
  {
    grade,
    size,
    quantity,
    optionKeys,
    result,
    texts,
    editMode,
    onRequestFocusCta,
  }: {
    grade: PriceGrade;
    size: PriceSizeClass;
    quantity: number;
    optionKeys: string[];
    result: EstimateResult;
    texts: ResolvedTexts;
    editMode: boolean;
    onRequestFocusCta: () => void;
  },
  ref: React.Ref<ShopLeadFormHandle>,
) {
  const [phase, setPhase] = useState<"idle" | "open" | "submitting" | "done">("idle");
  const [apiError, setApiError] = useState<string | null>(null);
  const [rateLimitedUntil, setRateLimitedUntil] = useState<number | null>(null);
  // フォーム描画 (open 遷移) 時刻。3 秒未満送信は bot 扱い (0-b stealth 判定)。
  const formRenderedAtRef = useRef<number>(Date.now());
  const successRef = useRef<HTMLDivElement>(null);

  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors },
  } = useForm<LeadFormValues>({
    resolver: zodResolver(zLeadFormSchema),
    defaultValues: DEFAULT_LEAD_FORM_VALUES,
  });

  useImperativeHandle(ref, () => ({
    open: () => {
      formRenderedAtRef.current = Date.now();
      setApiError(null);
      setPhase("open");
    },
  }));

  useEffect(() => {
    if (phase === "open") {
      setFocus("name");
    } else if (phase === "done") {
      successRef.current?.focus();
    }
  }, [phase, setFocus]);

  // 429 クールダウンの自動解除 (次の UTC 時境界に達したら再送信可能にする)。
  useEffect(() => {
    if (rateLimitedUntil === null) return;
    const remaining = rateLimitedUntil - Date.now();
    if (remaining <= 0) {
      setRateLimitedUntil(null);
      return;
    }
    const timer = window.setTimeout(() => setRateLimitedUntil(null), remaining);
    return () => window.clearTimeout(timer);
  }, [rateLimitedUntil]);

  async function onSubmit(values: LeadFormValues) {
    setPhase("submitting");
    setApiError(null);

    const snapshot = buildSimEstimateSnapshot({ grade, size, quantity, optionKeys, result });
    const payload: SimulatorLeadReq = {
      contact: {
        name: values.name,
        email: values.email,
        tel: values.tel === "" ? null : values.tel,
      },
      message: values.message === "" ? null : values.message,
      privacy_agreed: true,
      estimate: snapshot,
      honeypot: values.website,
      form_rendered_at: formRenderedAtRef.current,
    };

    let response: Response;
    try {
      response = await fetch("/api/shop/lead", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      // ネットワーク断・fetch 自体の失敗。入力値は保持し open へ戻す (06-simulator §7.1)。
      setApiError(texts["shop.simulator.lead.error.generic"].text);
      setPhase("open");
      return;
    }

    let body: SimulatorLeadResponse;
    try {
      body = (await response.json()) as SimulatorLeadResponse;
    } catch {
      setApiError(texts["shop.simulator.lead.error.generic"].text);
      setPhase("open");
      return;
    }

    if (body.ok) {
      setPhase("done");
      return;
    }

    if (body.code === "KMB-E105") {
      setRateLimitedUntil(Date.now() + (HOUR_MS - (Date.now() % HOUR_MS)));
      setApiError(texts["shop.simulator.lead.error.rate_limited"].text);
    } else if (body.code === "KMB-E101") {
      setApiError(texts["shop.simulator.lead.error.invalid"].text);
    } else {
      setApiError(texts["shop.simulator.lead.error.generic"].text);
    }
    setPhase("open");
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape" && phase === "open") {
      setPhase("idle");
      onRequestFocusCta();
    }
  }

  if (phase === "idle") {
    return null;
  }

  if (phase === "done") {
    return (
      <div
        ref={successRef}
        tabIndex={-1}
        className="mt-6 border border-hair bg-paper p-6 text-carbon outline-none sm:p-7"
        {...textEditableAttrs("shop.simulator.lead.success", editMode)}
      >
        <p className="text-[15px] leading-7">{texts["shop.simulator.lead.success"].text}</p>
      </div>
    );
  }

  const isSubmitting = phase === "submitting";
  const isRateLimited = rateLimitedUntil !== null;

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      onKeyDown={handleKeyDown}
      noValidate
      className="mt-6 border border-hair bg-paper p-6 text-carbon sm:p-7"
    >
      {apiError ? <p className="mb-4 text-[13px] text-destructive">{apiError}</p> : null}

      {/* honeypot: 画面上には表示せず、bot による自動入力のみを拾う (06-simulator §6.1 / §7.4) */}
      <div
        aria-hidden="true"
        className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden"
      >
        <label htmlFor="shop-lead-website">ウェブサイト</label>
        <input
          id="shop-lead-website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          {...register("website")}
        />
      </div>

      <div className="space-y-5">
        <div>
          <label
            htmlFor="shop-lead-name"
            className="font-mono text-[11px] tracking-[0.2em] text-carbon-soft"
            {...textEditableAttrs("shop.simulator.lead.name.label", editMode)}
          >
            {texts["shop.simulator.lead.name.label"].text}
          </label>
          <input
            id="shop-lead-name"
            type="text"
            autoComplete="name"
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? "shop-lead-name-error" : undefined}
            className="mt-2 w-full border border-hair bg-paper px-3 py-3 text-sm text-carbon"
            {...register("name")}
          />
          {errors.name ? (
            <p id="shop-lead-name-error" className="mt-1 text-[12px] text-destructive">
              {errors.name.message}
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="shop-lead-email"
            className="font-mono text-[11px] tracking-[0.2em] text-carbon-soft"
            {...textEditableAttrs("shop.simulator.lead.email.label", editMode)}
          >
            {texts["shop.simulator.lead.email.label"].text}
          </label>
          <input
            id="shop-lead-email"
            type="email"
            autoComplete="email"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "shop-lead-email-error" : undefined}
            className="mt-2 w-full border border-hair bg-paper px-3 py-3 text-sm text-carbon"
            {...register("email")}
          />
          {errors.email ? (
            <p id="shop-lead-email-error" className="mt-1 text-[12px] text-destructive">
              {errors.email.message}
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="shop-lead-tel"
            className="font-mono text-[11px] tracking-[0.2em] text-carbon-soft"
            {...textEditableAttrs("shop.simulator.lead.tel.label", editMode)}
          >
            {texts["shop.simulator.lead.tel.label"].text}
          </label>
          <input
            id="shop-lead-tel"
            type="tel"
            autoComplete="tel"
            aria-invalid={!!errors.tel}
            aria-describedby={errors.tel ? "shop-lead-tel-error" : undefined}
            className="mt-2 w-full border border-hair bg-paper px-3 py-3 text-sm text-carbon"
            {...register("tel")}
          />
          {errors.tel ? (
            <p id="shop-lead-tel-error" className="mt-1 text-[12px] text-destructive">
              {errors.tel.message}
            </p>
          ) : null}
        </div>

        <div>
          <label
            htmlFor="shop-lead-message"
            className="font-mono text-[11px] tracking-[0.2em] text-carbon-soft"
            {...textEditableAttrs("shop.simulator.lead.message.label", editMode)}
          >
            {texts["shop.simulator.lead.message.label"].text}
          </label>
          <textarea
            id="shop-lead-message"
            rows={4}
            aria-invalid={!!errors.message}
            aria-describedby={errors.message ? "shop-lead-message-error" : undefined}
            className="mt-2 w-full border border-hair bg-paper px-3 py-3 text-sm text-carbon"
            {...register("message")}
          />
          {errors.message ? (
            <p id="shop-lead-message-error" className="mt-1 text-[12px] text-destructive">
              {errors.message.message}
            </p>
          ) : null}
        </div>

        <div>
          <label className="flex cursor-pointer items-start gap-3 text-[13px] tracking-wider text-carbon">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--soul)]"
              aria-invalid={!!errors.privacyAgreed}
              aria-describedby={errors.privacyAgreed ? "shop-lead-privacy-error" : undefined}
              {...register("privacyAgreed")}
            />
            <span>
              <span {...textEditableAttrs("shop.simulator.lead.privacy.label", editMode)}>
                {texts["shop.simulator.lead.privacy.label"].text}
              </span>{" "}
              <Link
                href="/privacy"
                className="underline decoration-carbon-soft underline-offset-2 hover:text-soul"
              >
                （プライバシーポリシー）
              </Link>
            </span>
          </label>
          {errors.privacyAgreed ? (
            <p id="shop-lead-privacy-error" className="mt-1 text-[12px] text-destructive">
              {errors.privacyAgreed.message}
            </p>
          ) : null}
        </div>
      </div>

      <button
        type="submit"
        disabled={isSubmitting || isRateLimited}
        className="mt-6 flex w-full items-center justify-center gap-1 bg-carbon py-3.5 text-sm font-medium tracking-[0.12em] text-paper transition-colors hover:bg-carbon/85 disabled:cursor-not-allowed disabled:opacity-50"
        {...textEditableAttrs("shop.simulator.lead.submit", editMode)}
      >
        {isSubmitting ? "送信中…" : texts["shop.simulator.lead.submit"].text}
      </button>
    </form>
  );
}

export const ShopLeadForm = forwardRef(ShopLeadFormInner);
