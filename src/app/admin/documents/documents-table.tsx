"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DataTableHeaderRow, DataTableShell, dataTableRowClassName } from "@/app/admin/_ui";
import type { DocumentListItem } from "@/modules/sales/contracts";

import { DOC_TYPE_LABEL, DocumentStatusBadge, formatJpy } from "./_shared";
import { getListPaymentContextAction } from "./list-payment-context-action";
import { openPaymentFlow, type PaymentContext } from "./open-payment-flow";
import { PaymentDialog } from "./[id]/payment-dialog";

const GRID_COLS = "grid-cols-[1fr_auto_1.2fr_1.2fr_auto_auto_auto_auto]";

/** 一覧行から入金記録を起動できるのは、詳細画面と同じ条件 (invoice かつ issued) のときだけ (§8.5)。 */
function canRecordPaymentFromList(item: DocumentListItem): boolean {
  return item.doc_type === "invoice" && item.status === "issued";
}

/**
 * 帳票一覧テーブル (§8.2)。キーボード: ↑↓ 行移動 / Enter 詳細へ (§8.7)。
 * `/` (検索フォーカス) と Esc (検索クリア) は親 (page.tsx 側の検索 input) が担当するため、
 * ここでは行フォーカスと Enter 遷移のみを持つ (deals-table.tsx と同型の分割)。
 *
 * [R4a] 分類B: 請求書 (issued) の行から入金記録ダイアログ (payment-dialog.tsx) を直接開ける
 * ようにした。残高・案件 updated_at は行データに無いため、開く直前に読み取り専用の
 * getListPaymentContextAction (既存 facade read の app 層合成) で取得してから既存 PaymentDialog へ
 * 渡す (recordPaymentAction 自体は不変)。
 */
export function DocumentsTable({ items }: { items: DocumentListItem[] }) {
  const router = useRouter();
  const [focusedIndex, setFocusedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [paymentContext, setPaymentContext] = useState<PaymentContext | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [loadingPaymentId, setLoadingPaymentId] = useState<string | null>(null);
  // 入金対象の取り違え (レース) 防止: A→B 連続クリックで後着 fetch が先着の対象を上書きするのを防ぐ。
  // クリックした item.id を記録し、await 解決後にこの値と一致する時だけ paymentContext を確定する。
  const latestPaymentRequestRef = useRef<string | null>(null);

  useEffect(() => {
    setFocusedIndex((i) => Math.min(i, Math.max(items.length - 1, 0)));
  }, [items.length]);

  useEffect(() => {
    function handleSlash(e: KeyboardEvent) {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>("[data-documents-search]")?.focus();
      }
    }
    window.addEventListener("keydown", handleSlash);
    return () => window.removeEventListener("keydown", handleSlash);
  }, []);

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">該当する帳票がありません。</p>;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      router.push(`/admin/documents/${items[focusedIndex].id}`);
    }
  }

  // 非同期制御 (stale-guard / reject 時の解錠 / last-click-wins) は open-payment-flow.ts に抽出し、
  // ここでは副作用 (state 更新・toast・Server Action) を注入するだけ。抽出により DOM 非依存の単体
  // テストで可用性 (reject 時に全「入金」ボタンが永久ロックしないこと) を固定している。
  function handleOpenPayment(item: DocumentListItem) {
    return openPaymentFlow(item, {
      getContext: getListPaymentContextAction,
      latestRequestRef: latestPaymentRequestRef,
      setLoadingPaymentId,
      setPaymentContext,
      setPaymentOpen,
      onBusinessError: (message) => toast.error(message),
      onNetworkError: () => toast.error("通信状態をご確認のうえ再度お試しください。"),
    });
  }

  return (
    <>
      <DataTableShell>
        <DataTableHeaderRow
          columns={["書類番号", "種別", "宛名", "案件名", "金額", "状態", "発行日", ""]}
          gridClassName={GRID_COLS}
        />
        <div
          ref={containerRef}
          role="listbox"
          aria-label="帳票一覧"
          tabIndex={0}
          onKeyDown={handleKeyDown}
          className="divide-y divide-admin-divider outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
        >
          {items.map((item, index) => (
            <div
              key={item.id}
              role="option"
              aria-selected={index === focusedIndex}
              onClick={() => router.push(`/admin/documents/${item.id}`)}
              onMouseEnter={() => setFocusedIndex(index)}
              className={`grid cursor-pointer items-center gap-4 px-4 py-3 text-sm transition-colors ${GRID_COLS} ${dataTableRowClassName(index === focusedIndex)}`}
            >
              <div className="min-w-0 truncate font-medium text-foreground">
                {item.doc_no ?? <span className="text-admin-text-meta">下書き</span>}
              </div>
              <div className="text-meta text-admin-text-meta">{DOC_TYPE_LABEL[item.doc_type]}</div>
              <div className="min-w-0 truncate text-meta text-admin-text-meta">{item.billing_name}</div>
              <div className="min-w-0 truncate text-meta text-admin-text-meta">{item.deal_title}</div>
              <div className="text-table whitespace-nowrap tabular-nums text-foreground">{formatJpy(item.total_jpy)}</div>
              <DocumentStatusBadge status={item.status} />
              <div className="text-meta whitespace-nowrap text-admin-text-meta">{item.issue_date ?? "—"}</div>
              <div className="justify-self-end">
                {canRecordPaymentFromList(item) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={loadingPaymentId !== null}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleOpenPayment(item);
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                  >
                    {loadingPaymentId === item.id ? "準備中…" : "入金"}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </DataTableShell>

      {paymentContext && (
        <PaymentDialog
          open={paymentOpen}
          onOpenChange={setPaymentOpen}
          documentId={paymentContext.documentId}
          dealId={paymentContext.dealId}
          dealUpdatedAt={paymentContext.dealUpdatedAt}
          balanceJpy={paymentContext.balanceJpy}
          docNo={paymentContext.docNo}
          targetName={paymentContext.targetName}
        />
      )}
    </>
  );
}
