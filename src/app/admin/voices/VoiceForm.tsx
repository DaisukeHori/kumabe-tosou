"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { zVoiceInput, type ContentStatus, type VoiceInput } from "@/modules/content/contracts";

import { createVoiceAction, transitionVoiceAction, updateVoiceAction } from "./actions";
import type { SimpleMediaItem } from "./media-lookup";

type Props = {
  mode: "create" | "edit";
  voiceId?: string;
  status?: ContentStatus;
  updatedAt?: string;
  initialValues: VoiceInput;
  mediaItems: SimpleMediaItem[];
};

const NEXT_TRANSITIONS: Record<ContentStatus, ContentStatus[]> = {
  draft: ["review"],
  review: ["draft", "published"],
  published: ["archived"],
  archived: ["published"],
};

const STATUS_LABEL: Record<ContentStatus, string> = {
  draft: "下書き",
  review: "レビュー待ち",
  published: "公開中",
  archived: "アーカイブ",
};

const TRANSITION_BUTTON_LABEL: Record<ContentStatus, string> = {
  draft: "下書きに戻す",
  review: "レビューへ提出",
  published: "公開する",
  archived: "アーカイブする",
};

/** 星評価入力。ネイティブ radio group のためキーボード (←→/Tab) で選択可能 */
function StarRatingInput({ value, onChange }: { value: number; onChange: (rating: number) => void }) {
  return (
    <div role="radiogroup" aria-label="評価 (1〜5)" className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <label key={star} className="cursor-pointer text-2xl leading-none">
          <input
            type="radio"
            name="voice-rating"
            value={star}
            checked={value === star}
            onChange={() => onChange(star)}
            className="sr-only"
          />
          <span aria-hidden="true" className={value >= star ? "text-primary" : "text-muted-foreground"}>
            {value >= star ? "★" : "☆"}
          </span>
          <span className="sr-only">{star}</span>
        </label>
      ))}
    </div>
  );
}

