"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
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
import { MediaPicker, type PickerMediaItem } from "@/app/admin/_ui/media-picker";

import { zWorkInput, type ContentStatus, type WorkInput } from "@/modules/content/contracts";

import { createWorkAction, transitionWorkAction, updateWorkAction } from "./actions";

type Props = {
  mode: "create" | "edit";
  workId?: string;
  status?: ContentStatus;
  updatedAt?: string;
  initialValues: WorkInput;
  mediaItems: PickerMediaItem[];
  mediaNextCursor?: string | null;
};

/** cms-ai-pipeline.md §4.1 の遷移図と 1:1 (ボタン活性制御用) */
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

export function WorkForm({
  mode,
  workId,
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
  const dragIndexRef = useRef<number | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    setError,
    formState: { errors },
  } = useForm<WorkInput>({ resolver: zodResolver(zWorkInput), defaultValues: initialValues });

  const imageIds = watch("image_ids");
  const coverMediaId = watch("cover_media_id");
  // 初期一覧 (mediaItems) に加え、ダイアログの「もっと見る」で追加取得した分もここへマージする。
  // ページング境界を跨いで選択されたメディアもプレビューできるようにするため。
  const [mediaCatalog, setMediaCatalog] = useState<PickerMediaItem[]>(mediaItems);
  const [catalogNextCursor, setCatalogNextCursor] = useState<string | null>(mediaNextCursor);
  const coverItem = mediaCatalog.find((m) => m.id === coverMediaId) ?? null;
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [attachPickerOpen, setAttachPickerOpen] = useState(false);

  function handleMediaItemsLoaded(items: PickerMediaItem[], nextCursor: string | null) {
    setMediaCatalog((prev) => {
      const known = new Set(prev.map((p) => p.id));
      const additions = items.filter((item) => !known.has(item.id));
      return additions.length > 0 ? [...prev, ...additions] : prev;
    });
    setCatalogNextCursor(nextCursor);
  }

  function addImages(ids: string[]) {
    if (ids.length === 0) return;
    const merged = [...imageIds];
    for (const id of ids) {
      if (!merged.includes(id)) merged.push(id);
    }
    setValue("image_ids", merged, { shouldDirty: true });
  }

  function removeImage(index: number) {
    setValue(
      "image_ids",
      imageIds.filter((_, i) => i !== index),
      { shouldDirty: true },
    );
  }

  function moveImage(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= imageIds.length) return;
    const next = [...imageIds];
    [next[index], next[target]] = [next[target], next[index]];
    setValue("image_ids", next, { shouldDirty: true });
  }

  function onDragStart(index: number) {
    dragIndexRef.current = index;
  }

  function onDrop(index: number) {
    const from = dragIndexRef.current;
    dragIndexRef.current = null;
    if (from === null || from === index) return;
    const next = [...imageIds];
    const [moved] = next.splice(from, 1);
    next.splice(index, 0, moved);
    setValue("image_ids", next, { shouldDirty: true });
  }

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

  async function onSubmit(values: WorkInput) {
    setServerError(null);
    setNotice(null);
    startTransition(async () => {
      if (mode === "create") {
        const result = await createWorkAction(values);
        if (!result.ok) {
          handleWriteError(result);
          return;
        }
        router.push(`/admin/works/${result.value.id}`);
        return;
      }

      const result = await updateWorkAction(workId!, values, currentUpdatedAt!);
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
    if (!workId || !currentUpdatedAt) return;
    setServerError(null);
    setNotice(null);
    startTransition(async () => {
      const publishedAtIso =
        to === "published" && currentStatus === "review" && reservedPublishedAt
          ? new Date(reservedPublishedAt).toISOString()
          : null;
      const result = await transitionWorkAction(
        workId,
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
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => onTransition(to)}
              >
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
          <Field data-invalid={!!errors.title}>
            <FieldLabel htmlFor="work-title">タイトル</FieldLabel>
            <Input id="work-title" aria-invalid={!!errors.title} {...register("title")} />
            <FieldError errors={errors.title ? [errors.title] : undefined} />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field data-invalid={!!errors.slug}>
              <FieldLabel htmlFor="work-slug">slug</FieldLabel>
              <Input id="work-slug" aria-invalid={!!errors.slug} {...register("slug")} />
              <FieldDescription>小文字英数とハイフンのみ (例: work-07)</FieldDescription>
              <FieldError errors={errors.slug ? [errors.slug] : undefined} />
            </Field>

            <Field data-invalid={!!errors.category}>
              <FieldLabel htmlFor="work-category">カテゴリ</FieldLabel>
              <Input id="work-category" aria-invalid={!!errors.category} {...register("category")} />
              <FieldError errors={errors.category ? [errors.category] : undefined} />
            </Field>
          </div>

          <Field data-invalid={!!errors.body}>
            <FieldLabel htmlFor="work-body">本文 (Markdown)</FieldLabel>
            <Textarea id="work-body" className="min-h-48" aria-invalid={!!errors.body} {...register("body")} />
            <FieldError errors={errors.body ? [errors.body] : undefined} />
          </Field>

          <Field data-invalid={!!errors.process_note}>
            <FieldLabel htmlFor="work-process-note">工程 (1行、任意)</FieldLabel>
            <Input
              id="work-process-note"
              placeholder="例: 表面処理→プライマー→塗装→クリア"
              aria-invalid={!!errors.process_note}
              {...register("process_note", {
                setValueAs: (v: string) => (v === "" ? null : v),
              })}
            />
            <FieldError errors={errors.process_note ? [errors.process_note] : undefined} />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
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

            <Field data-invalid={!!errors.sort_order}>
              <FieldLabel htmlFor="work-sort-order">表示順 (小さいほど先頭)</FieldLabel>
              <Input
                id="work-sort-order"
                type="number"
                min={0}
                aria-invalid={!!errors.sort_order}
                {...register("sort_order", { valueAsNumber: true })}
              />
              <FieldError errors={errors.sort_order ? [errors.sort_order] : undefined} />
            </Field>
          </div>

          <Field>
            <FieldLabel>添付画像 (ドラッグ&ドロップ or ↑↓ で並べ替え)</FieldLabel>
            <div>
              <Button type="button" variant="outline" onClick={() => setAttachPickerOpen(true)}>
                画像を選択して追加
              </Button>
            </div>
            {imageIds.length > 0 && (
              <ul className="mt-2 space-y-1">
                {imageIds.map((mediaId, index) => {
                  const item = mediaCatalog.find((m) => m.id === mediaId) ?? null;
                  return (
                    <li
                      key={`${mediaId}-${index}`}
                      draggable
                      onDragStart={() => onDragStart(index)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => onDrop(index)}
                      className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm"
                    >
                      <div className="h-10 w-10 shrink-0 overflow-hidden rounded border border-border bg-muted">
                        {item && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.url} alt={item.alt} className="h-full w-full object-cover" />
                        )}
                      </div>
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {item?.alt || mediaId}
                      </span>
                      <span className="flex shrink-0 gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="上へ移動"
                          onClick={() => moveImage(index, -1)}
                          disabled={index === 0}
                        >
                          ↑
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="下へ移動"
                          onClick={() => moveImage(index, 1)}
                          disabled={index === imageIds.length - 1}
                        >
                          ↓
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="削除"
                          onClick={() => removeImage(index)}
                        >
                          ×
                        </Button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <FieldError errors={errors.image_ids ? [errors.image_ids as { message?: string }] : undefined} />
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
      <MediaPicker
        open={attachPickerOpen}
        onOpenChange={setAttachPickerOpen}
        mode="multiple"
        title="添付画像を選ぶ"
        initialItems={mediaCatalog}
        initialNextCursor={catalogNextCursor}
        selectedIds={[]}
        onConfirm={addImages}
        onItemsLoaded={handleMediaItemsLoaded}
      />
    </div>
  );
}
