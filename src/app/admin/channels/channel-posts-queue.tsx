"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Surface } from "@/app/admin/_ui";
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
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ChannelPostStatus, ChannelPostView, NoteDraftStatus } from "@/modules/distribution/contracts";

import {
  cancelChannelPostAction,
  createNoteDraftAction,
  getNoteCopyContentAction,
  resolveManualRequiredAction,
  retryFailedChannelPostAction,
} from "./actions";

const NOTE_DRAFT_STATUS_LABELS: Record<NoteDraftStatus, string> = {
  none: "未作成",
  creating: "作成中...",
  created: "下書き作成済み",
  unknown: "応答不明 (要確認)",
  failed: "作成失敗",
};

const STATUS_LABELS: Record<ChannelPostStatus, string> = {
  scheduled: "予約済み",
  publishing: "配信中",
  published: "配信済み",
  failed: "失敗",
  cancelled: "キャンセル",
  manual_required: "要人間照合",
};

const CHANNEL_LABELS: Record<string, string> = {
  site_blog: "自サイトブログ",
  note: "note",
  x: "X",
  instagram: "Instagram",
};

function statusBadgeVariant(status: ChannelPostStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "published") return "default";
  if (status === "failed" || status === "manual_required") return "destructive";
  if (status === "cancelled") return "outline";
  return "secondary";
}

export const CHANNEL_POST_STATUS_FILTERS: { value: ChannelPostStatus | "all"; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "scheduled", label: "予約済み" },
  { value: "publishing", label: "配信中" },
  { value: "published", label: "配信済み" },
  { value: "failed", label: "失敗" },
  { value: "manual_required", label: "要人間照合" },
  { value: "cancelled", label: "キャンセル" },
];

export function ChannelPostsStatusFilter({ current }: { current: ChannelPostStatus | "all" }) {
  return (
    <div className="flex flex-wrap gap-2">
      {CHANNEL_POST_STATUS_FILTERS.map((f) => (
        <Link key={f.value} href={f.value === "all" ? "/admin/channels" : `/admin/channels?status=${f.value}`}>
          <Badge variant={current === f.value ? "default" : "outline"} className="cursor-pointer px-3 py-1">
            {f.label}
          </Badge>
        </Link>
      ))}
    </div>
  );
}

