"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Surface } from "@/app/admin/_ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Result } from "@/modules/platform/contracts";
import type { EventLinkSyncStatus, SyncIssueItem } from "@/modules/scheduling/contracts";

import {
  reconcilePushUnknownAction,
  requestSyncNowAction,
  resendConflictedLinkAction,
  resolveExternalDeletionAction,
  resolveOrphanedLinkAction,
} from "../actions";

const PROVIDER_LABEL: Record<string, string> = { google: "Google", microsoft: "Microsoft" };

const STATUS_LABEL: Record<EventLinkSyncStatus, string> = {
  synced: "同期済み",
  pending_push: "送信待ち",
  conflict: "競合",
  orphaned: "孤立",
  deleted_externally: "外部で削除",
};

function statusBadgeVariant(
  status: EventLinkSyncStatus,
): "success" | "secondary" | "destructive" | "outline" {
  if (status === "synced") return "success";
  if (status === "deleted_externally" || status === "conflict") return "destructive";
  return "outline";
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

/**
 * /admin/calendar/connections の「同期の問題」表 + [今すぐ同期] (03-scheduling.md §10.4)。
 * 行アクションは (sync_status, last_error_code) の組み合わせで一意に決まる (§8.7/§9.2):
 *   deleted_externally → 3 択 (未配置に戻す/キャンセルする/作り直して再送)
 *   conflict + KMB-E724 → 照合して再開
 *   conflict + KMB-E723 → 再送
 *   orphaned → 再送 / リンクを削除
 * `/admin/channels` の channel-posts-queue.tsx (Table + startTransition + toast) と同型パターン。
 */
export function SyncIssuesTable({ items }: { items: SyncIssueItem[] }) {
  const [isPending, startTransition] = useTransition();

  function runAction(promise: Promise<Result<void>>, successMessage: string) {
    startTransition(async () => {
      const result = await promise;
      if (!result.ok) {
        toast.error(result.detail ?? `失敗しました (${result.code})`);
        return;
      }
      toast.success(successMessage);
    });
  }

  function handleSyncNow() {
    startTransition(async () => {
      const result = await requestSyncNowAction();
      if (!result.ok) {
        toast.error(result.detail ?? `今すぐ同期に失敗しました (${result.code})`);
        return;
      }
      if (result.value.skipped_running) {
        toast.warning("同期が進行中です。しばらくしてから再実行してください。");
        return;
      }
      const totals = result.value.reports.reduce(
        (acc, r) => ({
          pulled: acc.pulled + r.pulled,
          pushed: acc.pushed + r.pushed,
          echoes: acc.echoes + r.echoes_rejected,
          conflicts: acc.conflicts + r.conflicts,
        }),
        { pulled: 0, pushed: 0, echoes: 0, conflicts: 0 },
      );
      toast.success(
        `取込 ${totals.pulled} / 反映 ${totals.pushed} / エコー棄却 ${totals.echoes} / 競合 ${totals.conflicts}`,
      );
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Button type="button" size="sm" disabled={isPending} onClick={handleSyncNow}>
          今すぐ同期
        </Button>
      </div>

      <Surface className="overflow-x-auto p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ブロック</TableHead>
              <TableHead>連携先</TableHead>
              <TableHead>状態</TableHead>
              <TableHead>エラー</TableHead>
              <TableHead>検知時刻</TableHead>
              <TableHead>アクション</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  同期の問題はありません。
                </TableCell>
              </TableRow>
            )}
            {items.map((item) => (
              <TableRow key={item.link_id}>
                <TableCell className="max-w-48 truncate">{item.block.title || item.block.work_type_label}</TableCell>
                <TableCell>{PROVIDER_LABEL[item.provider] ?? item.provider}</TableCell>
                <TableCell>
                  <Badge variant={statusBadgeVariant(item.sync_status)}>{STATUS_LABEL[item.sync_status]}</Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{item.last_error_code ?? "-"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{formatDateTime(item.deleted_externally_at)}</TableCell>
                <TableCell className="flex flex-wrap gap-2">
                  {item.sync_status === "deleted_externally" && (
                    <>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={isPending}
                        onClick={() =>
                          runAction(resolveExternalDeletionAction(item.link_id, "unschedule"), "未配置に戻しました。")
                        }
                      >
                        未配置に戻す
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={isPending}
                        onClick={() =>
                          runAction(resolveExternalDeletionAction(item.link_id, "cancel_block"), "キャンセルしました。")
                        }
                      >
                        キャンセルする
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={isPending}
                        onClick={() =>
                          runAction(resolveExternalDeletionAction(item.link_id, "repush"), "再作成を予約しました。")
                        }
                      >
                        作り直して再送
                      </Button>
                    </>
                  )}
                  {item.sync_status === "conflict" && item.last_error_code === "KMB-E724" && (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={isPending}
                      onClick={() =>
                        startTransition(async () => {
                          const result = await reconcilePushUnknownAction(item.link_id);
                          if (!result.ok) {
                            toast.error(result.detail ?? `照合に失敗しました (${result.code})`);
                            return;
                          }
                          toast.success(result.value.resolved ? "外部に反映済みでした (同期済みにしました)。" : "未反映だったため再送します。");
                        })
                      }
                    >
                      照合して再開
                    </Button>
                  )}
                  {item.sync_status === "conflict" && item.last_error_code === "KMB-E723" && (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={isPending}
                      onClick={() => runAction(resendConflictedLinkAction(item.link_id), "再送を予約しました。")}
                    >
                      再送
                    </Button>
                  )}
                  {item.sync_status === "orphaned" && (
                    <>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => runAction(resolveOrphanedLinkAction(item.link_id, "repush"), "再送を予約しました。")}
                      >
                        再送
                      </Button>
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => runAction(resolveOrphanedLinkAction(item.link_id, "delete_link"), "リンクを削除しました。")}
                      >
                        リンクを削除
                      </Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Surface>
    </div>
  );
}
