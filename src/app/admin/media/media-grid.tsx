"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldContent, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { MediaListItem } from "@/modules/media/facade";

import { completeUploadAction, deleteMediaAction, patchMediaAction, requestUploadUrlAction } from "./actions";

const GRID_COLUMNS = 4; // ↑↓ キー操作の行推定用 (lg 表示を基準とした概算)

function parseTags(input: string): string[] {
  return input
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, 10);
}

/**
 * サムネイル画像。読み込み完了までは (壊れて見えないよう) 薄いグレーの
 * スケルトン + subtle pulse を表示し、読み込み完了で画像へフェードする。
 * `loading="lazy"` はそのまま維持する。
 *
 * ブラウザキャッシュ済みの画像は img 要素マウント時点で既に complete
 * (naturalWidth > 0) になっており、その場合 <img> の "load" イベントは
 * (bubbling しないイベントのため) React がリスナーを付ける前に発火して
 * 拾えず、スケルトンが表示されたまま止まってしまうことがある
 * (実機の 2 回目以降のアクセスで実際に発生を確認)。
 * useEffect でマウント直後に img.complete を確認し、その場合は即座に
 * loaded にすることでこのケースも救う。
 */
export function MediaThumbnail({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setLoaded(false);
    if (imgRef.current?.complete) {
      setLoaded(true);
    }
  }, [src]);

  return (
    <div className="relative aspect-square overflow-hidden rounded-lg bg-muted">
      {!loaded && <div className="absolute inset-0 animate-pulse bg-muted-foreground/10" />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        className={cn(
          "h-full w-full object-cover transition-opacity duration-300",
          loaded ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

export function MediaGrid({ items }: { items: MediaListItem[] }) {
  const router = useRouter();
  const [focusedIndex, setFocusedIndex] = useState(items.length > 0 ? 0 : -1);
  const [editId, setEditId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const cardRefs = useRef<Array<HTMLDivElement | null>>([]);

  const editItem = useMemo(() => items.find((i) => i.id === editId) ?? null, [items, editId]);

  useEffect(() => {
    if (editId || uploadOpen) return;
    function handleKeydown(e: KeyboardEvent) {
      if (items.length === 0) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(items.length - 1, i < 0 ? 0 : i + 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(items.length - 1, (i < 0 ? 0 : i) + GRID_COLUMNS));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(0, (i < 0 ? 0 : i) - GRID_COLUMNS));
      } else if (e.key === "Enter") {
        if (focusedIndex >= 0 && items[focusedIndex]) {
          e.preventDefault();
          setEditId(items[focusedIndex].id);
        }
      }
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [items, focusedIndex, editId, uploadOpen]);

  useEffect(() => {
    cardRefs.current[focusedIndex]?.scrollIntoView({ block: "nearest" });
  }, [focusedIndex]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button onClick={() => setUploadOpen(true)}>画像をアップロード</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {items.length === 0 && (
          <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
            メディアがまだありません。「画像をアップロード」から追加してください。
          </p>
        )}
        {items.map((item, index) => (
          <div
            key={item.id}
            ref={(el) => {
              cardRefs.current[index] = el;
            }}
            tabIndex={0}
            role="button"
            onFocus={() => setFocusedIndex(index)}
            onClick={() => setEditId(item.id)}
            className={cn(
              "cursor-pointer rounded-xl border border-border bg-card p-2 shadow-sm outline-none transition-colors",
              focusedIndex === index ? "ring-2 ring-primary" : "hover:bg-muted/40",
            )}
          >
            {/* 公開レンディション URL (webp)。next/image の remotePatterns 未設定でも
                <img> ではなく next/image を使いたいが、外部ドメイン許可は他ページ (next.config.ts)
                の管轄外変更を避けるため、ここでは通常の img タグで代用する。 */}
            <MediaThumbnail src={item.url} alt={item.alt} />
            <p className="mt-2 truncate text-xs">{item.alt || "(alt未設定)"}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {item.is_placeholder && (
                <Badge variant="outline" className="text-[10px]">
                  仮素材
                </Badge>
              )}
              <Badge variant={item.referenceCount > 0 ? "secondary" : "outline"} className="text-[10px]">
                参照 {item.referenceCount}
              </Badge>
            </div>
          </div>
        ))}
      </div>

      {editItem && (
        <EditMediaDialog
          item={editItem}
          onClose={() => setEditId(null)}
          onSaved={() => {
            setEditId(null);
            router.refresh();
          }}
        />
      )}

      {uploadOpen && (
        <UploadMediaDialog
          onClose={() => setUploadOpen(false)}
          onUploaded={() => {
            setUploadOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function EditMediaDialog({
  item,
  onClose,
  onSaved,
}: {
  item: MediaListItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [alt, setAlt] = useState(item.alt);
  const [tags, setTags] = useState(item.tags.join(", "));
  const [isPlaceholder, setIsPlaceholder] = useState(item.is_placeholder);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  async function handleSave() {
    setIsSaving(true);
    const result = await patchMediaAction(item.id, {
      alt,
      tags: parseTags(tags),
      is_placeholder: isPlaceholder,
    });
    setIsSaving(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success("保存しました。");
    onSaved();
  }

  async function handleDelete() {
    if (item.referenceCount > 0) {
      toast.error("このメディアは参照されているため削除できません (KMB-E301)。");
      return;
    }
    setIsDeleting(true);
    const result = await deleteMediaAction(item.id);
    setIsDeleting(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success("削除しました。");
    onSaved();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            void handleSave();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>メディア編集</DialogTitle>
          <DialogDescription>
            {item.width}×{item.height} / {item.mimeType} / ID: {item.id}
          </DialogDescription>
        </DialogHeader>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.url} alt={item.alt} className="max-h-48 w-full rounded-lg object-contain" />

        <div className="flex flex-col gap-3">
          <Field>
            <FieldLabel htmlFor="media-alt">alt テキスト</FieldLabel>
            <Input id="media-alt" value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={200} />
          </Field>
          <Field>
            <FieldLabel htmlFor="media-tags">タグ (カンマ区切り)</FieldLabel>
            <Input id="media-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
          <Field orientation="horizontal">
            <Checkbox checked={isPlaceholder} onCheckedChange={(c) => setIsPlaceholder(Boolean(c))} />
            <FieldContent>
              <FieldLabel>仮素材として扱う (is_placeholder)</FieldLabel>
            </FieldContent>
          </Field>
          <p className="text-xs text-muted-foreground">
            参照件数: {item.referenceCount} {item.referenceCount > 0 && "(参照ゼロになるまで削除できません)"}
          </p>
        </div>

        <DialogFooter>
          <Button variant="destructive" onClick={handleDelete} disabled={isDeleting || item.referenceCount > 0}>
            {isDeleting ? "削除中..." : "削除"}
          </Button>
          <Button variant="outline" onClick={onClose}>
            閉じる (Esc)
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? "保存中..." : "保存 (Cmd+S)"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UploadMediaDialog({ onClose, onUploaded }: { onClose: () => void; onUploaded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState("");
  const [tags, setTags] = useState("");
  const [credit, setCredit] = useState("");
  const [isPlaceholder, setIsPlaceholder] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  async function handleUpload() {
    if (!file) {
      toast.error("ファイルを選択してください。");
      return;
    }
    if (!alt.trim()) {
      toast.error("alt テキストを入力してください。");
      return;
    }
    setIsUploading(true);
    try {
      const urlResult = await requestUploadUrlAction({
        filename: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      });
      if (urlResult.error || !urlResult.storagePath || !urlResult.token) {
        toast.error(urlResult.error ?? "アップロード URL の発行に失敗しました。");
        return;
      }

      const supabase = createSupabaseBrowserClient();
      const { error: uploadError } = await supabase.storage
        .from("media-originals")
        .uploadToSignedUrl(urlResult.storagePath, urlResult.token, file);
      if (uploadError) {
        toast.error(`アップロードに失敗しました: ${uploadError.message}`);
        return;
      }

      const completeResult = await completeUploadAction({
        storagePath: urlResult.storagePath,
        alt,
        credit: credit.trim() || null,
        tags: parseTags(tags),
        isPlaceholder,
      });
      if (completeResult.error) {
        toast.error(completeResult.error);
        return;
      }
      toast.success("アップロードしました。");
      onUploaded();
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>画像をアップロード</DialogTitle>
          <DialogDescription>
            長辺2560px上限に自動リサイズ・WebP + Instagram用JPEGレンディションを生成します (10MBまで)。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Field>
            <FieldLabel htmlFor="upload-file">画像ファイル</FieldLabel>
            <Input
              id="upload-file"
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="upload-alt">alt テキスト</FieldLabel>
            <Input id="upload-alt" value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={200} required />
          </Field>
          <Field>
            <FieldLabel htmlFor="upload-tags">タグ (カンマ区切り、任意)</FieldLabel>
            <Input id="upload-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="upload-credit">出典 (任意)</FieldLabel>
            <Input id="upload-credit" value={credit} onChange={(e) => setCredit(e.target.value)} />
          </Field>
          <Field orientation="horizontal">
            <Checkbox checked={isPlaceholder} onCheckedChange={(c) => setIsPlaceholder(Boolean(c))} />
            <FieldContent>
              <FieldLabel>仮素材として扱う (is_placeholder)</FieldLabel>
            </FieldContent>
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            キャンセル (Esc)
          </Button>
          <Button onClick={handleUpload} disabled={isUploading}>
            {isUploading ? "アップロード中..." : "アップロード"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
