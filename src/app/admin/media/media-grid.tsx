"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CircleCheckIcon,
  ImageUpIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
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
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function parseTags(input: string): string[] {
  return input
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, 10);
}

/** ファイル名から拡張子を除いた部分を alt の初期値として使う。 */
function stripExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx > 0 ? filename.slice(0, idx) : filename;
}

/** 画像形式・10MB 上限のクライアント側事前検証 (サーバ側 createUploadUrl の検証と同基準)。 */
function validateFile(file: File): string | null {
  if (!file.type.startsWith("image/")) return "画像ファイルではありません";
  if (file.size > MAX_UPLOAD_BYTES) return "10MBを超えています";
  return null;
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
              "cursor-pointer rounded-xl border border-admin-card-border bg-card p-2 shadow-md outline-none transition-colors",
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

type UploadRowStatus = "pending" | "uploading" | "done" | "error";

type UploadRow = {
  id: string;
  file: File;
  previewUrl: string;
  alt: string;
  status: UploadRowStatus;
  error: string | null;
  /** null 以外なら画像形式外/10MB超。アップロード対象から除外する。 */
  invalidReason: string | null;
};

function createUploadRow(file: File): UploadRow {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`,
    file,
    previewUrl: URL.createObjectURL(file),
    alt: stripExtension(file.name),
    status: "pending",
    error: null,
    invalidReason: validateFile(file),
  };
}

/** 行のプレビュー URL (createObjectURL) を revoke する。行を state から取り除く直前に必ず呼ぶこと。 */
function revokeRowPreview(row: UploadRow): void {
  URL.revokeObjectURL(row.previewUrl);
}

function UploadRowStatusIndicator({ status }: { status: UploadRowStatus }) {
  if (status === "uploading") {
    return (
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Loader2Icon className="size-3 animate-spin" />
        アップロード中
      </span>
    );
  }
  if (status === "done") {
    return (
      <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
        <CircleCheckIcon className="size-3" />
        完了
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex items-center gap-1 text-[11px] text-destructive">
        <OctagonXIcon className="size-3" />
        失敗
      </span>
    );
  }
  return <span className="text-[11px] text-muted-foreground">待機</span>;
}

function UploadMediaDialog({ onClose, onUploaded }: { onClose: () => void; onUploaded: () => void }) {
  const [rows, setRows] = useState<UploadRow[]>([]);
  const [tags, setTags] = useState("");
  const [credit, setCredit] = useState("");
  const [isPlaceholder, setIsPlaceholder] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const rowsRef = useRef<UploadRow[]>(rows);

  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  // アンマウント時に残っている全プレビュー URL を revoke する (行削除時は removeRow 側で個別に revoke 済み)。
  useEffect(() => {
    return () => {
      rowsRef.current.forEach(revokeRowPreview);
    };
  }, []);

  // アップロード中にタブを閉じる/リロードすると進行中の通信が失われるため警告する。
  useEffect(() => {
    if (!isUploading) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isUploading]);

  function addFiles(files: File[]) {
    if (files.length === 0) return;
    setRows((prev) => [...prev, ...files.map((file) => createUploadRow(file))]);
  }

  function removeRow(id: string) {
    setRows((prev) => {
      const target = prev.find((r) => r.id === id);
      if (target) revokeRowPreview(target);
      return prev.filter((r) => r.id !== id);
    });
  }

  function updateAlt(id: string, alt: string) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, alt } : r)));
  }

  async function uploadOneRow(row: UploadRow): Promise<{ ok: true } | { ok: false; error: string }> {
    const urlResult = await requestUploadUrlAction({
      filename: row.file.name,
      contentType: row.file.type,
      sizeBytes: row.file.size,
    });
    if (urlResult.error || !urlResult.storagePath || !urlResult.token) {
      return { ok: false, error: urlResult.error ?? "アップロード URL の発行に失敗しました。" };
    }

    const supabase = createSupabaseBrowserClient();
    const { error: uploadError } = await supabase.storage
      .from("media-originals")
      .uploadToSignedUrl(urlResult.storagePath, urlResult.token, row.file);
    if (uploadError) {
      return { ok: false, error: `アップロードに失敗しました: ${uploadError.message}` };
    }

    const completeResult = await completeUploadAction({
      storagePath: urlResult.storagePath,
      alt: row.alt,
      credit: credit.trim() || null,
      tags: parseTags(tags),
      isPlaceholder,
    });
    if (completeResult.error) {
      return { ok: false, error: completeResult.error };
    }
    return { ok: true };
  }

  const uploadTargets = rows.filter((r) => !r.invalidReason && (r.status === "pending" || r.status === "error"));

  async function handleUploadAll() {
    if (uploadTargets.length === 0) return;
    const missingAlt = uploadTargets.find((r) => !r.alt.trim());
    if (missingAlt) {
      toast.error("alt テキストを入力してください。");
      return;
    }

    setIsUploading(true);
    let successCount = 0;
    let failCount = 0;
    for (const target of uploadTargets) {
      // ループ実行中にユーザーが行を削除している可能性があるため、処理直前に現存確認する
      // (存在しなければ削除済みファイルなのでアップロードせずスキップする)。
      const latest = rowsRef.current.find((r) => r.id === target.id);
      if (!latest) continue;
      setRows((prev) => prev.map((r) => (r.id === target.id ? { ...r, status: "uploading", error: null } : r)));
      const result = await uploadOneRow(latest);
      if (result.ok) {
        successCount += 1;
        setRows((prev) => prev.map((r) => (r.id === target.id ? { ...r, status: "done", error: null } : r)));
      } else {
        failCount += 1;
        setRows((prev) => prev.map((r) => (r.id === target.id ? { ...r, status: "error", error: result.error } : r)));
      }
    }
    setIsUploading(false);

    if (failCount === 0) {
      toast.success(`${successCount}枚をアップロードしました。`);
      onUploaded();
    } else {
      toast.error(`${successCount}枚成功、${failCount}枚失敗しました。失敗した項目を確認してください。`);
      // 成功済みの行は反映済みなので一覧から外し、失敗・未処理の行だけ残してモーダルは維持する。
      // (revoke してから除去することでプレビュー URL のリークを防ぐ)
      setRows((prev) => {
        prev.filter((r) => r.status === "done").forEach(revokeRowPreview);
        return prev.filter((r) => r.status !== "done");
      });
    }
  }

  async function retryRow(id: string) {
    if (isUploading) return; // 一括アップロード中の多重実行を防止
    const target = rowsRef.current.find((r) => r.id === id);
    if (!target) return;
    if (!target.alt.trim()) {
      toast.error("alt テキストを入力してください。");
      return;
    }

    setIsUploading(true);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: "uploading", error: null } : r)));
    const result = await uploadOneRow(target);
    setIsUploading(false);

    if (result.ok) {
      toast.success("アップロードしました。");
      const uploaded = rowsRef.current.find((r) => r.id === id);
      if (uploaded) revokeRowPreview(uploaded);
      const remaining = rowsRef.current.filter((r) => r.id !== id);
      setRows(remaining);
      if (remaining.length === 0) {
        onUploaded();
      }
    } else {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: "error", error: result.error } : r)));
      toast.error(result.error);
    }
  }

  return (
    <Dialog
      open
      disablePointerDismissal={isUploading}
      onOpenChange={(open) => {
        if (open) return;
        if (isUploading) return; // アップロード中は閉じない (Esc / 外側クリック含む)
        onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg" showCloseButton={!isUploading}>
        <DialogHeader>
          <DialogTitle>画像をアップロード</DialogTitle>
          <DialogDescription>
            長辺2560px上限に自動リサイズ・WebP + Instagram用JPEGレンディションを生成します (10MBまで・複数枚可)。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <label
            htmlFor="upload-dropzone-input"
            onDragOver={(e) => {
              e.preventDefault();
              if (!isUploading) setIsDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              // 子要素の境界を跨ぐたびに発火するため、ドロップゾーンの外へ本当に出た時だけ解除する
              if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
              setIsDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              if (isUploading) return;
              addFiles(Array.from(e.dataTransfer.files ?? []));
            }}
            className={cn(
              "flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors",
              isUploading ? "cursor-not-allowed opacity-50" : "cursor-pointer",
              isDragOver ? "border-primary bg-primary/5" : "border-input hover:bg-muted/40",
            )}
          >
            <ImageUpIcon className="size-7 text-muted-foreground" />
            <p className="text-sm font-medium">クリックして選択、またはドラッグ&ドロップ</p>
            <p className="text-xs text-muted-foreground">PNG/JPEG/WebP、10MBまで・複数選択可</p>
            <input
              id="upload-dropzone-input"
              type="file"
              accept="image/*"
              multiple
              disabled={isUploading}
              className="sr-only"
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </label>

          {rows.length > 0 && (
            <div className="flex max-h-64 flex-col gap-2 overflow-y-auto" aria-live="polite">
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="flex items-start gap-2 rounded-lg border border-admin-card-border bg-card p-2"
                >
                  <div className="relative size-12 shrink-0 overflow-hidden rounded-md bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={row.previewUrl} alt="" className="h-full w-full object-cover" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs font-medium" title={row.file.name}>
                        {row.file.name}
                      </p>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {(row.file.size / (1024 * 1024)).toFixed(2)} MB
                      </span>
                    </div>
                    <Input
                      value={row.alt}
                      onChange={(e) => updateAlt(row.id, e.target.value)}
                      placeholder="alt テキスト (必須)"
                      maxLength={200}
                      required
                      aria-invalid={!row.alt.trim()}
                      disabled={row.status === "uploading" || row.status === "done" || Boolean(row.invalidReason)}
                      className="h-7 text-xs"
                    />
                    {row.invalidReason && (
                      <p className="flex items-center gap-1 text-[11px] text-destructive">
                        <TriangleAlertIcon className="size-3 shrink-0" />
                        {row.invalidReason} (アップロード対象から除外されます)
                      </p>
                    )}
                    {row.status === "error" && row.error && (
                      <p className="flex items-center gap-1 text-[11px] text-destructive">
                        <OctagonXIcon className="size-3 shrink-0" />
                        {row.error}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <UploadRowStatusIndicator status={row.status} />
                    {row.status === "error" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        onClick={() => void retryRow(row.id)}
                        disabled={isUploading}
                      >
                        リトライ
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => removeRow(row.id)}
                      disabled={row.status === "uploading"}
                      aria-label="この画像を削除"
                    >
                      <XIcon />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <Field>
            <FieldLabel htmlFor="upload-tags">タグ (カンマ区切り、任意・全ファイル共通)</FieldLabel>
            <Input id="upload-tags" value={tags} onChange={(e) => setTags(e.target.value)} disabled={isUploading} />
          </Field>
          <Field>
            <FieldLabel htmlFor="upload-credit">出典 (任意・全ファイル共通)</FieldLabel>
            <Input
              id="upload-credit"
              value={credit}
              onChange={(e) => setCredit(e.target.value)}
              disabled={isUploading}
            />
          </Field>
          <Field orientation="horizontal">
            <Checkbox
              checked={isPlaceholder}
              onCheckedChange={(c) => setIsPlaceholder(Boolean(c))}
              disabled={isUploading}
            />
            <FieldContent>
              <FieldLabel>仮素材として扱う (is_placeholder・全ファイル共通)</FieldLabel>
            </FieldContent>
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isUploading}>
            キャンセル (Esc)
          </Button>
          <Button onClick={() => void handleUploadAll()} disabled={isUploading || uploadTargets.length === 0}>
            {isUploading
              ? "アップロード中..."
              : uploadTargets.length > 0
                ? `${uploadTargets.length}枚をアップロード`
                : "アップロード"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
