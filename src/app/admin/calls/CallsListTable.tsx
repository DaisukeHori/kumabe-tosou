"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { DataTableHeaderRow, DataTableShell, dataTableRowClassName } from "@/app/admin/_ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getErrorInfo } from "@/modules/platform/errors";
import type { CallListItemView } from "@/modules/telephony/contracts";

import { retryLatestFailedCallJobAction } from "./actions";
import { CallHandlingBadge, JobStatusBadge } from "./_ui/badges";

/**
 * 04-telephony.md §8.1 の列 (相手/種別/通話時間/処理状態/要約冒頭40字/要確認バッジ)。
 *
 * 【判断根拠 — レビュー指摘 (MAJOR) 是正】以前は CallListItem (07-contracts-delta §4.13
 * 一字一句写経) に summary/match_status/error_code が無いことを理由に「要約冒頭40字」
 * 「要確認バッジ」「failed の error_code ツールチップ」の 3 点を丸ごと省略していたが、
 * CallListItem 自体 (D7 canonical) は改変せず、telephony/contracts.ts に別型
 * CallListItemView (CallDetail と同じ「契約外拡張の読み取りビュー型」パターン) を新設して
 * 一覧専用のこの 3 点を補った。listCalls (facade.ts の契約外拡張メソッド — D8 canonical の
 * 対象外) の戻り値をこの型に差し替えるだけで完結し、D7/D8 いずれの契約にも抵触しない。
 */
const GRID_COLS = "grid-cols-[150px_1fr_110px_70px_130px_1fr_90px]";

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "-";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 一覧のキーボード操作 (04-telephony.md §8.1): ↑↓ 行移動 / Enter 詳細 / Esc 選択解除 / r failed再実行 */
export function CallsListTable({ items }: { items: CallListItemView[] }) {
  const router = useRouter();
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [confirmRetryCallId, setConfirmRetryCallId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const cancelRetryButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setFocusedIndex((i) => Math.min(i, Math.max(items.length - 1, 0)));
  }, [items.length]);

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">該当する通話がありません。</p>;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (confirmRetryCallId) return; // ダイアログ表示中は一覧側のキー操作を止める
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      router.push(`/admin/calls/${items[focusedIndex].id}`);
    } else if (e.key === "Escape") {
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
    } else if (e.key.toLowerCase() === "r") {
      const row = items[focusedIndex];
      if (row.job_status === "failed") {
        e.preventDefault();
        setConfirmRetryCallId(row.id);
      }
    }
  }

  function handleConfirmRetry() {
    if (!confirmRetryCallId) return;
    const callId = confirmRetryCallId;
    startTransition(async () => {
      const result = await retryLatestFailedCallJobAction({ callId });
      if (!result.ok) {
        toast.error(getErrorInfo(result.code).message);
      } else {
        toast.success("再実行を開始しました。");
        router.refresh();
      }
      setConfirmRetryCallId(null);
    });
  }

  return (
    <>
      <DataTableShell>
        <DataTableHeaderRow
          columns={["日時", "相手", "種別", "通話時間", "処理状態", "要約", "要確認"]}
          gridClassName={GRID_COLS}
        />
        <div
          role="listbox"
          aria-label="通話一覧"
          tabIndex={0}
          onKeyDown={handleKeyDown}
          className="divide-y divide-border outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
        >
          {items.map((item, index) => (
            <div
              key={item.id}
              role="option"
              aria-selected={index === focusedIndex}
              onClick={() => router.push(`/admin/calls/${item.id}`)}
              onMouseEnter={() => setFocusedIndex(index)}
              className={`grid cursor-pointer items-center gap-4 px-4 py-3 text-sm transition-colors ${GRID_COLS} ${dataTableRowClassName(index === focusedIndex)}`}
            >
              <div className="text-xs whitespace-nowrap text-muted-foreground">
                {new Date(item.started_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
              </div>
              <div className="min-w-0 truncate">{item.customer_name ?? item.from_e164 ?? "番号非通知"}</div>
              <CallHandlingBadge handling={item.handling} />
              <div className="text-xs whitespace-nowrap">{formatDuration(item.duration_seconds)}</div>
              <JobStatusBadge status={item.job_status} errorCode={item.job_error_code} />
              <div className="min-w-0 truncate text-xs text-muted-foreground">{item.summary_preview ?? "-"}</div>
              {item.match_status === "ambiguous" ? (
                <Badge
                  variant="outline"
                  className="whitespace-nowrap font-medium border-transparent bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                >
                  要確認
                </Badge>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
      </DataTableShell>

      <Dialog
        open={confirmRetryCallId !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmRetryCallId(null);
        }}
      >
        <DialogContent
          onKeyDown={(e) => {
            // 【判断根拠 — レビュー指摘 (MAJOR) 是正】祖先要素の preventDefault() は
            // ネイティブ <button> の「フォーカス中に Enter で click する」デフォルト動作まで
            // 握りつぶしてしまう。Tab で「取消」ボタンへフォーカスしてから Enter を押した場合は
            // 取消側のネイティブ Enter→click 挙動に委ね、ここでは何もしない (副作用のある
            // 「再実行」を誤発火させない — 早期 return ガード)。
            if (document.activeElement === cancelRetryButtonRef.current) return;
            if (e.key === "Enter") {
              e.preventDefault();
              handleConfirmRetry();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>失敗したジョブを再実行しますか?</DialogTitle>
            <DialogDescription>処理を最初のステージからやり直します。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button ref={cancelRetryButtonRef} variant="outline" onClick={() => setConfirmRetryCallId(null)}>
              取消 (Esc)
            </Button>
            <Button onClick={handleConfirmRetry} disabled={isPending}>
              {isPending ? "実行中..." : "再実行 (Enter)"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