export function ChannelPostsQueue({ items }: { items: ChannelPostView[] }) {
  const [isPending, startTransition] = useTransition();
  const [manualDialog, setManualDialog] = useState<ChannelPostView | null>(null);
  const [externalUrl, setExternalUrl] = useState("");
  const [copyDialog, setCopyDialog] = useState<{
    post: ChannelPostView;
    content: { title: string; body_md: string; hashtags: string[] } | null;
    error: string | null;
  } | null>(null);

  function runAction(promise: Promise<{ error: string | null; success: boolean }>) {
    startTransition(async () => {
      const result = await promise;
      if (result.error) toast.error(result.error);
      else toast.success("更新しました。");
    });
  }

  async function openCopyDialog(post: ChannelPostView) {
    setCopyDialog({ post, content: null, error: null });
    const result = await getNoteCopyContentAction(post.draft_id);
    if (!result.ok) {
      setCopyDialog({ post, content: null, error: result.error });
      return;
    }
    setCopyDialog({ post, content: result.content, error: null });
  }

  /**
   * 「note に下書きを作成」ボタン (設計書 §8)。失敗時は必ず既存の半自動 (コピー + note 新規タブを
   * 開く) にフォールバックする — ここで作成に失敗してもユーザーが手詰まりにならないようにする。
   */
  function createNoteDraft(post: ChannelPostView) {
    startTransition(async () => {
      const result = await createNoteDraftAction(post.id);
      if (!result.ok) {
        toast.error(`下書き作成に失敗しました: ${result.error}`);
        await openCopyDialog(post); // フォールバック
        return;
      }
      if (result.status === "created") {
        toast.success("note に下書きを作成しました。");
      } else if (result.status === "unknown") {
        toast.warning("note の応答が確認できませんでした。もう一度試すと下書き一覧と照合します。");
        await openCopyDialog(post); // フォールバック (念のため手動でも確認できるようにする)
      } else {
        toast.info(`状態: ${NOTE_DRAFT_STATUS_LABELS[result.status]}`);
      }
    });
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label}をコピーしました。`);
    } catch {
      toast.error("コピーに失敗しました (ブラウザの権限をご確認ください)。");
    }
  }

  return (
    <>
      <Surface className="overflow-x-auto p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>予定日時</TableHead>
            <TableHead>チャネル</TableHead>
            <TableHead>状態</TableHead>
            <TableHead>コスト(セント)</TableHead>
            <TableHead>エラー</TableHead>
            <TableHead>アクション</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                該当する配信はありません。
              </TableCell>
            </TableRow>
          )}
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell>{new Date(item.scheduled_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</TableCell>
              <TableCell>
                {CHANNEL_LABELS[item.channel] ?? item.channel}
                {item.channel === "note" && item.note_draft_status !== "none" && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    下書き: {NOTE_DRAFT_STATUS_LABELS[item.note_draft_status]}
                    {item.note_draft_status === "created" && item.note_draft_url && (
                      <>
                        {" "}
                        <a href={item.note_draft_url} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                          開く
                        </a>
                      </>
                    )}
                  </div>
                )}
              </TableCell>
              <TableCell>
                <Badge variant={statusBadgeVariant(item.status)}>{STATUS_LABELS[item.status]}</Badge>
              </TableCell>
              <TableCell>{item.estimated_cost_cents}</TableCell>
              <TableCell className="max-w-64 truncate text-xs text-muted-foreground" title={item.last_error_detail ?? undefined}>
                {item.last_error_code ?? "-"}
              </TableCell>
              <TableCell className="flex flex-wrap gap-2">
                {item.status === "scheduled" && (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => runAction(cancelChannelPostAction(item.id))}
                  >
                    キャンセル
                  </Button>
                )}
                {item.status === "failed" && (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={isPending}
                    onClick={() => runAction(retryFailedChannelPostAction(item.id))}
                  >
                    再試行
                  </Button>
                )}
                {item.status === "manual_required" && item.channel === "note" && item.note_draft_status !== "created" && (
                  <Button size="xs" variant="outline" disabled={isPending} onClick={() => createNoteDraft(item)}>
                    note に下書きを作成
                  </Button>
                )}
                {item.status === "manual_required" && item.channel === "note" && (
                  <Button size="xs" variant="outline" onClick={() => void openCopyDialog(item)}>
                    note へコピー
                  </Button>
                )}
                {item.status === "manual_required" && (
                  <>
                    <Button
                      size="xs"
                      onClick={() => {
                        setExternalUrl("");
                        setManualDialog(item);
                      }}
                    >
                      投稿済みにする
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={isPending}
                      onClick={() =>
                        runAction(
                          resolveManualRequiredAction(item.id, {
                            kind: "reset_to_scheduled",
                            scheduled_at: null,
                          }),
                        )
                      }
                    >
                      未投稿 (予約に戻す)
                    </Button>
                  </>
                )}
                {item.status === "published" && item.external_url && (
                  <a
                    href={item.external_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs underline underline-offset-4"
                  >
                    投稿を見る
                  </a>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </Surface>

      <Dialog open={!!manualDialog} onOpenChange={(open) => !open && setManualDialog(null)}>
        <DialogContent>
          {manualDialog && (
            <>
              <DialogHeader>
                <DialogTitle>投稿済みにする</DialogTitle>
                <DialogDescription>
                  実際に SNS 上へ投稿されたことを確認した上で、投稿 URL を入力してください。
                </DialogDescription>
              </DialogHeader>
              <Input
                value={externalUrl}
                onChange={(e) => setExternalUrl(e.target.value)}
                placeholder="https://..."
                autoFocus
              />
              <DialogFooter>
                <Button variant="outline" onClick={() => setManualDialog(null)}>
                  閉じる (Esc)
                </Button>
                <Button
                  disabled={isPending || externalUrl.length === 0}
                  onClick={() => {
                    if (!manualDialog) return;
                    runAction(
                      resolveManualRequiredAction(manualDialog.id, {
                        kind: "mark_published",
                        external_url: externalUrl,
                      }),
                    );
                    setManualDialog(null);
                  }}
                >
                  確定する
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!copyDialog} onOpenChange={(open) => !open && setCopyDialog(null)}>
        <DialogContent>
          {copyDialog && (
            <>
              <DialogHeader>
                <DialogTitle>note へコピー</DialogTitle>
                <DialogDescription>
                  タイトル・本文・ハッシュタグを個別にコピーして note の投稿画面に貼り付けてください (設計書 §8.3)。
                </DialogDescription>
              </DialogHeader>
              {copyDialog.error && <p className="text-sm text-destructive">{copyDialog.error}</p>}
              {!copyDialog.error && !copyDialog.content && <p className="text-sm text-muted-foreground">読み込み中...</p>}
              {copyDialog.content && (
                <div className="flex flex-col gap-3 text-sm">
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-muted p-2">
                    <span className="truncate">{copyDialog.content.title}</span>
                    <Button size="xs" variant="outline" onClick={() => void copyText(copyDialog.content!.title, "タイトル")}>
                      コピー
                    </Button>
                  </div>
                  <div className="flex items-start justify-between gap-2 rounded-lg bg-muted p-2">
                    <span className="line-clamp-4 whitespace-pre-wrap">{copyDialog.content.body_md}</span>
                    <Button size="xs" variant="outline" onClick={() => void copyText(copyDialog.content!.body_md, "本文")}>
                      コピー
                    </Button>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg bg-muted p-2">
                    <span>{copyDialog.content.hashtags.map((h) => `#${h}`).join(" ")}</span>
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => void copyText(copyDialog.content!.hashtags.map((h) => `#${h}`).join(" "), "ハッシュタグ")}
                    >
                      コピー
                    </Button>
                  </div>
                  <a
                    href="https://note.com/notes/new"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs underline underline-offset-4"
                  >
                    note の投稿画面を新規タブで開く →
                  </a>
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setCopyDialog(null)}>
                  閉じる (Esc)
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