export function VoiceForm({ mode, voiceId, status, updatedAt, initialValues, mediaItems }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [currentUpdatedAt, setCurrentUpdatedAt] = useState(updatedAt);
  const [currentStatus, setCurrentStatus] = useState<ContentStatus>(status ?? "draft");
  const [reservedPublishedAt, setReservedPublishedAt] = useState("");

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<VoiceInput>({ resolver: zodResolver(zVoiceInput), defaultValues: initialValues });

  function handleWriteError(result: { ok: false; code: string; detail?: string }) {
    if (result.code === "KMB-E103") {
      setServerError(
        "他の人がこの内容を更新しています。ページを再読み込みして最新の内容を確認してください。",
      );
      return;
    }
    setServerError(result.detail ?? "保存に失敗しました。");
  }

  async function onSubmit(values: VoiceInput) {
    setServerError(null);
    setNotice(null);
    startTransition(async () => {
      if (mode === "create") {
        const result = await createVoiceAction(values);
        if (!result.ok) {
          handleWriteError(result);
          return;
        }
        router.push(`/admin/voices/${result.value.id}`);
        return;
      }

      const result = await updateVoiceAction(voiceId!, values, currentUpdatedAt!);
      if (!result.ok) {
        handleWriteError(result);
        return;
      }
      setCurrentUpdatedAt(result.value.updated_at);
      setNotice("保存しました。");
      router.refresh();
    });
  }

  function onTransition(to: ContentStatus) {
    if (!voiceId || !currentUpdatedAt) return;
    setServerError(null);
    setNotice(null);
    startTransition(async () => {
      const publishedAtIso =
        to === "published" && currentStatus === "review" && reservedPublishedAt
          ? new Date(reservedPublishedAt).toISOString()
          : null;
      const result = await transitionVoiceAction(
        voiceId,
        { to, published_at: publishedAtIso },
        currentUpdatedAt,
      );
      if (!result.ok) {
        setServerError(result.detail ?? "状態変更に失敗しました。");
        return;
      }
      setCurrentUpdatedAt(result.value.updated_at);
      setCurrentStatus(to);
      setNotice(`状態を「${STATUS_LABEL[to]}」に変更しました。`);
      router.refresh();
    });
  }

  // Cmd+S / Ctrl+S で保存 (cms-ai-pipeline.md §5.1)
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSubmit(onSubmit)();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleSubmit]);

  return (
    <div className="max-w-3xl space-y-6">
      {mode === "edit" && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 p-3">
          <span className="text-sm">
            現在の状態: <strong>{STATUS_LABEL[currentStatus]}</strong>
          </span>
          {NEXT_TRANSITIONS[currentStatus].map((to) => (
            <span key={to} className="flex items-center gap-2">
              {to === "published" && currentStatus === "review" && (
                <input
                  type="datetime-local"
                  value={reservedPublishedAt}
                  onChange={(e) => setReservedPublishedAt(e.target.value)}
                  className="h-8 rounded-lg border border-input bg-transparent px-2 text-xs"
                  aria-label="予約公開日時 (任意、未指定は即時公開)"
                />
              )}
              <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => onTransition(to)}>
                {TRANSITION_BUTTON_LABEL[to]}
              </Button>
            </span>
          ))}
        </div>
      )}

      {serverError && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {serverError}
        </div>
      )}
      {notice && (
        <div role="status" className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
          {notice}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-6">
        <FieldGroup>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field data-invalid={!!errors.customer_initial}>
              <FieldLabel htmlFor="voice-customer-initial">お客様イニシャル</FieldLabel>
              <Input
                id="voice-customer-initial"
                placeholder="例: K.T"
                aria-invalid={!!errors.customer_initial}
                {...register("customer_initial")}
              />
              <FieldError errors={errors.customer_initial ? [errors.customer_initial] : undefined} />
            </Field>

            <Field data-invalid={!!errors.region}>
              <FieldLabel htmlFor="voice-region">地域</FieldLabel>
              <Input id="voice-region" placeholder="例: 福岡県" aria-invalid={!!errors.region} {...register("region")} />
              <FieldError errors={errors.region ? [errors.region] : undefined} />
            </Field>
          </div>

          <Controller
            control={control}
            name="rating"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel>評価</FieldLabel>
                <StarRatingInput value={field.value} onChange={field.onChange} />
                <FieldError errors={fieldState.error ? [fieldState.error] : undefined} />
              </Field>
            )}
          />

          <Field data-invalid={!!errors.body}>
            <FieldLabel htmlFor="voice-body">本文</FieldLabel>
            <Textarea id="voice-body" className="min-h-32" aria-invalid={!!errors.body} {...register("body")} />
            <FieldDescription>2000文字以内</FieldDescription>
            <FieldError errors={errors.body ? [errors.body] : undefined} />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field data-invalid={!!errors.item}>
              <FieldLabel htmlFor="voice-item">施工品目 (任意)</FieldLabel>
              <Input
                id="voice-item"
                aria-invalid={!!errors.item}
                {...register("item", { setValueAs: (v: string) => (v === "" ? null : v) })}
              />
              <FieldError errors={errors.item ? [errors.item] : undefined} />
            </Field>

            <Field data-invalid={!!errors.sort_order}>
              <FieldLabel htmlFor="voice-sort-order">表示順 (小さいほど先頭)</FieldLabel>
              <Input
                id="voice-sort-order"
                type="number"
                min={0}
                aria-invalid={!!errors.sort_order}
                {...register("sort_order", { valueAsNumber: true })}
              />
              <FieldError errors={errors.sort_order ? [errors.sort_order] : undefined} />
            </Field>
          </div>

          <Field data-invalid={!!errors.photo_media_id}>
            <FieldLabel htmlFor="voice-photo-media-id">お客様写真 media_id (任意)</FieldLabel>
            <Input
              id="voice-photo-media-id"
              placeholder="media テーブルの id (uuid)"
              aria-invalid={!!errors.photo_media_id}
              {...register("photo_media_id", { setValueAs: (v: string) => (v === "" ? null : v) })}
            />
            <FieldError errors={errors.photo_media_id ? [errors.photo_media_id] : undefined} />
          </Field>

          {mediaItems.length > 0 && (
            <div className="rounded-lg border border-border p-3">
              <p className="mb-2 text-xs text-muted-foreground">
                既存メディア一覧 (簡易版。id をコピーして写真欄に貼り付けてください)
              </p>
              <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
                {mediaItems.map((m) => (
                  <li key={m.id} className="flex items-center gap-2 font-mono">
                    <span className="truncate">{m.id}</span>
                    <span className="shrink-0 text-muted-foreground">{m.alt || "(alt未設定)"}</span>
                    {m.is_placeholder && <span className="shrink-0 text-muted-foreground">[仮素材]</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </FieldGroup>

        <Button type="submit" disabled={isPending}>
          {mode === "create" ? "作成する" : "保存する (Cmd/Ctrl+S)"}
        </Button>
      </form>
    </div>
  );
}
