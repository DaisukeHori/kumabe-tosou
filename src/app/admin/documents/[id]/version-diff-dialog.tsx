"use client";

import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { DocumentDetail } from "@/modules/sales/contracts";
import type { IssuedSnapshotDiff } from "@/modules/sales/facade";

import { computeVersionDiffAction } from "../actions";
import { formatJpy } from "../_shared";

const HEADER_FIELD_LABEL: Record<string, string> = {
  issue_date: "発行日",
  transaction_date: "取引年月日",
  valid_until: "有効期限",
  billing_name: "宛名",
  billing_suffix: "敬称",
  billing_address: "宛先住所",
  site_name: "現場名",
  site_address: "現場住所",
  notes: "備考",
  issuer_name: "発行者名",
  issuer_registration_number: "登録番号",
};

/**
 * 版間差分ダイアログ (§11.1)。旧版 (左)・新版 (右) 並記 + 差分ハイライト
 * (削除行=左に赤帯 / 追加行=右に緑帯 / 変更ヘッダ項目=両側に黄帯 + 「旧→新」)。
 * キーボード: Esc 閉じる (Dialog 既定) / ← → 比較版の切替 / Tab フォーカストラップ (Dialog 既定)。
 */
export function VersionDiffDialog({
  open,
  onOpenChange,
  documentId,
  versions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  /** version 降順 (最新が先頭) — DocumentDetail.versions (listIssuedDocumentVersions の順序と同じ)。 */
  versions: DocumentDetail["versions"];
}) {
  // pairIndex: 0 = 最新 vs 直前 (既定)。値を増やすほど過去方向へ (versions[i+1] が older / versions[i] が newer)。
  const [pairIndex, setPairIndex] = useState(0);
  const [diff, setDiff] = useState<IssuedSnapshotDiff | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const newerEntry = versions[pairIndex] ?? null;
  const olderEntry = versions[pairIndex + 1] ?? null;

  useEffect(() => {
    if (!open || !newerEntry || !olderEntry) {
      setDiff(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    void computeVersionDiffAction(documentId, olderEntry.version, newerEntry.version).then((result) => {
      if (cancelled) return;
      setIsLoading(false);
      if (!result.ok) {
        setError(result.detail ?? `差分の取得に失敗しました (${result.code})`);
        return;
      }
      setDiff(result.value);
    });
    return () => {
      cancelled = true;
    };
  }, [open, documentId, newerEntry, olderEntry]);

  useEffect(() => {
    if (!open) setPairIndex(0);
  }, [open]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowLeft" && pairIndex + 1 < versions.length - 1) {
      e.preventDefault();
      setPairIndex((i) => i + 1);
    } else if (e.key === "ArrowRight" && pairIndex > 0) {
      e.preventDefault();
      setPairIndex((i) => i - 1);
    }
  }

  const oldColumn = diff?.lineDiffs.filter((l) => l.status !== "added") ?? [];
  const newColumn = diff?.lineDiffs.filter((l) => l.status !== "removed") ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl shadow-modal" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>
            版間差分 {olderEntry ? `v${olderEntry.version}` : "—"} → {newerEntry ? `v${newerEntry.version}` : "—"}
          </DialogTitle>
          <DialogDescription>← → キーで比較する版を切り替えられます。</DialogDescription>
        </DialogHeader>

        {!olderEntry && <p className="text-sm text-muted-foreground">比較できる版がありません (v1 のみ)。</p>}
        {isLoading && <p className="text-sm text-muted-foreground">読み込み中...</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}

        {diff && !isLoading && (
          <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
            {diff.identical ? (
              <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                変更はありません (再出力による版追加)。
              </p>
            ) : (
              <>
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm tabular-nums">
                  合計 {formatJpy(diff.totalDiff.old)} → {formatJpy(diff.totalDiff.new)}
                  {diff.totalDiff.changed && (
                    <span className={cn("ml-2 font-medium", diff.totalDiff.new >= diff.totalDiff.old ? "text-status-success-fg" : "text-destructive")}>
                      ({diff.totalDiff.new - diff.totalDiff.old >= 0 ? "+" : ""}
                      {formatJpy(diff.totalDiff.new - diff.totalDiff.old)})
                    </span>
                  )}
                </div>

                {diff.headerDiffs.length > 0 && (
                  <div>
                    <h3 className="mb-1.5 text-meta font-bold text-admin-text-label">ヘッダ変更</h3>
                    <ul className="flex flex-col gap-1">
                      {diff.headerDiffs.map((h) => (
                        <li
                          key={h.field}
                          className="rounded-md border border-status-warning-border bg-status-warning-bg px-2 py-1 text-xs text-status-warning-fg"
                        >
                          <span className="font-medium">{HEADER_FIELD_LABEL[h.field] ?? h.field}</span>: {h.old || "(空)"} → {h.new || "(空)"}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <h3 className="mb-1.5 text-meta font-bold text-admin-text-label">旧版 (v{olderEntry?.version})</h3>
                    <ul className="flex flex-col gap-1 text-xs">
                      {oldColumn.map((l, i) => (
                        <li
                          key={`old-${i}`}
                          className={cn(
                            "rounded-md px-2 py-1",
                            l.status === "removed" && "bg-destructive/10 text-destructive",
                          )}
                        >
                          {l.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="mb-1.5 text-meta font-bold text-admin-text-label">新版 (v{newerEntry?.version})</h3>
                    <ul className="flex flex-col gap-1 text-xs">
                      {newColumn.map((l, i) => (
                        <li
                          key={`new-${i}`}
                          className={cn(
                            "rounded-md px-2 py-1",
                            l.status === "added" && "bg-status-success-bg text-status-success-fg",
                          )}
                        >
                          {l.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {diff.taxSummaryDiffs.some((t) => t.changed) && (
                  <div>
                    <h3 className="mb-1.5 text-meta font-bold text-admin-text-label">税率区分別の変更</h3>
                    <ul className="flex flex-col gap-1 text-xs">
                      {diff.taxSummaryDiffs
                        .filter((t) => t.changed)
                        .map((t) => (
                          <li key={t.tax_category} className="rounded-md bg-status-warning-bg px-2 py-1 text-status-warning-fg">
                            {t.tax_category}: 対象額 {t.old_taxable_jpy ?? "—"} → {t.new_taxable_jpy ?? "—"} / 消費税{" "}
                            {t.old_tax_jpy ?? "—"} → {t.new_tax_jpy ?? "—"}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
