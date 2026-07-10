"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { MediaThumbnail } from "@/app/admin/media/media-grid";

import { AiImageGenerator } from "./ai-image-generator";
import { listMediaForPickerAction } from "./media-picker-actions";
import type { PickerMediaItem } from "./media-picker-data";

export type { PickerMediaItem };

type MediaPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** single: カバー画像 (0 or 1 件)。multiple: 添付画像への追加 (複数件) */
  mode: "single" | "multiple";
  /**
   * ダイアログ見出し (Issue #18: ヘッダー文言を props 化)。
   * 既定は汎用の「画像を選ぶ」。呼び出し元の文脈が明確な場合 (works/posts のカバー画像等) は
   * 明示的に上書きする。
   */
  title?: string;
  /** 呼び出し元ページ (Server Component) が MediaFacade.list 経由で渡した初期一覧 */
  initialItems: PickerMediaItem[];
  initialNextCursor: string | null;
  /** ダイアログを開いた時点でチェック状態にしておく id (single はカバー画像、multiple は空推奨) */
  selectedIds: string[];
  onConfirm: (ids: string[]) => void;
  /** 「もっと見る」で追加取得した分を呼び出し元のカタログにもマージしてもらうためのフック */
  onItemsLoaded?: (items: PickerMediaItem[], nextCursor: string | null) => void;
};

/**
 * ビジュアルなメディア選択ダイアログ (堀さん指摘: UUID 手入力がわかりづらい問題への対応)。
 * サムネイルグリッドからクリックで選択する。/admin/media のアップロード導線への
 * リンクも footer に用意する (このダイアログ自体からのアップロードは Wave 3 以降)。
 */
export function MediaPicker({
  open,
  onOpenChange,
  mode,
  title = "画像を選ぶ",
  initialItems,
  initialNextCursor,
  selectedIds,
  onConfirm,
  onItemsLoaded,
}: MediaPickerProps) {
  const [items, setItems] = useState<PickerMediaItem[]>(initialItems);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [selection, setSelection] = useState<string[]>(selectedIds);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // ダイアログを開くたびに状態をリセットする (前回の「もっと見る」結果や選択途中を持ち越さない)。
  useEffect(() => {
    if (!open) return;
    setItems(initialItems);
    setNextCursor(initialNextCursor);
    setSelection(selectedIds);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function toggle(id: string) {
    if (mode === "single") {
      setSelection((prev) => (prev[0] === id ? [] : [id]));
      return;
    }
    setSelection((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function loadMore() {
    if (!nextCursor) return;
    startTransition(async () => {
      const result = await listMediaForPickerAction(nextCursor);
      if (result.error) {
        setError(result.error);
        return;
      }
      setItems((prev) => [...prev, ...result.items]);
      setNextCursor(result.nextCursor);
      onItemsLoaded?.(result.items, result.nextCursor);
    });
  }

  /**
   * 「AI で生成」タブの「これを使う」。生成済み画像 (既に media 保存済み) をカタログへ
   * 反映しつつ選択する。single モードは即座に確定して閉じる (design ai-studio-v2.md §4)。
   */
  function useGeneratedImage(item: PickerMediaItem) {
    setItems((prev) => (prev.some((p) => p.id === item.id) ? prev : [item, ...prev]));
    if (mode === "single") {
      onConfirm([item.id]);
      onOpenChange(false);
      return;
    }
    setSelection((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            ライブラリから選ぶか、AI で新しく生成できます。
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Tabs defaultValue="library">
          <TabsList>
            <TabsTrigger value="library">ライブラリから選ぶ</TabsTrigger>
            <TabsTrigger value="ai">AI で生成</TabsTrigger>
          </TabsList>

          <TabsContent value="library" className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {mode === "single"
                ? "サムネイルをクリックして選択してください。もう一度クリックで選択解除できます。"
                : "サムネイルをクリックして複数選択できます (追加分のみ。既存の並び替え・削除は下の一覧で行います)。"}
            </p>
            <div className="grid max-h-[55vh] grid-cols-3 gap-3 overflow-y-auto sm:grid-cols-4">
              {items.length === 0 && (
                <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
                  メディアがまだありません。「/admin/media」からアップロードしてください。
                </p>
              )}
              {items.map((item) => {
                const isSelected = selection.includes(item.id);
                const order = mode === "multiple" && isSelected ? selection.indexOf(item.id) + 1 : null;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggle(item.id)}
                    aria-pressed={isSelected}
                    className={cn(
                      "relative rounded-xl border border-border bg-card p-2 text-left shadow-sm outline-none transition-colors",
                      isSelected ? "ring-2 ring-primary" : "hover:bg-muted/40",
                    )}
                  >
                    <MediaThumbnail src={item.url} alt={item.alt} />
                    <p className="mt-2 truncate text-xs">{item.alt || "(alt未設定)"}</p>
                    {item.is_placeholder && (
                      <Badge variant="outline" className="mt-1 text-[10px]">
                        仮素材
                      </Badge>
                    )}
                    {order !== null && (
                      <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-medium text-primary-foreground">
                        {order}
                      </span>
                    )}
                    {mode === "single" && isSelected && (
                      <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-medium text-primary-foreground">
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {nextCursor && (
              <div className="flex justify-center">
                <Button type="button" variant="outline" size="sm" onClick={loadMore} disabled={isPending}>
                  {isPending ? "読み込み中..." : "もっと見る"}
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="ai">
            <AiImageGenerator onUseImage={useGeneratedImage} />
          </TabsContent>
        </Tabs>

        <DialogFooter className="items-center sm:justify-between">
          <Link href="/admin/media" target="_blank" className="text-xs underline underline-offset-4">
            メディア管理でアップロード →
          </Link>
          <div className="flex gap-2">
            {mode === "single" && selection.length > 0 && (
              <Button type="button" variant="ghost" onClick={() => setSelection([])}>
                選択解除
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              キャンセル (Esc)
            </Button>
            <Button
              type="button"
              onClick={() => {
                onConfirm(selection);
                onOpenChange(false);
              }}
            >
              {mode === "single"
                ? selection.length > 0
                  ? "この画像を選択"
                  : "未選択にする"
                : `選択した${selection.length}件を追加`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
