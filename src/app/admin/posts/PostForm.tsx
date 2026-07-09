"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import ReactMarkdown from "react-markdown";

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
import { MediaPicker, type PickerMediaItem } from "@/app/admin/_ui/media-picker";

import { zPostInput, type ContentStatus, type PostInput, type PostKind } from "@/modules/content/contracts";

import { createPostAction, transitionPostAction, updatePostAction } from "./actions";

type Props = {
  mode: "create" | "edit";
  postId?: string;
  status?: ContentStatus;
  updatedAt?: string;
  initialValues: PostInput;
  mediaItems: PickerMediaItem[];
  mediaNextCursor?: string | null;
};

const KIND_LABEL: Record<PostKind, string> = {
  reading: "読みもの",
  news: "お知らせ",
  blog: "AIブログ",
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

export function PostForm({
  mode,
  postId,
  status,
  updatedAt,
  initialValues,
  mediaItems,
  mediaNextCursor = null,
}: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [currentUpdatedAt, setCurrentUpdatedAt] = useState(updatedAt);
  const [currentStatus, setCurrentStatus] = useState<ContentStatus>(status ?? "draft");
  const [reservedPublishedAt, setReservedPublishedAt] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  // 初期一覧 (mediaItems) に加え、ダイアログの「もっと見る」で追加取得した分もここへマージする。
  const [mediaCatalog, setMediaCatalog] = useState<PickerMediaItem[]>(mediaItems);
  const [catalogNextCursor, setCatalogNextCursor] = useState<string | null>(mediaNextCursor);

  function handleMediaItemsLoaded(items: PickerMediaItem[], nextCursor: string | null) {
    setMediaCatalog((prev) => {
      const known = new Set(prev.map((p) => p.id));
      const additions = items.filter((item) => !known.has(item.id));
      return additions.length > 0 ? [...prev, ...additions] : prev;
    });
    setCatalogNextCursor(nextCursor);
  }

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    setError,
    formState: { errors },
  } = useForm<PostInput>({ resolver: zodResolver(zPostInput), defaultValues: initialValues });

  const body = watch("body");
  const coverMediaId = watch("cover_media_id");
  const coverItem = mediaCatalog.find((m) => m.id === coverMediaId) ?? null;

  function handleWriteError(result: { ok: false; code: string; detail?: string }) {
    if (result.code === "KMB-E102") {
      setError("slug", {
        message: `この slug は既に使用されています。代替候補: ${result.detail}`,
      });
      return;
    }
    if (result.code === "KMB-E103") {
      setServerError(
        "他の人がこの内容を更新しています。ページを再読み込みして最新の内容を確認してください。",
      );
      return;
    }
    setServerError(result.detail ?? "保存に失敗しました。");
  }

  async function onSubmit(values: PostInput) {
    setServerError(null);
    setNotice(null);
    startTransition(async () => {
      if (mode === "create") {
        const result = await createPostAction(values);
        if (!result.ok) {
          handleWriteError(result);
          return;
        }
        router.push(`/admin/posts/${result.value.id}`);
        return;
      }

      const result = await updatePostAction(postId!, values, currentUpdatedAt!);
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
    if (!postId || !currentUpdatedAt) return;
    setServerError(null);
    setNotice(null);
    startTransition(async () => {
      const publishedAtIso =
        to === "published" && currentStatus === "review" && reservedPublishedAt
          ? new Date(reservedPublishedAt).toISOString()
          : null;
      const result = await transitionPostAction(
        postId,
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
      <p className="text-sm text-muted-foreground">種類: {KIND_LABEL[initialValues.kind]}</p>

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
        <input type="hidden" {...register("kind")} />
        <FieldGroup>
          <Field data-invalid={!!errors.title}>
            <FieldLabel htmlFor="post-title">タイトル</FieldLabel>
            <Input id="post-title" aria-invalid={!!errors.title} {...register("title")} />
            <FieldError errors={errors.title ? [errors.title] : undefined} />
          </Field>

          <Field data-invalid={!!errors.slug}>
            <FieldLabel htmlFor="post-slug">slug</FieldLabel>
            <Input id="post-slug" aria-invalid={!!errors.slug} {...register("slug")} />
            <FieldDescription>小文字英数とハイフンのみ</FieldDescription>
            <FieldError errors={errors.slug ? [errors.slug] : undefined} />
          </Field>

          <Field data-invalid={!!errors.excerpt}>
            <FieldLabel htmlFor="post-excerpt">抜粋</FieldLabel>
            <Textarea id="post-excerpt" className="min-h-20" aria-invalid={!!errors.excerpt} {...register("excerpt")} />
            <FieldError errors={errors.excerpt ? [errors.excerpt] : undefined} />
          </Field>

          <Field data-invalid={!!errors.body}>
            <div className="mb-1 flex items-center justify-between">
              <FieldLabel htmlFor="post-body">本文 (Markdown)</FieldLabel>
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant={showPreview ? "ghost" : "secondary"}
                  size="xs"
                  onClick={() => setShowPreview(false)}
                >
                  編集
                </Button>
                <Button
                  type="button"
                  variant={showPreview ? "secondary" : "ghost"}
                  size="xs"
                  onClick={() => setShowPreview(true)}
                >
                  プレビュー
                </Button>
              </div>
            </div>
            {showPreview ? (
              <div className="min-h-48 rounded-lg border border-input p-3 text-sm prose prose-sm max-w-none">
                <ReactMarkdown>{body || "*(本文が空です)*"}</ReactMarkdown>
              </div>
            ) : (
              <Textarea id="post-body" className="min-h-48" aria-invalid={!!errors.body} {...register("body")} />
            )}
            <FieldError errors={errors.body ? [errors.body] : undefined} />
          </Field>

          <Field data-invalid={!!errors.cover_media_id}>
            <FieldLabel>カバー画像 (任意)</FieldLabel>
            <div className="flex items-center gap-3">
              {coverItem ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={coverItem.url}
                  alt={coverItem.alt}
                  className="h-20 w-20 shrink-0 rounded-lg border border-border object-cover"
                />
              ) : (
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-[11px] text-muted-foreground">
                  未選択
                </div>
              )}
              <div className="flex flex-col gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setCoverPickerOpen(true)}>
                  画像を選択
                </Button>
                {coverMediaId && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setValue("cover_media_id", null, { shouldDirty: true })}
                  >
                    選択解除
                  </Button>
                )}
              </div>
            </div>
            <input type="hidden" {...register("cover_media_id")} />
            <FieldError errors={errors.cover_media_id ? [errors.cover_media_id] : undefined} />
          </Field>
        </FieldGroup>

        <Button type="submit" disabled={isPending}>
          {mode === "create" ? "作成する" : "保存する (Cmd/Ctrl+S)"}
        </Button>
      </form>

      <MediaPicker
        open={coverPickerOpen}
        onOpenChange={setCoverPickerOpen}
        mode="single"
        title="カバー画像を選ぶ"
        initialItems={mediaCatalog}
        initialNextCursor={catalogNextCursor}
        selectedIds={coverMediaId ? [coverMediaId] : []}
        onConfirm={(ids) => setValue("cover_media_id", ids[0] ?? null, { shouldDirty: true })}
        onItemsLoaded={handleMediaItemsLoaded}
      />
    </div>
  );
}
